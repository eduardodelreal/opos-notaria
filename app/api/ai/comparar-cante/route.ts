import { errorApi, proveedorActivo, rechazo, sinClave } from "@/lib/ai/proveedor";
import type { EsquemaSalida } from "@/lib/ai/proveedores/tipos";
import { sistemaComparacion } from "@/lib/ai/prompts";
import { responderPreflight } from "@/lib/ai/cors";
import { protegida } from "@/lib/ai/guardia";
import type { Perfil } from "@/lib/data/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Comparación de la transcripción del cante con el texto del tema.
 *
 * Esto SÍ es Claude: es texto contra texto, que es donde el modelo aporta.
 * El audio no llega hasta aquí — lo transcribe /api/ai/transcribir, porque
 * la Messages API no acepta audio (ver lib/ai/transcripcion.ts).
 *
 * Salida estructurada para poder pintarla como tarjeta y guardarla junto al
 * cante, igual que el análisis.
 */
const ESQUEMA: EsquemaSalida = {
  nombre: "comparacion_cante",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "titular",
      "cobertura",
      "omisiones",
      "dichoDeMas",
      "epigrafesIncompletos",
      "literalidad",
    ],
    properties: {
      titular: {
        type: "string",
        description:
          "El veredicto en una frase de menos de 100 caracteres: qué es lo más grave que se dejó.",
      },
      cobertura: {
        type: "integer",
        minimum: 0,
        maximum: 100,
        description:
          "Porcentaje del contenido del tema que aparece de verdad en la transcripción.",
      },
      omisiones: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["epigrafe", "tipo", "falta", "gravedad"],
          properties: {
            epigrafe: {
              type: "string",
              description: "Título del epígrafe del tema donde falta.",
            },
            tipo: {
              type: "string",
              enum: [
                "articulo",
                "requisito",
                "clasificacion",
                "plazo",
                "concepto",
                "epigrafe",
              ],
            },
            falta: {
              type: "string",
              description: "Qué se saltó, en una línea y con su nombre exacto.",
            },
            cita: {
              type: "string",
              description:
                "Fragmento LITERAL del texto del tema que lo respalda. Sin él no se afirma nada.",
            },
            gravedad: { type: "string", enum: ["alta", "media", "baja"] },
          },
        },
        description: "Ordenadas de más grave a menos. Como mucho 12.",
      },
      dichoDeMas: {
        type: "array",
        items: { type: "string" },
        description:
          "Cosas dichas que no están en el texto del tema y conviene contrastar. Vacío si no hay.",
      },
      epigrafesIncompletos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["epigrafe", "cobertura", "nota"],
          properties: {
            epigrafe: { type: "string" },
            cobertura: { type: "integer", minimum: 0, maximum: 100 },
            nota: {
              type: "string",
              description: "Qué le falta a ese epígrafe para estar entero.",
            },
          },
        },
      },
      literalidad: {
        type: "string",
        description:
          "Dos o tres frases sobre cuánto se ciñe al texto donde importa (artículos, definiciones, listas).",
      },
    },
  },
};

async function manejar(req: Request) {
  const ia = proveedorActivo();
  if (!ia.ok) return sinClave(ia);

  try {
    const body = (await req.json()) as {
      comparacion: string;
      estilo?: Perfil["estiloFeedback"];
    };

    if (!body?.comparacion) {
      return Response.json(
        {
          error: "peticion",
          mensaje: "Faltan el texto del tema o la transcripción del cante.",
        },
        { status: 400 },
      );
    }

    const respuesta = await ia.proveedor.estructurada({
      sistema: sistemaComparacion(body.estilo ?? "directo"),
      esquema: ESQUEMA,
      maxTokens: 8000,
      mensajes: [
        { rol: "user", texto: `${body.comparacion}\n\n---\n\nDime qué se saltó.` },
      ],
      senal: req.signal,
    });

    if (respuesta.rechazado) return rechazo();

    const texto = respuesta.texto;
    let comparacion: unknown;
    try {
      comparacion = JSON.parse(texto);
    } catch {
      return Response.json(
        { error: "parseo", mensaje: "El modelo no devolvió JSON válido.", texto },
        { status: 502 },
      );
    }

    return Response.json({ comparacion, modelo: ia.modelo });
  } catch (e) {
    return errorApi(e);
  }
}

/** El navegador manda OPTIONS antes de un POST cross-origin. */
export function OPTIONS(req: Request) {
  return responderPreflight(req);
}

/**
 * La sesión se comprueba fuera de `manejar`: si esta instalación tiene
 * Supabase configurado, sin sesión válida no se llega ni a leer el cuerpo,
 * y por tanto no se gasta un céntimo. Ver `lib/ai/guardia.ts`.
 */
export const POST = protegida(manejar);

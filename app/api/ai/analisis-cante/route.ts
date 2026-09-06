import { errorApi, proveedorActivo, rechazo, sinClave } from "@/lib/ai/proveedor";
import type { EsquemaSalida } from "@/lib/ai/proveedores/tipos";
import { sistemaAnalisis } from "@/lib/ai/prompts";
import { responderPreflight } from "@/lib/ai/cors";
import { protegida } from "@/lib/ai/guardia";
import type { Perfil } from "@/lib/data/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Análisis de un cante.
 * Devuelve JSON con forma fija (structured outputs) para poder pintarlo
 * como tarjeta en la ficha del tema y guardarlo junto al cante.
 */
const ESQUEMA: EsquemaSalida = {
  nombre: "analisis_cante",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "titular",
      "diagnostico",
      "fortalezas",
      "mejoras",
      "focoProximaSesion",
      "epigrafesCriticos",
    ],
    properties: {
      titular: {
        type: "string",
        description: "El veredicto en una sola frase de menos de 90 caracteres.",
      },
      diagnostico: {
        type: "string",
        description:
          "Dos o tres frases explicando qué ha pasado en este cante y cómo se compara con los anteriores.",
      },
      fortalezas: {
        type: "array",
        items: { type: "string" },
        description: "De 1 a 3 cosas que ha hecho bien, concretas.",
      },
      mejoras: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["que", "como", "prioridad"],
          properties: {
            que: { type: "string", description: "Qué falla, nombrando el epígrafe." },
            como: { type: "string", description: "Cómo corregirlo, de forma ejecutable." },
            prioridad: { type: "string", enum: ["alta", "media", "baja"] },
          },
        },
        description: "De 2 a 4 mejoras ordenadas por prioridad.",
      },
      focoProximaSesion: {
        type: "string",
        description: "Una sola cosa a trabajar en la próxima sesión de estudio.",
      },
      epigrafesCriticos: {
        type: "array",
        items: { type: "string" },
        description: "Títulos de los epígrafes que hay que atacar primero.",
      },
    },
  },
};

async function manejar(req: Request) {
  const ia = proveedorActivo();
  if (!ia.ok) return sinClave(ia);

  try {
    const body = (await req.json()) as {
      detalleCante: string;
      ficha: string;
      estilo?: Perfil["estiloFeedback"];
    };

    if (!body?.detalleCante) {
      return Response.json(
        { error: "peticion", mensaje: "Falta el detalle del cante." },
        { status: 400 },
      );
    }

    const respuesta = await ia.proveedor.estructurada({
      sistema: sistemaAnalisis(body.estilo ?? "directo"),
      esquema: ESQUEMA,
      maxTokens: 8000,
      mensajes: [
        {
          rol: "user",
          texto: `${body.ficha}\n\n---\n\n${body.detalleCante}\n\n---\n\nAnaliza este cante.`,
        },
      ],
      senal: req.signal,
    });

    if (respuesta.rechazado) return rechazo();

    const texto = respuesta.texto;
    let analisis: unknown;
    try {
      analisis = JSON.parse(texto);
    } catch {
      return Response.json(
        { error: "parseo", mensaje: "El modelo no devolvió JSON válido.", texto },
        { status: 502 },
      );
    }

    return Response.json({ analisis, modelo: ia.modelo });
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

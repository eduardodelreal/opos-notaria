import {
  MODELO,
  errorApi,
  esRechazo,
  getCliente,
  hayClave,
  sinClave,
  textoDe,
} from "@/lib/ai/client";
import { sistemaAnalisis } from "@/lib/ai/prompts";
import type { Perfil } from "@/lib/data/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Análisis de un cante.
 * Devuelve JSON con forma fija (structured outputs) para poder pintarlo
 * como tarjeta en la ficha del tema y guardarlo junto al cante.
 */
const ESQUEMA = {
  type: "json_schema" as const,
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

export async function POST(req: Request) {
  if (!hayClave()) return sinClave();

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

    const respuesta = await getCliente().messages.create({
      model: MODELO,
      max_tokens: 8000,
      system: [
        {
          type: "text",
          text: sistemaAnalisis(body.estilo ?? "directo"),
          cache_control: { type: "ephemeral" },
        },
      ],
      output_config: { format: ESQUEMA },
      messages: [
        {
          role: "user",
          content: `${body.ficha}\n\n---\n\n${body.detalleCante}\n\n---\n\nAnaliza este cante.`,
        },
      ],
    }, { signal: req.signal });

    if (esRechazo(respuesta)) {
      return Response.json(
        {
          error: "rechazo",
          mensaje: "El modelo no ha podido procesar esta petición.",
        },
        { status: 422 },
      );
    }

    const texto = textoDe(respuesta);
    let analisis: unknown;
    try {
      analisis = JSON.parse(texto);
    } catch {
      return Response.json(
        { error: "parseo", mensaje: "El modelo no devolvió JSON válido.", texto },
        { status: 502 },
      );
    }

    return Response.json({ analisis, modelo: MODELO });
  } catch (e) {
    return errorApi(e);
  }
}

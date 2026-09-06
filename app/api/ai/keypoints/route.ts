import {
  MODELO,
  errorApi,
  esRechazo,
  getCliente,
  hayClave,
  sinClave,
  textoDe,
} from "@/lib/ai/client";
import { sistemaKeyPoints } from "@/lib/ai/prompts";

export const runtime = "nodejs";
export const maxDuration = 180;

const ESQUEMA = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["keypoints"],
    properties: {
      keypoints: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["anverso", "reverso"],
          properties: {
            anverso: { type: "string", description: "Pregunta corta y unívoca." },
            reverso: { type: "string", description: "Respuesta exacta y breve." },
          },
        },
      },
    },
  },
};

/** Extrae puntos clave memorizables del texto que pega el opositor. */
export async function POST(req: Request) {
  if (!hayClave()) return sinClave();

  try {
    const body = (await req.json()) as {
      texto: string;
      tema?: string;
      epigrafe?: string;
    };

    if (!body?.texto || body.texto.trim().length < 60) {
      return Response.json(
        {
          error: "peticion",
          mensaje: "Pega al menos un párrafo de texto para poder extraer keypoints.",
        },
        { status: 400 },
      );
    }

    const respuesta = await getCliente().messages.create({
      model: MODELO,
      max_tokens: 8000,
      system: [
        {
          type: "text",
          text: sistemaKeyPoints(),
          cache_control: { type: "ephemeral" },
        },
      ],
      output_config: { format: ESQUEMA },
      messages: [
        {
          role: "user",
          content: `${body.tema ? `Tema: ${body.tema}\n` : ""}${
            body.epigrafe ? `Epígrafe: ${body.epigrafe}\n` : ""
          }\nTexto:\n\n${body.texto}\n\n---\n\nExtrae los puntos clave.`,
        },
      ],
    });

    if (esRechazo(respuesta)) {
      return Response.json(
        { error: "rechazo", mensaje: "El modelo no ha podido responder." },
        { status: 422 },
      );
    }

    try {
      const datos = JSON.parse(textoDe(respuesta)) as {
        keypoints: { anverso: string; reverso: string }[];
      };
      return Response.json({ keypoints: datos.keypoints ?? [] });
    } catch {
      return Response.json(
        { error: "parseo", mensaje: "El modelo no devolvió JSON válido." },
        { status: 502 },
      );
    }
  } catch (e) {
    return errorApi(e);
  }
}

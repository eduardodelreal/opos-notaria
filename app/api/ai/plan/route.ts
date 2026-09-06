import {
  MODELO,
  errorApi,
  esRechazo,
  getCliente,
  hayClave,
  sinClave,
  textoDe,
} from "@/lib/ai/client";
import { sistemaPlan } from "@/lib/ai/prompts";
import type { Perfil } from "@/lib/data/types";

export const runtime = "nodejs";
export const maxDuration = 180;

/** Genera el plan semanal a partir de la ficha real del opositor. */
export async function POST(req: Request) {
  if (!hayClave()) return sinClave();

  try {
    const body = (await req.json()) as {
      ficha: string;
      instrucciones?: string;
      estilo?: Perfil["estiloFeedback"];
    };

    const respuesta = await getCliente().messages.create({
      model: MODELO,
      max_tokens: 16000,
      system: [
        {
          type: "text",
          text: sistemaPlan(body.estilo ?? "directo"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `${body.ficha}\n\n---\n\nHazme el plan de la semana que viene.${
            body.instrucciones ? `\n\nCondiciones que te pongo: ${body.instrucciones}` : ""
          }`,
        },
      ],
    });

    if (esRechazo(respuesta)) {
      return Response.json(
        { error: "rechazo", mensaje: "El modelo no ha podido responder." },
        { status: 422 },
      );
    }

    return Response.json({ plan: textoDe(respuesta), modelo: MODELO });
  } catch (e) {
    return errorApi(e);
  }
}

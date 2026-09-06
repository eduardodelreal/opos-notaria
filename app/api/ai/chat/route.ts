import Anthropic from "@anthropic-ai/sdk";
import {
  MODELO,
  errorApi,
  getCliente,
  hayClave,
  sinClave,
} from "@/lib/ai/client";
import { sistemaChat } from "@/lib/ai/prompts";
import { conCors, responderPreflight } from "@/lib/ai/cors";
import { FIN_RESPUESTA } from "@/lib/ai/protocolo";
import type { Perfil } from "@/lib/data/types";

export const runtime = "nodejs";
// Ojo: `maxDuration` solo lo leen los adaptadores serverless que lo
// soportan. En Netlify Functions se ignora y manda el tope del plan
// (10-30 s); de ahi el centinela de fin de respuesta.
export const maxDuration = 300;

/**
 * Chat con el preparador IA, en streaming.
 *
 * La ficha del opositor se adjunta al ÚLTIMO mensaje de usuario, no al
 * system prompt: así el prefijo cacheado (system + historial) se mantiene
 * intacto entre turnos y solo se pagan tokens completos por la ficha.
 */
async function manejar(req: Request) {
  if (!hayClave()) return sinClave();

  try {
    const body = (await req.json()) as {
      mensajes: { rol: "user" | "assistant"; texto: string }[];
      ficha: string;
      estilo?: Perfil["estiloFeedback"];
    };

    const historial = (body.mensajes ?? []).filter((m) => m.texto?.trim());
    if (!historial.length) {
      return Response.json(
        { error: "peticion", mensaje: "No hay mensajes." },
        { status: 400 },
      );
    }

    const messages: Anthropic.MessageParam[] = historial.map((m, i) => {
      const esUltimo = i === historial.length - 1;
      if (esUltimo && m.rol === "user") {
        return {
          role: "user",
          content: `<ficha_del_opositor>\n${body.ficha}\n</ficha_del_opositor>\n\n${m.texto}`,
        };
      }
      return { role: m.rol, content: m.texto };
    });

    const stream = getCliente().messages.stream({
      model: MODELO,
      max_tokens: 16000,
      system: [
        {
          type: "text",
          text: sistemaChat(body.estilo ?? "directo"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
    });

    const encoder = new TextEncoder();
    const salida = new ReadableStream({
      async start(controller) {
        try {
          for await (const evento of stream) {
            if (
              evento.type === "content_block_delta" &&
              evento.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(evento.delta.text));
            }
          }
          const final = await stream.finalMessage();
          if (final.stop_reason === "refusal") {
            controller.enqueue(
              encoder.encode(
                "\n\n(El modelo no ha podido responder a esta petición.)",
              ),
            );
          }
          // Centinela de cierre limpio. Si la conexión se corta antes de
          // tiempo (funciones serverless con tope de ejecución, red caída),
          // el cliente no lo recibe y marca la respuesta como truncada en
          // vez de guardarla como si estuviera completa.
          controller.enqueue(encoder.encode(FIN_RESPUESTA));
        } catch (e) {
          controller.enqueue(
            encoder.encode(
              `\n\n[Error de conexión con el modelo: ${(e as Error).message}]`,
            ),
          );
        } finally {
          controller.close();
        }
      },
      cancel() {
        stream.abort();
      },
    });

    return new Response(salida, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    return errorApi(e);
  }
}

/** El navegador manda OPTIONS antes de un POST cross-origin. */
export function OPTIONS(req: Request) {
  return responderPreflight(req);
}

export async function POST(req: Request) {
  return conCors(await manejar(req), req);
}

import { errorApi, proveedorActivo, sinClave } from "@/lib/ai/proveedor";
import type { MensajeIA } from "@/lib/ai/proveedores/tipos";
import { sistemaChat } from "@/lib/ai/prompts";
import { responderPreflight } from "@/lib/ai/cors";
import { protegida } from "@/lib/ai/guardia";
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
  const ia = proveedorActivo();
  if (!ia.ok) return sinClave(ia);

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

    const mensajes: MensajeIA[] = historial.map((m, i) => {
      const esUltimo = i === historial.length - 1;
      if (esUltimo && m.rol === "user") {
        return {
          rol: "user",
          texto: `<ficha_del_opositor>\n${body.ficha}\n</ficha_del_opositor>\n\n${m.texto}`,
        };
      }
      return { rol: m.rol, texto: m.texto };
    });

    // El proveedor devuelve ya los trozos de texto: si es Anthropic salen
    // de los `text_delta` y si es OpenAI de los `response.output_text.delta`.
    // Aquí abajo eso da igual, que es justo la gracia.
    const flujo = ia.proveedor.conversacion({
      sistema: sistemaChat(body.estilo ?? "directo"),
      maxTokens: 16000,
      mensajes,
      senal: req.signal,
    });

    const encoder = new TextEncoder();
    const salida = new ReadableStream({
      async start(controller) {
        try {
          for await (const trozo of flujo.trozos) {
            controller.enqueue(encoder.encode(trozo));
          }
          if (flujo.huboRechazo()) {
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
        flujo.abortar();
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

/**
 * La sesión se comprueba fuera de `manejar`: si esta instalación tiene
 * Supabase configurado, sin sesión válida no se llega ni a leer el cuerpo,
 * y por tanto no se gasta un céntimo. Ver `lib/ai/guardia.ts`.
 */
export const POST = protegida(manejar);

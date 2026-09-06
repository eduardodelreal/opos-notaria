import { errorApi, proveedorActivo, rechazo, sinClave } from "@/lib/ai/proveedor";
import { sistemaPlan } from "@/lib/ai/prompts";
import { responderPreflight } from "@/lib/ai/cors";
import { protegida } from "@/lib/ai/guardia";
import type { Perfil } from "@/lib/data/types";

export const runtime = "nodejs";
export const maxDuration = 180;

/** Genera el plan semanal a partir de la ficha real del opositor. */
async function manejar(req: Request) {
  const ia = proveedorActivo();
  if (!ia.ok) return sinClave(ia);

  try {
    const body = (await req.json()) as {
      ficha: string;
      instrucciones?: string;
      estilo?: Perfil["estiloFeedback"];
    };

    const respuesta = await ia.proveedor.texto({
      sistema: sistemaPlan(body.estilo ?? "directo"),
      maxTokens: 16000,
      mensajes: [
        {
          rol: "user",
          texto: `${body.ficha}\n\n---\n\nHazme el plan de la semana que viene.${
            body.instrucciones ? `\n\nCondiciones que te pongo: ${body.instrucciones}` : ""
          }`,
        },
      ],
      senal: req.signal,
    });

    if (respuesta.rechazado) return rechazo();

    return Response.json({ plan: respuesta.texto, modelo: ia.modelo });
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

import { errorApi, proveedorActivo, rechazo, sinClave } from "@/lib/ai/proveedor";
import { sistemaDictamen } from "@/lib/ai/prompts";
import { responderPreflight } from "@/lib/ai/cors";
import { protegida } from "@/lib/ai/guardia";
import type { Perfil } from "@/lib/data/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Corrección de dictamen. Dos modos:
 * - `generar`: crea un supuesto práctico a partir de los temas indicados.
 * - `corregir`: corrige la respuesta del opositor con la rúbrica del ejercicio.
 */
async function manejar(req: Request) {
  const ia = proveedorActivo();
  if (!ia.ok) return sinClave(ia);

  try {
    const body = (await req.json()) as {
      modo: "generar" | "corregir";
      supuesto?: string;
      respuesta?: string;
      temas?: string;
      estilo?: Perfil["estiloFeedback"];
    };

    const contenido =
      body.modo === "generar"
        ? `Redáctame un supuesto práctico de dictamen del nivel de la oposición a Notarías, que cruce varias instituciones y tenga trampa. ${
            body.temas
              ? `Debe apoyarse en estos temas del programa: ${body.temas}.`
              : "Elige tú las instituciones."
          } Devuelve solo el supuesto, sin la solución.`
        : `# Supuesto\n\n${body.supuesto ?? "(no aportado)"}\n\n# Dictamen del opositor\n\n${
            body.respuesta ?? ""
          }\n\n---\n\nCorrígelo con la rúbrica.`;

    if (body.modo === "corregir" && !body.respuesta?.trim()) {
      return Response.json(
        { error: "peticion", mensaje: "No hay dictamen que corregir." },
        { status: 400 },
      );
    }

    const respuesta = await ia.proveedor.texto({
      sistema: sistemaDictamen(body.estilo ?? "directo"),
      maxTokens: 16000,
      mensajes: [{ rol: "user", texto: contenido }],
      senal: req.signal,
    });

    if (respuesta.rechazado) return rechazo();

    return Response.json({ texto: respuesta.texto, modelo: ia.modelo });
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

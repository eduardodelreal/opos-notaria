import {
  MODELO,
  errorApi,
  esRechazo,
  getCliente,
  hayClave,
  sinClave,
  textoDe,
} from "@/lib/ai/client";
import { sistemaDictamen } from "@/lib/ai/prompts";
import type { Perfil } from "@/lib/data/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Corrección de dictamen. Dos modos:
 * - `generar`: crea un supuesto práctico a partir de los temas indicados.
 * - `corregir`: corrige la respuesta del opositor con la rúbrica del ejercicio.
 */
export async function POST(req: Request) {
  if (!hayClave()) return sinClave();

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

    const respuesta = await getCliente().messages.create({
      model: MODELO,
      max_tokens: 16000,
      system: [
        {
          type: "text",
          text: sistemaDictamen(body.estilo ?? "directo"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: contenido }],
    });

    if (esRechazo(respuesta)) {
      return Response.json(
        { error: "rechazo", mensaje: "El modelo no ha podido responder." },
        { status: 422 },
      );
    }

    return Response.json({ texto: textoDe(respuesta), modelo: MODELO });
  } catch (e) {
    return errorApi(e);
  }
}

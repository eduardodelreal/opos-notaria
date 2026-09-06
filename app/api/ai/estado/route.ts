import { MODELO, hayClave } from "@/lib/ai/client";
import { conCors, responderPreflight } from "@/lib/ai/cors";
import { hayTranscripcion, motorTranscripcion } from "@/lib/ai/transcripcion";

export const runtime = "nodejs";

/**
 * La UI pregunta esto al arrancar para saber si enseña o no los botones de IA.
 *
 * `transcripcion` va aparte de `disponible` porque son dos proveedores
 * distintos y se configuran por separado: la API de Anthropic no acepta
 * audio (lib/ai/transcripcion.ts), así que se puede tener análisis de
 * cantes sin transcripción y al revés.
 */
export function GET(req: Request) {
  return conCors(
    Response.json({
      disponible: hayClave(),
      modelo: MODELO,
      transcripcion: hayTranscripcion(),
      motorTranscripcion: hayTranscripcion() ? motorTranscripcion() : "",
    }),
    req,
  );
}

/** El navegador manda OPTIONS antes de un POST cross-origin. */
export function OPTIONS(req: Request) {
  return responderPreflight(req);
}

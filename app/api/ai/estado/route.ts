import { MODELO, hayClave } from "@/lib/ai/client";
import { conCors, responderPreflight } from "@/lib/ai/cors";

export const runtime = "nodejs";

/** La UI pregunta esto al arrancar para saber si enseña o no los botones de IA. */
export function GET(req: Request) {
  return conCors(
    Response.json({ disponible: hayClave(), modelo: MODELO }),
    req,
  );
}

/** El navegador manda OPTIONS antes de un POST cross-origin. */
export function OPTIONS(req: Request) {
  return responderPreflight(req);
}

import { MODELO, hayClave } from "@/lib/ai/client";

export const runtime = "nodejs";

/** La UI pregunta esto al arrancar para saber si enseña o no los botones de IA. */
export function GET() {
  return Response.json({ disponible: hayClave(), modelo: MODELO });
}

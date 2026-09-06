import { hayClave, modeloActivo, proveedorConfigurado } from "@/lib/ai/proveedor";
import { conCors, responderPreflight } from "@/lib/ai/cors";
import { hayTranscripcion, motorTranscripcion } from "@/lib/ai/transcripcion";
import { haySupabase } from "@/lib/supabase/config";
import { usuarioDePeticion } from "@/lib/supabase/ruta";

export const runtime = "nodejs";

/**
 * La UI pregunta esto al arrancar para saber si enseña o no los botones de IA.
 *
 * `transcripcion` va aparte de `disponible` porque son dos proveedores
 * distintos y se configuran por separado: la API de Anthropic no acepta
 * audio (lib/ai/transcripcion.ts), así que se puede tener análisis de
 * cantes sin transcripción y al revés.
 *
 * Esta ruta es la ÚNICA de `/api/ai/*` que no exige sesión, a propósito:
 *   · no gasta dinero (no llama a ningún modelo),
 *   · la interfaz la necesita justo para saber que hace falta iniciar
 *     sesión, y pedir sesión para poder decir "hace falta sesión" sería
 *     una pescadilla,
 *   · `railway.json` la usa de healthcheck, y un healthcheck no tiene
 *     credenciales.
 *
 * `proveedor` dice quién atiende ("anthropic" u "openai", "" si nadie):
 * la interfaz lo enseña para que el opositor sepa a qué modelo le está
 * hablando, y para que un despliegue mal configurado se vea de un vistazo.
 *
 * Devuelve dos campos nuevos:
 *   · `requiereSesion`: este servidor tiene Supabase, así que el resto de
 *     rutas exigen sesión. Lo decide el servidor que ATIENDE la IA, que
 *     puede ser otro build (Railway) distinto del que sirve la web.
 *   · `sesion`: además, hemos reconocido la credencial que venía en esta
 *     petición. Sirve para detectar el caso feo de que la web y la API
 *     apunten a proyectos de Supabase distintos: el token existe pero no
 *     vale aquí, y mejor decirlo antes de que el opositor pulse el botón.
 */
export async function GET(req: Request) {
  const requiereSesion = haySupabase();

  // Solo se verifica si viene credencial. Sin ella la respuesta es
  // inmediata y sin red: importa para el healthcheck de Railway.
  const traeCredencial =
    Boolean(req.headers.get("authorization")) || Boolean(req.headers.get("cookie"));
  const sesion =
    requiereSesion && traeCredencial ? Boolean(await usuarioDePeticion(req)) : false;

  return conCors(
    Response.json({
      disponible: hayClave(),
      proveedor: proveedorConfigurado(),
      modelo: modeloActivo(),
      transcripcion: hayTranscripcion(),
      motorTranscripcion: hayTranscripcion() ? motorTranscripcion() : "",
      requiereSesion,
      sesion,
    }),
    req,
  );
}

/** El navegador manda OPTIONS antes de un POST cross-origin. */
export function OPTIONS(req: Request) {
  return responderPreflight(req);
}

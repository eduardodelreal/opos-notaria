import "server-only";
import { conCors } from "./cors";
import { haySupabase } from "@/lib/supabase/config";
import { noAutorizado, usuarioDePeticion } from "@/lib/supabase/ruta";

/* ============================================================
   Quién puede gastar dinero en las rutas de IA

   Cada llamada a `/api/ai/*` cuesta dinero real: tokens de Anthropic y,
   en `/transcribir`, minutos del proveedor de audio. Hasta aquí lo único
   que había delante era CORS, y CORS **no protege el endpoint**: solo le
   dice al navegador de otra pestaña que no lea la respuesta. Un `curl`
   directo al dominio de Railway no manda `Origin` y entra igual.

   La regla, del mismo estilo que el resto de la app (sin
   `ANTHROPIC_API_KEY` la IA se apaga y lo dice, sin Supabase no hay
   cuentas y lo dice):

     · Si esta instalación TIENE Supabase configurado, hay cuentas, así
       que las rutas de IA exigen una sesión válida.
     · Si NO lo tiene, no hay a quién pedirle sesión: las rutas siguen
       abiertas exactamente como hasta hoy. Es el caso del desarrollo en
       local y del despliegue de un solo opositor.

   Quien decide es el servidor que ATIENDE la ruta (Railway), no el que
   sirve la web (Netlify): son dos builds y podrían tener configuración
   distinta. Por eso `/api/ai/estado` publica `requiereSesion`, para que
   la interfaz sepa a qué atenerse antes de dejar pulsar un botón.

   Lo que esto NO hace: no limita cuánto gasta cada usuario. Cualquiera
   con cuenta en el proyecto de Supabase puede llamar tantas veces como
   quiera. Está anotado en docs/ia.md.
   ============================================================ */

/**
 * ¿Puede pasar esta petición? Devuelve `null` si sí, y la respuesta de
 * rechazo si no. Nunca lanza: `usuarioDePeticion()` ya se traga los
 * errores de red y devuelve `null`.
 */
export async function rechazoPorSesion(req: Request): Promise<Response | null> {
  // Sin Supabase no hay cuentas: nada que exigir.
  if (!haySupabase()) return null;
  const usuario = await usuarioDePeticion(req);
  return usuario ? null : noAutorizado();
}

/**
 * Envuelve el manejador de una ruta de IA: primero la sesión, luego el
 * trabajo, y CORS **siempre** — también en el 401.
 *
 * Lo de CORS en el rechazo no es cosmética: una respuesta de error sin
 * `Access-Control-Allow-Origin` la bloquea el navegador antes de que el
 * JavaScript pueda leerla, así que el opositor vería un error de red
 * opaco en la consola en vez del mensaje "inicia sesión".
 */
export function protegida(
  manejar: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const rechazo = await rechazoPorSesion(req);
    return conCors(rechazo ?? (await manejar(req)), req);
  };
}

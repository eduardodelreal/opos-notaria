import { SIN_AVISOS, VAPID_PUBLICA, hayAvisos } from "@/lib/avisos/config";
import { haySupabase } from "@/lib/supabase/config";
import { conCors, responderPreflight } from "@/lib/ai/cors";

export const runtime = "nodejs";

/**
 * Diagnóstico de los avisos push.
 *
 * Sirve para dos cosas:
 *
 *   · comprobar que un despliegue quedó coherente. Las `NEXT_PUBLIC_*` se
 *     incrustan al compilar, así que declarar la clave VAPID después de
 *     construir no surte efecto y el síntoma es "el interruptor no aparece y
 *     no dice por qué". Aquí se ve de un vistazo.
 *   · dar la clave pública a quien la necesite en tiempo de ejecución.
 *
 * La clave que se devuelve es la PÚBLICA: viaja dentro de cada suscripción al
 * servicio push del navegador y no protege nada por sí sola. La privada no se
 * lee en ningún fichero de `app/` ni de `lib/` que acabe en el bundle: vive
 * solo en el entorno del cron.
 *
 * Este endpoint NO manda ningún push: para eso haría falta la clave privada
 * aquí dentro, y no la va a haber.
 */
export function GET(req: Request) {
  const disponible = hayAvisos();
  return conCors(
    Response.json({
      // Los avisos necesitan cuenta: es un servidor quien los dispara, y sin
      // Supabase no hay ni usuario al que atarlos ni dónde guardarlos.
      disponible: disponible && haySupabase(),
      vapid: disponible,
      supabase: haySupabase(),
      clavePublica: disponible ? VAPID_PUBLICA : "",
      mensaje: disponible ? null : SIN_AVISOS,
    }),
    req,
  );
}

export function OPTIONS(req: Request) {
  return responderPreflight(req);
}

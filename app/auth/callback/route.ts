import { NextResponse, type NextRequest } from "next/server";
import { SIN_SUPABASE, haySupabase } from "@/lib/supabase/config";
import { PARAM_DESTINO, rutaSegura } from "@/lib/supabase/destino";
import { mensajeAuth } from "@/lib/supabase/errores";
import { clienteServidor } from "@/lib/supabase/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tipos de enlace por correo que Supabase puede mandar a este callback. */
type TipoOtp = "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email";

/**
 * Vuelta de Supabase: OAuth (Google) y confirmación de correo.
 *
 * Llegan dos formas distintas y aquí se atienden las dos:
 *
 * - `?code=…`   → flujo PKCE (OAuth y, según ajustes, los enlaces por correo).
 * - `?token_hash=…&type=…` → enlaces de confirmación clásicos.
 *
 * Al canjear el código se escriben las cookies de sesión en la respuesta, así
 * que la redirección final ya sale autenticada.
 */
export async function GET(peticion: NextRequest) {
  const url = new URL(peticion.url);
  const params = url.searchParams;
  const destino = rutaSegura(params.get(PARAM_DESTINO));
  const base = baseDelSitio(peticion, url);

  const aEntrar = (mensaje: string) =>
    NextResponse.redirect(
      `${base}/entrar?error=${encodeURIComponent(mensaje)}&${PARAM_DESTINO}=${encodeURIComponent(destino)}`,
    );

  // Supabase avisa de sus propios fallos por querystring (permiso denegado en
  // Google, enlace caducado…). Se traducen y se enseñan en la página de acceso.
  const errorPrevio = params.get("error_description") || params.get("error");
  if (errorPrevio) return aEntrar(mensajeAuth({ message: errorPrevio }));

  if (!haySupabase()) return aEntrar(SIN_SUPABASE);

  const supabase = await clienteServidor();
  if (!supabase) return aEntrar(SIN_SUPABASE);

  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const tipo = params.get("type") as TipoOtp | null;

  try {
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
    } else if (tokenHash && tipo) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: tipo,
      });
      if (error) throw error;
    } else {
      return aEntrar("El enlace no traía ningún código de acceso. Vuelve a pedirlo.");
    }
  } catch (e) {
    return aEntrar(mensajeAuth(e));
  }

  return NextResponse.redirect(`${base}${destino}`);
}

/**
 * A dónde redirigir. Detrás de un proxy (Netlify, Railway) el `origin` de la
 * petición es el del contenedor, no el dominio público: hay que mirar las
 * cabeceras reenviadas, salvo en desarrollo.
 */
function baseDelSitio(peticion: NextRequest, url: URL): string {
  if (process.env.NODE_ENV === "development") return url.origin;

  const host = peticion.headers.get("x-forwarded-host");
  if (!host) return url.origin;

  const protocolo = peticion.headers.get("x-forwarded-proto") ?? "https";
  return `${protocolo}://${host}`;
}

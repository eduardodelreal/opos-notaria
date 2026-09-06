import "server-only";
import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { JwtPayload } from "@supabase/supabase-js";
import { SIN_SUPABASE, SUPABASE_ANON_KEY, SUPABASE_URL, haySupabase } from "./config";

/** Lo mínimo que necesita una ruta protegida para saber quién llama. */
export type UsuarioRuta = {
  id: string;
  email: string | null;
  claims: JwtPayload;
};

/**
 * Verifica el JWT del que llama a un Route Handler y devuelve el usuario, o
 * `null` si no hay sesión válida (o si no hay Supabase configurado).
 *
 * Acepta las dos formas en que puede llegar la sesión:
 *
 * 1. **Cabecera `Authorization: Bearer <access_token>`**. Es la que hace falta
 *    cuando el front y la API no comparten origen — que es justo el caso de
 *    `NEXT_PUBLIC_IA_URL` (Netlify llamando a Railway): ahí el navegador no
 *    manda las cookies.
 * 2. **Cookies de la petición**, para las llamadas del mismo origen.
 *
 * La verificación es real: `getClaims()` comprueba la firma del token (en
 * local con WebCrypto si el proyecto usa claves asimétricas, o contra el
 * servidor de Auth si son simétricas). No basta con decodificar el JWT.
 *
 * Nunca lanza: si algo va mal devuelve `null` y quien llama decide.
 */
export async function usuarioDePeticion(
  peticion: Request,
): Promise<UsuarioRuta | null> {
  if (!haySupabase()) return null;

  const cabecera = peticion.headers.get("authorization") ?? "";
  const token = /^bearer /i.test(cabecera) ? cabecera.slice(7).trim() : undefined;

  const cookiesDeLaPeticion = parseCookieHeader(
    peticion.headers.get("cookie") ?? "",
  ).filter((c): c is { name: string; value: string } => c.value != null);

  try {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll: () => cookiesDeLaPeticion,
        // Una ruta de API no renueva la sesión: eso es cosa del middleware.
        setAll: () => {},
      },
    });

    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims?.sub) return null;

    const claims = data.claims;
    return {
      id: claims.sub,
      email: typeof claims.email === "string" ? claims.email : null,
      claims,
    };
  } catch {
    return null;
  }
}

/**
 * Respuesta uniforme para una ruta que exige sesión y no la tiene.
 * Mismo formato que `sinClave()` en `lib/ai/client.ts`.
 */
export function noAutorizado() {
  return Response.json(
    {
      error: "sin_sesion",
      mensaje: "Necesitas haber iniciado sesión para usar esto.",
    },
    { status: 401 },
  );
}

/** Respuesta para cuando la propia instalación no tiene Supabase detrás. */
export function sinSupabase() {
  return Response.json(
    { error: "sin_supabase", mensaje: SIN_SUPABASE },
    { status: 503 },
  );
}

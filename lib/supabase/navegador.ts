import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, haySupabase } from "./config";

/**
 * Cliente de Supabase para el navegador.
 *
 * Devuelve `null` si no hay credenciales: quien lo llama decide qué enseñar,
 * y nunca hay que envolverlo en un try/catch por falta de configuración.
 *
 * Es un singleton perezoso. La sesión se guarda en **cookies** (lo hace
 * `@supabase/ssr` por dentro), no en localStorage, para que el servidor y el
 * middleware puedan leerla en el mismo render.
 */
let cliente: SupabaseClient | null = null;

export function clienteNavegador(): SupabaseClient | null {
  if (!haySupabase()) return null;
  if (!cliente) cliente = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return cliente;
}

/**
 * El token de acceso de la sesión actual, o `null` si no hay ninguna.
 *
 * Hace falta cuando la llamada sale a **otro origen** (el caso de
 * `NEXT_PUBLIC_IA_URL`: la app en Netlify llamando a la API en Railway),
 * porque ahí el navegador no manda las cookies de sesión.
 */
export async function tokenAcceso(): Promise<string | null> {
  const supabase = clienteNavegador();
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Cabeceras con las que llamar a nuestras rutas de API. Objeto vacío si no
 * hay sesión, para poder hacer siempre `{ ...(await cabecerasAuth()) }` sin
 * comprobar nada. Al otro lado lo lee `usuarioDePeticion()`.
 */
export async function cabecerasAuth(): Promise<Record<string, string>> {
  const token = await tokenAcceso();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

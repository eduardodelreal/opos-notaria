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

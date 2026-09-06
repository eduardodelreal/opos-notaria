import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, haySupabase } from "./config";

/**
 * Cliente de Supabase para Server Components, Server Actions y Route Handlers.
 *
 * Hay que crear uno **por petición**: lleva dentro las cookies de esa petición
 * concreta y no se puede compartir entre usuarios.
 *
 * Devuelve `null` si no hay Supabase configurado.
 */
export async function clienteServidor(): Promise<SupabaseClient | null> {
  if (!haySupabase()) return null;

  const almacen = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => almacen.getAll(),
      setAll: (aEscribir) => {
        try {
          for (const { name, value, options } of aEscribir) {
            almacen.set(name, value, options);
          }
        } catch {
          // Desde un Server Component no se pueden escribir cookies. No pasa
          // nada: el middleware ya refresca la sesión en cada navegación.
        }
      },
    },
  });
}

/**
 * El usuario de la petición actual, verificado contra Supabase, o `null`.
 * Pensado para Server Components. Nunca lanza.
 */
export async function usuarioServidor(): Promise<User | null> {
  const supabase = await clienteServidor();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getUser();
    return error ? null : (data.user ?? null);
  } catch {
    return null;
  }
}

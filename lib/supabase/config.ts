/**
 * Configuración de Supabase.
 *
 * Supabase es **opcional**, igual que `ANTHROPIC_API_KEY`: si faltan las
 * credenciales la app arranca y funciona entera en local (IndexedDB), y
 * simplemente no ofrece iniciar sesión. Nunca se lanza una excepción por
 * no tener Supabase configurado.
 *
 * Las dos variables se leen escritas literalmente (`process.env.NEXT_PUBLIC_…`)
 * porque Next solo sustituye las `NEXT_PUBLIC_*` en el bundle del navegador
 * cuando aparecen así, sin desestructurar ni acceder por índice. Por el mismo
 * motivo se fijan **en tiempo de build**: en Netlify o Railway hay que
 * declararlas antes de compilar, no solo en runtime.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * Aceptamos la URL solo si es una URL http(s) de verdad. Así un `.env` a
 * medio rellenar (`https://TU-PROYECTO.supabase.co` sin sustituir, una cadena
 * vacía con espacios) se comporta como "no configurado" en vez de reventar
 * dentro del cliente de Supabase.
 */
function urlValida(valor: string): boolean {
  if (!valor.trim()) return false;
  try {
    const u = new URL(valor);
    return (
      (u.protocol === "https:" || u.protocol === "http:") &&
      !u.hostname.toUpperCase().includes("TU-PROYECTO")
    );
  } catch {
    return false;
  }
}

/** ¿Está esta instalación conectada a un proyecto de Supabase? */
export function haySupabase(): boolean {
  return Boolean(SUPABASE_ANON_KEY.trim()) && urlValida(SUPABASE_URL);
}

/**
 * Mensaje único para cuando alguien pide algo de sesión sin Supabase detrás.
 * Se usa tanto en la interfaz como en las respuestas de las rutas de API.
 */
export const SIN_SUPABASE =
  "Esta instalación no tiene Supabase configurado, así que no hay cuentas ni sincronización. La app funciona igual: todo se guarda en este navegador.";

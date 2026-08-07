import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const AUDIO_BUCKET = (import.meta.env.VITE_SUPABASE_AUDIO_BUCKET as string) || 'cantes'

/**
 * Si no hay credenciales, la app arranca en MODO LOCAL: todo vive en el
 * localStorage del navegador. Así se puede probar sin backend y el deploy en
 * Netlify nunca queda en pantalla blanca por falta de variables de entorno.
 */
export const hasSupabase = Boolean(url && anon && url.startsWith('http'))

export const supabase: SupabaseClient | null = hasSupabase
  ? createClient(url!, anon!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

export function describeBackend(): string {
  return hasSupabase ? 'Supabase' : 'Local (este navegador)'
}

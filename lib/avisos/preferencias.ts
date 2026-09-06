/**
 * Preferencias de aviso y lista de dispositivos, contra Supabase.
 *
 * Se escribe DIRECTO en Supabase y no en el store local a propósito: quien
 * decide los avisos es un cron que corre en Railway y solo ve la base de
 * datos. Una preferencia que viviera en IndexedDB y esperara al próximo
 * empujón de la sincronización llegaría tarde —o no llegaría— al único sitio
 * donde sirve para algo. Además son ajustes de servidor, no expediente: no
 * tiene sentido tenerlos offline.
 *
 * Todas las escrituras van con la clave anon y las protege la RLS de
 * db/migrations/0001 y 0003: cada opositor solo ve y toca sus filas.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PREFERENCIAS_POR_DEFECTO,
  type PreferenciasAviso,
  type SuscripcionAviso,
  type TipoAviso,
} from "./tipos";

const TIPOS_VALIDOS: TipoAviso[] = ["oxido", "repaso", "racha", "simulacro"];

/** Fila `perfiles` → preferencias de la app. Tolerante: cualquier basura cae al defecto. */
function desdeFila(fila: Record<string, unknown> | null): PreferenciasAviso {
  if (!fila) return { ...PREFERENCIAS_POR_DEFECTO };
  const dias = Array.isArray(fila.aviso_dias)
    ? (fila.aviso_dias as unknown[]).map(Number).filter((d) => d >= 1 && d <= 7)
    : PREFERENCIAS_POR_DEFECTO.dias;
  const tipos = Array.isArray(fila.aviso_tipos)
    ? (fila.aviso_tipos as unknown[]).filter((t): t is TipoAviso =>
        TIPOS_VALIDOS.includes(t as TipoAviso),
      )
    : PREFERENCIAS_POR_DEFECTO.tipos;
  return {
    activos: fila.avisos_activos === true,
    // Postgres devuelve un `time` como "20:00:00"; el input del navegador
    // quiere "20:00".
    hora: typeof fila.aviso_hora === "string" ? fila.aviso_hora.slice(0, 5) : "20:00",
    dias,
    tipos,
  };
}

export async function leerPreferencias(
  supabase: SupabaseClient,
): Promise<{ preferencias: PreferenciasAviso; error?: string }> {
  const { data, error } = await supabase
    .from("perfiles")
    .select("avisos_activos, aviso_hora, aviso_dias, aviso_tipos")
    .maybeSingle();

  if (error)
    return { preferencias: { ...PREFERENCIAS_POR_DEFECTO }, error: error.message };
  return { preferencias: desdeFila(data) };
}

/**
 * Guarda solo lo que cambia.
 *
 * Va con `upsert` y no con `update` porque el perfil lo crea un trigger en el
 * alta (0001) y, si por lo que fuera no existiera la fila, un `update` no
 * afectaría a ninguna y el ajuste se perdería en silencio. `updated_at` no se
 * manda nunca: lo pone el servidor, que es el único reloj fiable.
 */
export async function guardarPreferencias(
  supabase: SupabaseClient,
  usuarioId: string,
  cambios: Partial<PreferenciasAviso>,
): Promise<{ ok: boolean; error?: string }> {
  const fila: Record<string, unknown> = { id: usuarioId };
  if (cambios.activos !== undefined) fila.avisos_activos = cambios.activos;
  if (cambios.hora !== undefined) fila.aviso_hora = cambios.hora;
  if (cambios.dias !== undefined) fila.aviso_dias = [...cambios.dias].sort();
  if (cambios.tipos !== undefined) fila.aviso_tipos = cambios.tipos;

  const { error } = await supabase.from("perfiles").upsert(fila, { onConflict: "id" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Los aparatos suscritos y vivos del opositor, del más reciente al más viejo. */
export async function listarDispositivos(
  supabase: SupabaseClient,
): Promise<{ dispositivos: SuscripcionAviso[]; error?: string }> {
  const { data, error } = await supabase
    .from("suscripciones_aviso")
    .select("id, endpoint, clave_p256dh, clave_auth, user_agent, zona_horaria, ultimo_envio")
    .is("deleted_at", null)
    // Una suscripción caducada (el servicio push respondió 404/410) no sirve
    // para nada y enseñarla solo confunde: el aparato ya no recibe.
    .is("caducada_at", null)
    .order("creado_at", { ascending: false });

  if (error) return { dispositivos: [], error: error.message };

  return {
    dispositivos: (data ?? []).map((f) => ({
      id: String(f.id),
      endpoint: String(f.endpoint),
      claveP256dh: String(f.clave_p256dh),
      claveAuth: String(f.clave_auth),
      userAgent: String(f.user_agent ?? ""),
      zonaHoraria: String(f.zona_horaria ?? "Europe/Madrid"),
      ultimoEnvio: f.ultimo_envio ? Date.parse(String(f.ultimo_envio)) : null,
    })),
  };
}

/**
 * "Chrome en Android", "Safari en Mac". Del user agent solo interesa lo justo
 * para que el opositor reconozca cuál de sus aparatos es cuál.
 */
export function nombreDispositivo(userAgent: string): string {
  const ua = userAgent || "";
  const navegador =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "Navegador";
  const sistema =
    /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Windows/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "Mac"
    : /Linux/.test(ua) ? "Linux"
    : "";
  return sistema ? `${navegador} en ${sistema}` : navegador;
}

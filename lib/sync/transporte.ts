import type { SupabaseClient } from "@supabase/supabase-js";
import { CONFLICTO, iso, type Fila, type Tabla } from "./tablas";

/* ============================================================
   El transporte

   Todo lo que sabe de red vive detrás de esta interfaz: dos verbos, subir
   y bajar. El motor no importa `@supabase/supabase-js` en ninguna parte.

   No es una capa de abstracción por gusto. Es lo que permite ejercitar el
   ciclo completo —push, arbitraje del trigger, pull, fusión— contra un
   PostgreSQL de verdad en las pruebas (pruebas/sincronizacion.mjs), con el
   esquema real de db/migrations/ y la RLS puesta, en vez de contra un doble
   que siempre da la razón. Los fallos que importan aquí (una columna que no
   existe, un arbitraje que no arbitra, una FK) solo aparecen contra la base.
   ============================================================ */

export interface Transporte {
  /** El opositor de esta sesión. Va denormalizado en todas las filas (§2). */
  usuarioId: string;
  /**
   * `upsert ... returning *`. Lo que devuelve es la fila GANADORA del
   * arbitraje, que puede no ser la que se mandó: si el servidor tenía una
   * versión más nueva, `tocar_updated_at()` devuelve OLD y aquí llega esa.
   * Adoptarla en el acto ahorra esperar al siguiente pull (§4).
   */
  subir(tabla: Tabla, filas: Fila[]): Promise<Fila[]>;
  /**
   * `select * where usuario_id = uid and updated_at > desde order by updated_at`.
   * SIN filtrar `deleted_at`: las tumbas tienen que bajar o el borrado no
   * viaja (§3.2).
   */
  bajar(tabla: Tabla, desde: number, limite: number): Promise<Fila[]>;
}

/** `perfiles` es la única tabla sin `usuario_id`: su RLS va contra la PK. */
function columnaUsuario(tabla: Tabla): string {
  return tabla === "perfiles" ? "id" : "usuario_id";
}

export class ErrorSync extends Error {
  constructor(
    mensaje: string,
    readonly tabla: Tabla,
    readonly causa?: unknown,
  ) {
    super(mensaje);
    this.name = "ErrorSync";
  }
}

export function transporteSupabase(
  cliente: SupabaseClient,
  usuarioId: string,
): Transporte {
  return {
    usuarioId,

    async subir(tabla, filas) {
      if (!filas.length) return [];
      const { data, error } = await cliente
        .from(tabla)
        .upsert(filas, { onConflict: CONFLICTO[tabla] })
        .select();
      if (error) {
        throw new ErrorSync(`No se ha podido subir «${tabla}»: ${error.message}`, tabla, error);
      }
      return (data ?? []) as Fila[];
    },

    async bajar(tabla, desde, limite) {
      const { data, error } = await cliente
        .from(tabla)
        .select("*")
        .eq(columnaUsuario(tabla), usuarioId)
        .gt("updated_at", iso(desde))
        .order("updated_at", { ascending: true })
        .limit(limite);
      if (error) {
        throw new ErrorSync(`No se ha podido bajar «${tabla}»: ${error.message}`, tabla, error);
      }
      return (data ?? []) as Fila[];
    },
  };
}

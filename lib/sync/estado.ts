"use client";

import { create } from "zustand";

/* ============================================================
   Lo que la interfaz necesita saber de la sincronización

   Es estado volátil y por eso vive fuera del store persistido: si la fase
   se guardara en IndexedDB, una app que se cerró sincronizando arrancaría
   diciendo "sincronizando" para siempre. Lo que sí persiste —el cursor, la
   cola y la hora de la última sincronización— está en el store, que es
   donde se puede guardar junto al dato al que se refiere.
   ============================================================ */

export type Fase =
  /** Sin Supabase configurado o sin sesión: aquí no se sincroniza nada. */
  | "inactivo"
  | "sincronizado"
  | "sincronizando"
  | "sin-conexion"
  | "error";

interface EstadoSync {
  fase: Fase;
  /** Detalle del último error, para Ajustes. Vacío si no lo hubo. */
  mensaje: string;
  /** Cuándo se volverá a intentar tras un fallo (ms). 0 = no hay espera. */
  proximoIntento: number;
  set: (parcial: Partial<Omit<EstadoSync, "set">>) => void;
}

export const useEstadoSync = create<EstadoSync>((set) => ({
  fase: "inactivo",
  mensaje: "",
  proximoIntento: 0,
  set: (parcial) => set(parcial),
}));

/** Fuera de React (el servicio, que no es un componente). */
export function ponerEstado(parcial: Partial<Omit<EstadoSync, "set">>): void {
  useEstadoSync.getState().set(parcial);
}

/** El texto que ve el opositor. Corto: es un indicador, no un informe. */
export function etiquetaFase(fase: Fase): string {
  switch (fase) {
    case "sincronizando":
      return "Sincronizando";
    case "sincronizado":
      return "Sincronizado";
    case "sin-conexion":
      return "Sin conexión";
    case "error":
      return "Sin sincronizar";
    case "inactivo":
      return "Solo en este equipo";
  }
}

/** Color del punto del indicador. Todos son tokens de app/globals.css. */
export function colorFase(fase: Fase): string {
  switch (fase) {
    case "sincronizado":
      return "var(--ok)";
    case "sincronizando":
      return "var(--info)";
    case "sin-conexion":
      return "var(--warn)";
    case "error":
      return "var(--danger)";
    case "inactivo":
      return "var(--fg-subtle)";
  }
}

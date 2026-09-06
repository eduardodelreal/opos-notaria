import { get, set, del } from "idb-keyval";
import type { StateStorage } from "zustand/middleware";

/**
 * Persistencia offline-first en IndexedDB.
 * El opositor estudia en bibliotecas con wifi malo: si se pierde un cante,
 * se pierde el usuario. Todo se escribe en local y la nube (cuando se
 * conecte Supabase) sería solo una réplica.
 *
 * Durante el prerender en servidor no hay IndexedDB: ahí el almacén es un
 * no-op para que el build no reviente ni escriba nada.
 */
const enNavegador = typeof window !== "undefined" && typeof indexedDB !== "undefined";

export const idbStorage: StateStorage = {
  getItem: async (nombre) => {
    if (!enNavegador) return null;
    try {
      return (await get(nombre)) ?? null;
    } catch {
      return null;
    }
  },
  setItem: async (nombre, valor) => {
    if (!enNavegador) return;
    try {
      await set(nombre, valor);
    } catch {
      /* cuota llena o modo incógnito: no rompemos la sesión en curso */
    }
  },
  removeItem: async (nombre) => {
    if (!enNavegador) return;
    try {
      await del(nombre);
    } catch {
      /* ignorado a propósito */
    }
  },
};

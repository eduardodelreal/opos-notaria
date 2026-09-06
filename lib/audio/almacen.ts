import { clear, createStore, del, get, keys, set } from "idb-keyval";

/* ============================================================
   Dónde vive el binario del cante

   En un almacén de IndexedDB PROPIO, no en el estado del store.

   El store se serializa entero a JSON en cada escritura
   (zustand/persist + lib/store/persist.ts). Un cante de diez minutos en
   opus ronda los 5 MB; si el blob viviera en el estado, cada tecla de
   fallo marcada durante el cante reescribiría esos megas en IndexedDB, y
   además en base64 —JSON no sabe de binarios— con un 33 % extra de tamaño.
   El cante es justo el momento en el que la app no se puede permitir una
   pausa. Así que aquí solo hay blobs, indexados por el id del cante, y en
   el store queda la ficha (`Cante.audio`), que pesa unos bytes.

   La clave es el id del cante, así que el blob se encuentra sin necesidad
   de índice ninguno y sobrevive a que el store se rehidrate, se fusione o
   se le apliquen filas del servidor.

   Todo lo de aquí es "mejor esfuerzo": si IndexedDB falla (modo incógnito,
   cuota llena) se devuelve null y la app sigue. La grabación es un extra,
   nunca un requisito.
   ============================================================ */

const enNavegador = typeof indexedDB !== "undefined";

/**
 * Base de datos separada de la del store, a propósito: así una purga de
 * audios no toca el expediente, y `borrarTodo()` puede vaciar las dos sin
 * que una dependa de la otra.
 */
const almacen = enNavegador
  ? createStore("opos-notaria-audio", "cantes")
  : undefined;

export interface AudioGuardado {
  blob: Blob;
  mime: string;
  /** Duración medida al grabar. El blob de MediaRecorder no siempre la trae. */
  segundos: number;
  creado: number;
}

/** Guarda (o reemplaza) la grabación de un cante. `false` si no se pudo. */
export async function guardarAudio(
  canteId: string,
  audio: AudioGuardado,
): Promise<boolean> {
  if (!almacen) return false;
  try {
    await set(canteId, audio, almacen);
    return true;
  } catch {
    // Cuota llena o almacenamiento bloqueado: el cante ya está guardado sin
    // audio, que es lo que de verdad importa.
    return false;
  }
}

export async function leerAudio(canteId: string): Promise<AudioGuardado | null> {
  if (!almacen) return null;
  try {
    return (await get<AudioGuardado>(canteId, almacen)) ?? null;
  } catch {
    return null;
  }
}

export async function borrarAudio(canteId: string): Promise<void> {
  if (!almacen) return;
  try {
    await del(canteId, almacen);
  } catch {
    /* ignorado: un blob huérfano no rompe nada */
  }
}

/**
 * Vacía el almacén entero. Lo llama «Borrar todo» de Ajustes: si no, el
 * expediente desaparecería y las grabaciones —que son lo que de verdad
 * ocupa— se quedarían ahí, invisibles y sin nada a lo que pertenecer.
 */
export async function vaciarAudios(): Promise<void> {
  if (!almacen) return;
  try {
    await clear(almacen);
  } catch {
    /* ignorado: no puede impedir el borrado del expediente */
  }
}

/** Ids de cante con grabación en este dispositivo. */
export async function idsConAudio(): Promise<string[]> {
  if (!almacen) return [];
  try {
    return (await keys(almacen)).map(String);
  } catch {
    return [];
  }
}

/**
 * Bytes ocupados por las grabaciones. Se recorre entero porque IndexedDB no
 * sabe sumar; son decenas de entradas, no millones.
 */
export async function bytesOcupados(): Promise<number> {
  if (!almacen) return 0;
  let total = 0;
  for (const id of await idsConAudio()) {
    const a = await leerAudio(id);
    total += a?.blob.size ?? 0;
  }
  return total;
}

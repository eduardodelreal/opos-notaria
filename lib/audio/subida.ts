import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cante } from "../data/types";
import { vivos } from "../data/vivos";
import { useStore } from "../store/store";
import { borrarAudio, idsConAudio, leerAudio } from "./almacen";
import { extensionDe } from "./grabadora";

/* ============================================================
   La cola de binarios (docs/sincronizacion.md §8)

   El orden no es negociable y es este:

     1. el cante se guarda en IndexedDB con su blob      (siempre, sin red)
     2. la fila de `cantes` sube con el push normal      (barata, va siempre)
     3. el binario sube aparte, cuando hay sesión y red  (esto)

   Si (3) falla no pasa nada: la fila ya está a salvo y el audio se
   reintenta. Al revés —esperar al audio para subir la fila— es justo el
   escenario que pierde el cante en la biblioteca con wifi malo.

   ¿Por qué NO se extiende la cola de lib/sync/cola.ts?

   Esa cola guarda `{tabla, id}` y su valor entero está en que el push lee
   la fila del estado ACTUAL. Un binario no es una fila: no está en el
   expediente, no lo toca `escribir()`, no lo sella el reloj y no cabe en
   `filasParaPush`. Meterlo ahí obligaría a inventar una tabla falsa que se
   colaría en el orden de claves ajenas y en `porTabla`, y a que el push de
   filas —que tiene que ser barato— arrastrara megabytes.

   Y además no hace falta cola: **los pendientes se derivan del propio
   dato**. Pendiente = hay blob en local y la ficha del cante no dice
   `subido`. Una cola que se deduce no se puede desincronizar del dato al
   que se refiere, que es el fallo clásico de las colas paralelas (una
   entrada apuntando a un blob que ya no está, o un blob sin entrada que no
   sube nunca).

   El backoff sí vive en memoria: es estado volátil, como el de
   lib/sync/estado.ts, y reiniciarlo al recargar es lo correcto.
   ============================================================ */

export const BUCKET = "cantes-audio";

/** Caducidad de la URL firmada. Corta: se regenera sin coste al reproducir. */
const SEGUNDOS_FIRMA = 300;

const ESPERA_MINIMA = 5_000;
const ESPERA_MAXIMA = 10 * 60_000;

/** Fallos consecutivos por cante y hasta cuándo no se reintenta. */
const reintentos = new Map<string, { fallos: number; hasta: number }>();

/**
 * Ruta dentro del bucket. El PRIMER SEGMENTO ES EL UID y de eso depende
 * toda la seguridad de Storage: las políticas comparan ese segmento con
 * `auth.uid()`, así que un opositor no puede leer ni escribir fuera de su
 * carpeta (db/migrations/0002_storage_audio.sql).
 */
export function rutaAudio(usuarioId: string, canteId: string, mime?: string): string {
  return `${usuarioId}/${canteId}.${extensionDe(mime)}`;
}

function esperaDe(canteId: string): number {
  return reintentos.get(canteId)?.hasta ?? 0;
}

function apuntarFallo(canteId: string): void {
  const previo = reintentos.get(canteId)?.fallos ?? 0;
  const fallos = previo + 1;
  const espera = Math.min(ESPERA_MAXIMA, ESPERA_MINIMA * 2 ** (fallos - 1));
  reintentos.set(canteId, { fallos, hasta: Date.now() + espera });
}

export interface ResumenAudios {
  subidos: number;
  fallidos: number;
  purgados: number;
}

/**
 * Sube los binarios pendientes y purga los de cantes enterrados.
 *
 * Lo llama el servicio de sincronización DESPUÉS del ciclo de filas, así
 * que hereda su bloqueo durante el cante: aquí no se sube nada mientras el
 * opositor está cantando.
 */
export async function sincronizarAudios(
  cliente: SupabaseClient,
  usuarioId: string,
): Promise<ResumenAudios> {
  const resumen: ResumenAudios = { subidos: 0, fallidos: 0, purgados: 0 };
  const locales = await idsConAudio();
  if (!locales.length) return resumen;

  const cantes = useStore.getState().cantes;
  const porId = new Map(cantes.map((c) => [c.id, c]));

  for (const canteId of locales) {
    const cante = porId.get(canteId);

    // Cante enterrado, o blob de un cante que ya no existe: el audio es un
    // adjunto de la fila y sin ella no pinta nada. Aquí SÍ hay borrado
    // físico, al contrario que en las tablas: la tumba que viaja es la fila
    // de `cantes`, y pagar almacenamiento por el audio de un cante borrado
    // no tiene sentido (0002).
    if (!cante || cante.borrado != null) {
      await borrarAudio(canteId);
      if (cante?.audio?.path) {
        try {
          await cliente.storage.from(BUCKET).remove([cante.audio.path]);
        } catch {
          /* si falla, queda un objeto huérfano; no rompe nada */
        }
      }
      resumen.purgados += 1;
      continue;
    }

    if (cante.audio?.subido) continue;
    if (Date.now() < esperaDe(canteId)) continue;

    const guardado = await leerAudio(canteId);
    if (!guardado) continue;

    const path = rutaAudio(usuarioId, canteId, guardado.mime);
    try {
      const { error } = await cliente.storage
        .from(BUCKET)
        .upload(path, guardado.blob, {
          contentType: guardado.mime,
          // Reintentar una subida cortada tiene que poder pisar el objeto
          // anterior; la política de update del bucket lo permite.
          upsert: true,
        });
      if (error) throw error;

      reintentos.delete(canteId);
      resumen.subidos += 1;
      // Pasa por el store (y por tanto por `escribir()`): esto sella el
      // reloj del cante y lo reencola, que es lo que hace que `audio_path`
      // llegue a la fila del servidor.
      useStore.getState().setAudioCante(canteId, {
        path,
        mime: guardado.mime,
        bytes: guardado.blob.size,
        segundos: guardado.segundos,
        subido: Date.now(),
      });
    } catch {
      apuntarFallo(canteId);
      resumen.fallidos += 1;
    }
  }

  return resumen;
}

/**
 * De dónde sale el audio que se reproduce.
 *
 * Primero el blob local, siempre: es instantáneo, funciona sin red y no
 * gasta ancho de banda. Solo si este dispositivo no lo tiene (lo grabó el
 * portátil y estamos en el móvil) se pide una URL firmada.
 *
 * Un 404 al firmar significa "grabación pendiente de subir", no error.
 *
 * Recibe el id y la ruta sueltos, no el cante entero: así quien la llama
 * puede depender solo de esos dos valores y no rehacer la fuente —ni
 * reiniciar el reproductor— cada vez que se edita cualquier otro campo del
 * cante (guardar la transcripción, por ejemplo).
 */
export async function fuenteDeAudio(
  canteId: string,
  path?: string,
): Promise<{ url: string; local: boolean; revocar?: () => void } | null> {
  const guardado = await leerAudio(canteId);
  if (guardado) {
    const url = URL.createObjectURL(guardado.blob);
    return { url, local: true, revocar: () => URL.revokeObjectURL(url) };
  }
  if (!path) return null;

  const { clienteNavegador } = await import("../supabase/navegador");
  const cliente = clienteNavegador();
  if (!cliente) return null;

  try {
    const { data, error } = await cliente.storage
      .from(BUCKET)
      .createSignedUrl(path, SEGUNDOS_FIRMA);
    if (error || !data?.signedUrl) return null;
    return { url: data.signedUrl, local: false };
  } catch {
    return null;
  }
}

/** Descarga a memoria el audio remoto, para poder transcribirlo. */
export async function descargarAudio(cante: Cante): Promise<Blob | null> {
  const guardado = await leerAudio(cante.id);
  if (guardado) return guardado.blob;
  if (!cante.audio?.path) return null;

  const { clienteNavegador } = await import("../supabase/navegador");
  const cliente = clienteNavegador();
  if (!cliente) return null;
  try {
    const { data, error } = await cliente.storage
      .from(BUCKET)
      .download(cante.audio.path);
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Olvida la grabación de un cante: blob local y, si hay sesión, objeto de
 * Storage. Se llama al borrar el cante desde la interfaz; lo que quede sin
 * borrar (sin red en ese momento) lo recoge la purga de `sincronizarAudios`.
 */
export async function olvidarAudio(cante: Cante): Promise<void> {
  await borrarAudio(cante.id);
  if (!cante.audio?.path) return;
  const { clienteNavegador } = await import("../supabase/navegador");
  const cliente = clienteNavegador();
  if (!cliente) return;
  try {
    await cliente.storage.from(BUCKET).remove([cante.audio.path]);
  } catch {
    /* la purga lo reintentará */
  }
}

/** Cantes vivos con grabación pendiente de subir. Para el indicador. */
export async function pendientesDeSubir(): Promise<string[]> {
  const locales = new Set(await idsConAudio());
  if (!locales.size) return [];
  return vivos(useStore.getState().cantes)
    .filter((c) => locales.has(c.id) && !c.audio?.subido)
    .map((c) => c.id);
}

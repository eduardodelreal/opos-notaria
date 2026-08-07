import { AUDIO_BUCKET, supabase } from './supabase'

/**
 * Los audios de los cantes son el activo más pesado de la app (un cante de 12 min
 * en webm/opus a 32 kbps ≈ 3 MB). Se guardan:
 *  - en Supabase Storage, en la carpeta del usuario, cuando hay sesión;
 *  - en IndexedDB del navegador en modo local, para no reventar el localStorage.
 */

const DB_NAME = 'opos-notaria-audio'
const STORE = 'cantes'

function abrirDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
}

async function guardarLocal(clave: string, blob: Blob): Promise<void> {
  const db = await abrirDb()
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, clave)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
  db.close()
}

async function leerLocal(clave: string): Promise<Blob | null> {
  const db = await abrirDb()
  const blob = await new Promise<Blob | null>((res, rej) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(clave)
    req.onsuccess = () => res((req.result as Blob) ?? null)
    req.onerror = () => rej(req.error)
  })
  db.close()
  return blob
}

async function borrarLocal(clave: string): Promise<void> {
  const db = await abrirDb()
  await new Promise<void>((res) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(clave)
    tx.oncomplete = () => res()
    tx.onerror = () => res()
  })
  db.close()
}

/** Devuelve la ruta guardada (prefijo `local:` o ruta del bucket). */
export async function subirAudio(
  canteId: string,
  blob: Blob,
  userId: string | null,
): Promise<string> {
  if (supabase && userId) {
    const ext = blob.type.includes('mp4') ? 'm4a' : 'webm'
    const path = `${userId}/${canteId}.${ext}`
    const { error } = await supabase.storage
      .from(AUDIO_BUCKET)
      .upload(path, blob, { contentType: blob.type, upsert: true })
    if (!error) return path
    console.warn('[audio] fallo al subir, se guarda en local', error.message)
  }
  const clave = `local:${canteId}`
  await guardarLocal(clave, blob)
  return clave
}

/** URL reproducible (objectURL local o signed URL de Storage). */
export async function urlAudio(path: string): Promise<string | null> {
  if (path.startsWith('local:')) {
    const blob = await leerLocal(path)
    return blob ? URL.createObjectURL(blob) : null
  }
  if (!supabase) return null
  const { data, error } = await supabase.storage.from(AUDIO_BUCKET).createSignedUrl(path, 3600)
  if (error) {
    console.warn('[audio] no se pudo firmar la URL', error.message)
    return null
  }
  return data.signedUrl
}

/**
 * Enlace para el preparador: URL firmada de larga duración (7 días por defecto).
 * El preparador es un notario en activo con 10 minutos libres al día: tiene que
 * poder abrir el audio desde el móvil sin instalar nada ni crearse una cuenta.
 * Devuelve null si el audio solo existe en el navegador del opositor.
 */
export async function enlaceParaPreparador(
  path: string,
  segundosValidez = 7 * 24 * 3600,
): Promise<string | null> {
  if (path.startsWith('local:') || !supabase) return null
  const { data, error } = await supabase.storage
    .from(AUDIO_BUCKET)
    .createSignedUrl(path, segundosValidez)
  if (error) {
    console.warn('[audio] no se pudo generar el enlace para el preparador', error.message)
    return null
  }
  return data.signedUrl
}

export async function borrarAudio(path: string): Promise<void> {
  if (path.startsWith('local:')) return borrarLocal(path)
  if (supabase) await supabase.storage.from(AUDIO_BUCKET).remove([path])
}

/* --------------------------------------------------------- grabación ---- */

export interface Grabadora {
  stop(): Promise<{ blob: Blob; segundos: number } | null>
  cancel(): void
  /** Nivel de entrada 0-1 para el visualizador de ondas. */
  nivel(): number
  mimeType: string
}

const CANDIDATOS = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
]

export function mimeSoportado(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return CANDIDATOS.find((m) => MediaRecorder.isTypeSupported(m)) ?? null
}

export async function iniciarGrabacion(): Promise<Grabadora> {
  const mime = mimeSoportado()
  if (!mime) throw new Error('Este navegador no soporta grabación de audio')

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  })

  // 32 kbps mono: voz perfectamente inteligible, ~2,9 MB por cante de 12 min.
  const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  // Medidor de nivel para el visualizador.
  const ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  src.connect(analyser)
  const buf = new Uint8Array(analyser.frequencyBinCount)

  const t0 = performance.now()
  rec.start(4000)

  const limpiar = () => {
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => {})
  }

  return {
    mimeType: mime,
    nivel() {
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128
        sum += v * v
      }
      return Math.min(1, Math.sqrt(sum / buf.length) * 3.2)
    },
    stop() {
      return new Promise((res) => {
        if (rec.state === 'inactive') {
          limpiar()
          return res(null)
        }
        rec.onstop = () => {
          const blob = new Blob(chunks, { type: mime })
          limpiar()
          res({ blob, segundos: (performance.now() - t0) / 1000 })
        }
        rec.stop()
      })
    },
    cancel() {
      try {
        if (rec.state !== 'inactive') rec.stop()
      } catch {
        /* noop */
      }
      limpiar()
    },
  }
}

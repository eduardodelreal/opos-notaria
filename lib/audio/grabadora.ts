import type { MarcaEpigrafe } from "../data/types";

/* ============================================================
   Grabar el cante sin estorbar al cante

   Reglas que manda el modo cante y que este módulo cumple:

   1. El permiso del micrófono se pide ANTES de empezar, nunca a media
      recitación: `pedirPermiso()` abre el stream y lo deja abierto, y
      `empezar()` ya no negocia nada con el navegador.
   2. Ninguna operación durante el cante puede bloquear. `marcar()` es un
      push a un array; `empezar()` y `parar()` no esperan a nada de red.
   3. Todo falla en silencio hacia "sin grabación". Si no hay micrófono, si
      el usuario deniega el permiso o si `MediaRecorder` no existe, el cante
      sigue EXACTAMENTE igual que sin esta función.

   Los trozos se piden con un `timeslice`: así el navegador va entregando
   buffers en vez de construir uno gigante al parar, que es el momento en el
   que el opositor está mirando el resumen y menos tolera un tirón.
   ============================================================ */

const TROZO_MS = 5_000;

/**
 * Contenedores por orden de preferencia. Opus en WebM es lo que graban
 * Chrome y Firefox y lo que mejor comprime la voz (un cante de 10 min pesa
 * unos 5 MB); Safari solo sabe MP4/AAC. Todos están en la lista de tipos
 * permitidos del bucket (db/migrations/0002_storage_audio.sql).
 */
const FORMATOS = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

export interface ResultadoGrabacion {
  blob: Blob;
  mime: string;
  segundos: number;
  marcas: MarcaEpigrafe[];
}

export type EstadoGrabadora = "inactiva" | "lista" | "grabando" | "denegada";

/** ¿Puede este navegador grabar? Sin esto no se pinta ni la casilla. */
export function grabacionSoportada(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

function mejorFormato(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const f of FORMATOS) {
    // isTypeSupported no existe en algún navegador antiguo: si no está, se
    // deja que el navegador elija con la cadena vacía.
    if (typeof MediaRecorder.isTypeSupported !== "function") return "";
    if (MediaRecorder.isTypeSupported(f)) return f;
  }
  return "";
}

/** Extensión del fichero según el contenedor, para la ruta de Storage. */
export function extensionDe(mime: string | undefined): string {
  if (!mime) return "webm";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("wav")) return "wav";
  return "webm";
}

export interface Grabadora {
  estado(): EstadoGrabadora;
  /**
   * Pide el micrófono y deja el stream abierto. Devuelve false si no hay
   * permiso o no hay micrófono: quien llama apaga la grabación y sigue.
   */
  pedirPermiso(): Promise<boolean>;
  /** Arranca. Devuelve false si no había permiso; nunca lanza. */
  empezar(): boolean;
  /** Cierra el epígrafe anterior y abre el siguiente. Coste: un push. */
  marcar(epigrafeId: string, titulo: string): void;
  /** Para y devuelve el audio. `null` si no había nada que devolver. */
  parar(): Promise<ResultadoGrabacion | null>;
  /** Suelta el micrófono sin producir audio (salir a mitad, descartar). */
  soltar(): void;
  /** Milisegundos grabados hasta ahora. Para el indicador. */
  transcurridoMs(): number;
}

export function crearGrabadora(): Grabadora {
  let stream: MediaStream | null = null;
  let rec: MediaRecorder | null = null;
  let trozos: Blob[] = [];
  let inicio = 0;
  let fin = 0;
  let estado: EstadoGrabadora = "inactiva";
  let marcas: MarcaEpigrafe[] = [];
  /** Epígrafe abierto: se cierra en el siguiente `marcar()` o al parar. */
  let abierta: { epigrafeId: string; titulo: string; desdeMs: number } | null = null;

  const cerrarAbierta = (hastaMs: number) => {
    if (!abierta) return;
    marcas.push({ ...abierta, hastaMs });
    abierta = null;
  };

  const soltarStream = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };

  return {
    estado: () => estado,

    async pedirPermiso() {
      if (!grabacionSoportada()) return false;
      if (stream) return true;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            // Un cante es una persona hablando a un metro del portátil: la
            // cancelación de eco y el control de ganancia del navegador
            // hacen la transcripción bastante mejor y no cuestan nada.
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        estado = "lista";
        return true;
      } catch {
        estado = "denegada";
        return false;
      }
    },

    empezar() {
      if (!stream || estado === "grabando") return false;
      try {
        const mime = mejorFormato();
        rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        trozos = [];
        marcas = [];
        abierta = null;
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) trozos.push(e.data);
        };
        rec.start(TROZO_MS);
        inicio = Date.now();
        fin = 0;
        estado = "grabando";
        return true;
      } catch {
        // Un fallo aquí no puede impedir el cante: se cae a "sin grabación".
        rec = null;
        estado = "lista";
        return false;
      }
    },

    marcar(epigrafeId, titulo) {
      if (estado !== "grabando") return;
      const ahora = Date.now() - inicio;
      cerrarAbierta(ahora);
      abierta = { epigrafeId, titulo, desdeMs: ahora };
    },

    parar() {
      const grabador = rec;
      if (!grabador || estado !== "grabando") {
        soltarStream();
        estado = stream ? "lista" : estado;
        return Promise.resolve(null);
      }
      fin = Date.now();
      cerrarAbierta(fin - inicio);
      estado = "inactiva";

      return new Promise<ResultadoGrabacion | null>((resolver) => {
        // `onstop` llega después del último `ondataavailable`, así que aquí
        // ya están todos los trozos.
        grabador.onstop = () => {
          soltarStream();
          rec = null;
          if (!trozos.length) return resolver(null);
          const mime = grabador.mimeType || trozos[0].type || "audio/webm";
          const blob = new Blob(trozos, { type: mime });
          trozos = [];
          resolver({
            blob,
            mime,
            segundos: Math.max(1, Math.round((fin - inicio) / 1000)),
            marcas,
          });
        };
        try {
          grabador.stop();
        } catch {
          soltarStream();
          rec = null;
          resolver(null);
        }
      });
    },

    soltar() {
      try {
        if (rec && rec.state !== "inactive") rec.stop();
      } catch {
        /* da igual: vamos a tirar el resultado */
      }
      rec = null;
      trozos = [];
      abierta = null;
      soltarStream();
      estado = "inactiva";
    },

    transcurridoMs() {
      if (estado !== "grabando") return Math.max(0, fin - inicio);
      return Date.now() - inicio;
    },
  };
}

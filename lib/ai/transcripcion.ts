import "server-only";

/* ============================================================
   Transcribir el cante: por qué esto no lo hace Claude

   Se comprobó antes de escribir una línea (docs/ia.md, "Audio"): la
   Messages API de Anthropic **no acepta audio**. Sus bloques de contenido
   son `text`, `image` (jpeg/png/gif/webp), `document` (application/pdf y
   text/plain), `search_result` y `container_upload`; la Files API acepta
   esos mismos tipos y datasets para el code execution tool, y no hay
   endpoint de transcripción. Los únicos audios que aparecen en la
   documentación son ficheros que el modelo GENERA dentro del sandbox de
   ejecución de código, no entradas del modelo. Mandar un webm en base64
   como si fuera un `document` no funciona: la petición se rechaza.

   Así que la transcripción sale de un servicio aparte y la comparación
   —que es texto contra texto— sí la hace Claude, que es donde aporta.

   El proveedor se configura con tres variables y habla el dialecto
   `POST /audio/transcriptions` de OpenAI, que es el que implementan también
   Groq, Deepgram (modo compatible), faster-whisper y whisper.cpp servidos
   en local:

     TRANSCRIPCION_API_KEY   sin ella, la función se apaga y se dice
     TRANSCRIPCION_URL       por defecto https://api.openai.com/v1
     TRANSCRIPCION_MODELO    por defecto whisper-1

   Sin la clave la app funciona EXACTAMENTE igual que hoy: se graba, se
   guarda y se reproduce; solo no hay transcripción ni comparación, y la
   interfaz lo dice en vez de fingir que se está procesando.
   ============================================================ */

/** 25 MB es el tope de la API de Whisper; dejamos margen para el multipart. */
export const MAX_BYTES = 24 * 1024 * 1024;

export function urlTranscripcion(): string {
  return (process.env.TRANSCRIPCION_URL || "https://api.openai.com/v1").replace(
    /\/+$/,
    "",
  );
}

export function modeloTranscripcion(): string {
  return process.env.TRANSCRIPCION_MODELO || "whisper-1";
}

export function hayTranscripcion(): boolean {
  return Boolean(process.env.TRANSCRIPCION_API_KEY);
}

/** Lo que se guarda junto al cante para saber de dónde salió el texto. */
export function motorTranscripcion(): string {
  try {
    return `${new URL(urlTranscripcion()).hostname}/${modeloTranscripcion()}`;
  } catch {
    return modeloTranscripcion();
  }
}

/** Respuesta uniforme cuando no hay proveedor configurado. */
export function sinTranscripcion(): Response {
  return Response.json(
    {
      error: "sin_transcripcion",
      mensaje:
        "No hay servicio de transcripción configurado. La API de Anthropic no acepta audio, " +
        "así que la transcripción necesita un proveedor compatible con Whisper: pon " +
        "TRANSCRIPCION_API_KEY (y, si no usas OpenAI, TRANSCRIPCION_URL y TRANSCRIPCION_MODELO) " +
        "en .env.local y reinicia. Grabar y reproducir el cante funciona sin esto.",
    },
    { status: 503 },
  );
}

export interface Transcrito {
  texto: string;
  segundos?: number;
}

/**
 * Llama al proveedor. `pista` es vocabulario del tema (título y epígrafes):
 * Whisper la usa para no destrozar los tecnicismos jurídicos, que es
 * precisamente lo que hay que comparar después. Va recortada porque el
 * campo tiene un límite corto y lo que sobra se ignora.
 */
export async function transcribir(
  audio: Blob,
  opciones: { pista?: string; senal?: AbortSignal } = {},
): Promise<Transcrito> {
  const cuerpo = new FormData();
  // El nombre del fichero importa: algunos servidores deducen el
  // contenedor de la extensión y rechazan un "blob" sin ella.
  const ext = (audio.type.split("/")[1] || "webm").split(";")[0];
  cuerpo.append("file", audio, `cante.${ext === "mpeg" ? "mp3" : ext}`);
  cuerpo.append("model", modeloTranscripcion());
  cuerpo.append("language", "es");
  cuerpo.append("response_format", "json");
  if (opciones.pista) cuerpo.append("prompt", opciones.pista.slice(0, 800));

  const r = await fetch(`${urlTranscripcion()}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.TRANSCRIPCION_API_KEY}` },
    body: cuerpo,
    signal: opciones.senal,
  });

  if (!r.ok) {
    const detalle = await r.text().catch(() => "");
    const error = new Error(
      r.status === 401
        ? "La clave del servicio de transcripción no es válida."
        : r.status === 429
          ? "El servicio de transcripción ha limitado las peticiones. Prueba en unos minutos."
          : `El servicio de transcripción ha respondido ${r.status}. ${detalle.slice(0, 300)}`,
    );
    (error as { status?: number }).status = r.status;
    throw error;
  }

  const datos = (await r.json()) as { text?: string; duration?: number };
  return {
    texto: (datos.text ?? "").trim(),
    segundos: typeof datos.duration === "number" ? Math.round(datos.duration) : undefined,
  };
}

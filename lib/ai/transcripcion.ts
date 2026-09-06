import "server-only";

/* ============================================================
   Transcribir el cante: por qué esto no lo hace el adaptador de texto

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
   —que es texto contra texto— sí la hace el modelo, que es donde aporta.

   Con OpenAI la foto cambia a medias: OpenAI SÍ tiene transcripción, pero
   en OTRO endpoint (`/audio/transcriptions`), no en la Responses API que
   usa el adaptador de texto. Es decir, el reparto sigue siendo el mismo;
   lo único que cambia es que, si el opositor ya tiene clave de OpenAI, no
   necesita una segunda para el audio.

   El proveedor habla el dialecto `POST /audio/transcriptions` de OpenAI,
   que es el que implementan también Groq, Deepgram (modo compatible),
   faster-whisper y whisper.cpp servidos en local:

     TRANSCRIPCION_API_KEY   opcional (ver abajo)
     TRANSCRIPCION_URL       por defecto https://api.openai.com/v1
     TRANSCRIPCION_MODELO    por defecto whisper-1

   DE DÓNDE SALE LA CLAVE
   ----------------------
   Desde que la app puede hablar con OpenAI para el texto (lib/ai/proveedor.ts),
   pedir DOS claves de la misma casa para lo mismo era una tontería. Así que:

     1. Si hay `TRANSCRIPCION_API_KEY`, se usa esa y nada más. Manda ella.
     2. Si no la hay pero sí `OPENAI_API_KEY`, se usa la de OpenAI contra
        Whisper. El opositor configura una sola clave y le funciona todo.

   Con un matiz que importa: la clave heredada SOLO se manda si NO se ha
   puesto `TRANSCRIPCION_URL`. Si el opositor apunta la transcripción a
   Groq, a un whisper.cpp de su casa o a cualquier otro sitio, ahí no se
   manda su clave de OpenAI: una credencial solo viaja al servicio que la
   emitió. Para ese caso hay que poner `TRANSCRIPCION_API_KEY` (o dejarla
   vacía, si el servidor local no pide ninguna... entonces la función se
   apaga; es el precio de no filtrar claves por descuido).

   Sin ninguna de las dos la app funciona EXACTAMENTE igual que hoy: se
   graba, se guarda y se reproduce; solo no hay transcripción ni
   comparación, y la interfaz lo dice en vez de fingir que procesa.
   ============================================================ */

/** 25 MB es el tope de la API de Whisper; dejamos margen para el multipart. */
export const MAX_BYTES = 24 * 1024 * 1024;

/**
 * La clave con la que se llama al servicio de audio, o `undefined` si no
 * hay ninguna utilizable. Ver la nota de arriba sobre por qué la clave
 * heredada de OpenAI no sale de api.openai.com.
 */
export function claveTranscripcion(): string | undefined {
  const propia = process.env.TRANSCRIPCION_API_KEY?.trim();
  if (propia) return propia;
  if (process.env.TRANSCRIPCION_URL?.trim()) return undefined;
  return process.env.OPENAI_API_KEY?.trim() || undefined;
}

/** ¿Se está usando la clave del proveedor de texto en vez de una propia? */
export function claveHeredadaDeOpenAI(): boolean {
  return (
    !process.env.TRANSCRIPCION_API_KEY?.trim() &&
    !process.env.TRANSCRIPCION_URL?.trim() &&
    Boolean(process.env.OPENAI_API_KEY?.trim())
  );
}

export function urlTranscripcion(): string {
  const propia = process.env.TRANSCRIPCION_URL?.trim();
  if (propia) return propia.replace(/\/+$/, "");
  // Con la clave heredada, el destino es el mismo servicio que la emitió:
  // así `OPENAI_BASE_URL` (Azure, una pasarela propia) también vale aquí.
  const base = claveHeredadaDeOpenAI()
    ? process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1"
    : "https://api.openai.com/v1";
  return base.replace(/\/+$/, "");
}

export function modeloTranscripcion(): string {
  return process.env.TRANSCRIPCION_MODELO || "whisper-1";
}

export function hayTranscripcion(): boolean {
  return Boolean(claveTranscripcion());
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
        "No hay servicio de transcripción configurado. Ni Anthropic ni la Responses API " +
        "de OpenAI aceptan audio por esta vía, así que la transcripción necesita un " +
        "proveedor compatible con Whisper. Si usas OpenAI para el texto, con OPENAI_API_KEY " +
        "ya vale; si no, pon TRANSCRIPCION_API_KEY (y TRANSCRIPCION_URL y " +
        "TRANSCRIPCION_MODELO si apuntas a otro sitio) en .env.local y reinicia. " +
        "Grabar y reproducir el cante funciona sin esto.",
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
    headers: { Authorization: `Bearer ${claveTranscripcion() ?? ""}` },
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

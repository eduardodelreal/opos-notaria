import { responderPreflight } from "@/lib/ai/cors";
import { protegida } from "@/lib/ai/guardia";
import {
  MAX_BYTES,
  hayTranscripcion,
  motorTranscripcion,
  sinTranscripcion,
  transcribir,
} from "@/lib/ai/transcripcion";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Transcribe la grabación de un cante.
 *
 * OJO: esto NO llama a Anthropic. La Messages API no acepta audio (ver
 * lib/ai/transcripcion.ts, donde está la comprobación y el porqué), así que
 * el audio va a un servicio compatible con Whisper y lo que vuelve —texto—
 * es lo que después compara Claude en /api/ai/comparar-cante.
 *
 * Recibe `multipart/form-data` y no JSON con base64: el binario ya es de
 * megas y el base64 le añade un tercio, que en la subida desde el móvil se
 * nota. El audio se reenvía en streaming al proveedor sin tocar disco.
 */
async function manejar(req: Request) {
  if (!hayTranscripcion()) return sinTranscripcion();

  try {
    const formulario = await req.formData();
    const audio = formulario.get("audio");
    const pista = formulario.get("pista");

    if (!(audio instanceof Blob) || audio.size === 0) {
      return Response.json(
        { error: "peticion", mensaje: "Falta el audio del cante." },
        { status: 400 },
      );
    }
    if (audio.size > MAX_BYTES) {
      return Response.json(
        {
          error: "peticion",
          mensaje:
            "La grabación pesa más de 24 MB y el servicio de transcripción no la acepta. " +
            "Un cante de veinte minutos debería quedarse muy por debajo: revisa el formato.",
        },
        { status: 413 },
      );
    }

    const { texto, segundos } = await transcribir(audio, {
      pista: typeof pista === "string" ? pista : undefined,
      senal: req.signal,
    });

    if (!texto) {
      return Response.json(
        {
          error: "vacia",
          mensaje:
            "La transcripción ha salido vacía. Puede que el micrófono no cogiera nada: " +
            "escucha la grabación antes de volver a intentarlo.",
        },
        { status: 422 },
      );
    }

    return Response.json({
      transcripcion: { texto, segundos, motor: motorTranscripcion() },
    });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return Response.json(
      {
        error: "transcripcion",
        mensaje: err?.message || "Error inesperado transcribiendo el audio.",
      },
      { status: err?.status && err.status >= 400 ? err.status : 502 },
    );
  }
}

/** El navegador manda OPTIONS antes de un POST cross-origin. */
export function OPTIONS(req: Request) {
  return responderPreflight(req);
}

/**
 * La sesión se comprueba fuera de `manejar`: si esta instalación tiene
 * Supabase configurado, sin sesión válida no se llega ni a leer el cuerpo,
 * y por tanto no se gasta un céntimo. Ver `lib/ai/guardia.ts`.
 */
export const POST = protegida(manejar);

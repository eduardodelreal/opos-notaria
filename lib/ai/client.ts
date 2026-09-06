import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const MODELO = process.env.ANTHROPIC_MODEL || "claude-opus-5";

export function hayClave(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let cliente: Anthropic | null = null;

export function getCliente(): Anthropic {
  if (!cliente) cliente = new Anthropic();
  return cliente;
}

/** Respuesta uniforme cuando la app no tiene clave configurada. */
export function sinClave() {
  return Response.json(
    {
      error: "sin_clave",
      mensaje:
        "Falta ANTHROPIC_API_KEY. Copia .env.example a .env.local, pon tu clave y reinicia el servidor. El resto de la app funciona sin ella.",
    },
    { status: 503 },
  );
}

/** Extrae el texto plano de una respuesta de la API. */
export function textoDe(mensaje: Anthropic.Message): string {
  return mensaje.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * Los clasificadores de seguridad pueden declinar una petición (HTTP 200,
 * stop_reason "refusal"). Con contenido jurídico es improbable, pero si
 * pasa devolvemos un mensaje claro en vez de un JSON vacío.
 */
export function esRechazo(mensaje: Anthropic.Message): boolean {
  return mensaje.stop_reason === "refusal";
}

export function errorApi(e: unknown) {
  const err = e as { status?: number; message?: string };
  const status = err?.status ?? 500;
  const mensaje =
    status === 401
      ? "La clave de la API no es válida."
      : status === 429
        ? "Has superado el límite de peticiones. Prueba en unos segundos."
        : err?.message || "Error inesperado llamando al modelo.";
  return Response.json({ error: "api", mensaje }, { status });
}

import "server-only";

/**
 * CORS para las rutas de IA.
 *
 * Cuando la app vive en Netlify y el backend de IA en Railway (porque las
 * funciones de Netlify cortan a los 10-30 s y las respuestas del modelo
 * tardan minutos), el navegador llama a `/api/ai/*` a otro dominio. Sin
 * cabeceras CORS el navegador lo bloquea antes de que salga la petición.
 *
 * `ORIGENES_PERMITIDOS` es una lista separada por comas con los dominios
 * desde los que se sirve la app, por ejemplo:
 *   ORIGENES_PERMITIDOS=https://opos-notaria.netlify.app,https://opos-notaria.com
 *
 * Si no está definida no se emite ninguna cabecera: en un despliegue de una
 * sola pieza (solo Railway, o local) las llamadas son del mismo origen y
 * CORS no pinta nada. Abrir a `*` sería gratis de escribir y una mala idea:
 * estos endpoints gastan dinero en cada llamada.
 */

function permitidos(): string[] {
  return (process.env.ORIGENES_PERMITIDOS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/** Cabeceras CORS para este origen, o vacío si no está en la lista. */
export function cabecerasCors(req: Request): Record<string, string> {
  const origen = req.headers.get("origin");
  if (!origen) return {};

  const lista = permitidos();
  if (!lista.includes(origen.replace(/\/+$/, ""))) return {};

  return {
    "Access-Control-Allow-Origin": origen,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    // Sin esto, un proxy o CDN podría servirle a un origen la respuesta
    // cacheada de otro.
    Vary: "Origin",
    "Access-Control-Max-Age": "86400",
  };
}

/** Respuesta al preflight `OPTIONS` que manda el navegador antes del POST. */
export function responderPreflight(req: Request): Response {
  return new Response(null, { status: 204, headers: cabecerasCors(req) });
}

/** Añade las cabeceras CORS a una respuesta ya construida. */
export function conCors(respuesta: Response, req: Request): Response {
  const cabeceras = cabecerasCors(req);
  for (const [clave, valor] of Object.entries(cabeceras)) {
    respuesta.headers.set(clave, valor);
  }
  return respuesta;
}

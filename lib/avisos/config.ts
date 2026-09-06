/**
 * Configuración de los avisos push.
 *
 * Mismo trato que `ANTHROPIC_API_KEY` y que Supabase: los avisos son
 * **opcionales**. Sin clave VAPID pública la app arranca igual, el
 * componente de ajustes no se pinta y no se lanza ni una excepción.
 *
 * La variable se lee escrita literalmente (`process.env.NEXT_PUBLIC_…`)
 * porque Next solo sustituye las `NEXT_PUBLIC_*` en el bundle del navegador
 * cuando aparecen así. Y como se sustituye EN TIEMPO DE BUILD, hay que
 * declararla antes de compilar, no solo en runtime.
 *
 * La pareja privada de esta clave (`VAPID_PRIVATE_KEY`) NO se lee nunca
 * desde aquí ni desde ningún fichero de `app/` o `lib/` que acabe en el
 * bundle: vive únicamente en el entorno del cron (scripts/enviar-avisos.ts).
 * La pública, en cambio, es pública por diseño: viaja al navegador dentro de
 * la suscripción y no protege nada por sí sola.
 */

export const VAPID_PUBLICA = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/**
 * Una clave VAPID pública es un punto P-256 sin comprimir (65 bytes) en
 * base64url: 87 caracteres que empiezan por 'B'. Comprobarlo evita que un
 * `.env` a medio rellenar llegue hasta `pushManager.subscribe()`, donde el
 * fallo es un `InvalidCharacterError` incomprensible.
 */
function claveValida(valor: string): boolean {
  const v = valor.trim();
  return v.length >= 80 && v.length <= 100 && /^[A-Za-z0-9_-]+$/.test(v);
}

/** ¿Puede esta instalación pedir suscripciones push? */
export function hayAvisos(): boolean {
  return claveValida(VAPID_PUBLICA);
}

/** Mensaje único para cuando alguien pide avisos sin VAPID detrás. */
export const SIN_AVISOS =
  "Esta instalación no tiene configuradas las claves VAPID, así que no puede mandar avisos. El resto de la app funciona igual.";

/**
 * Ruta del service worker. Está en la raíz de `public/` a propósito: un
 * service worker solo controla su propio directorio hacia abajo, y desde
 * `/sw-avisos.js` el ámbito es `/`, que es lo que hace falta para que el
 * clic en la notificación pueda reutilizar cualquier pestaña de la app.
 */
export const RUTA_SW = "/sw-avisos.js";

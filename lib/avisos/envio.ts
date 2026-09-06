/**
 * Envío de un push, con `web-push`.
 *
 * Por qué una librería y no `fetch` a pelo: mandar un Web Push no es un POST.
 * Hay que cifrar el mensaje con el esquema `aes128gcm` de la RFC 8291 —ECDH
 * P-256 contra la clave del navegador, HKDF, AES-GCM— y firmar una cabecera
 * VAPID (JWT ES256) por cada servicio push. Son unas 150 líneas de criptografía
 * en las que un error no da excepción: da un 201 del servidor push y una
 * notificación que nunca llega, que es el peor fallo posible para depurar.
 * `web-push` es la implementación de referencia (la mantiene el equipo de
 * Google que escribió la especificación), no tiene dependencias nativas y solo
 * la carga este proceso: la app de Next no la importa en ningún sitio, así que
 * no toca el bundle del navegador.
 *
 * Este fichero SOLO lo usa el cron. No debe importarse desde `app/` ni desde
 * ningún componente: necesita la clave privada VAPID.
 */

import webpush from "web-push";
import type { CargaPush, SuscripcionAviso } from "./tipos";

export interface ResultadoEnvio {
  ok: boolean;
  /**
   * El servicio push dice que ese endpoint ya no existe (404/410). Es
   * información distinta de "ha fallado el envío": hay que marcar la
   * suscripción como caducada, no reintentar.
   */
  caducada: boolean;
  estado?: number;
  error?: string;
}

/**
 * Deja `web-push` listo. El `subject` tiene que ser un `mailto:` o una URL:
 * es a quien avisa el servicio push si nuestros envíos dan problemas, y
 * algunos (Mozilla) rechazan la petición si no es válido.
 */
export function configurarVapid(
  subject: string,
  publica: string,
  privada: string,
): void {
  webpush.setVapidDetails(subject, publica, privada);
}

export async function enviarPush(
  sub: SuscripcionAviso,
  carga: CargaPush,
): Promise<ResultadoEnvio> {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.claveP256dh, auth: sub.claveAuth },
      },
      JSON.stringify(carga),
      {
        // Una hora. Si el móvil está apagado más de eso, el aviso ya no vale:
        // "hoy no has estudiado" entregado mañana es ruido y además mentira.
        TTL: 3600,
        urgency: "normal",
      },
    );
    return { ok: true, caducada: false };
  } catch (e) {
    const err = e as { statusCode?: number; body?: string; message?: string };
    const estado = err.statusCode;
    return {
      ok: false,
      // 404: el endpoint no existe. 410 Gone: existió y el navegador se dio de
      // baja (datos borrados, app desinstalada). En ambos casos no vuelve.
      caducada: estado === 404 || estado === 410,
      estado,
      error: (err.body || err.message || String(e)).slice(0, 300),
    };
  }
}

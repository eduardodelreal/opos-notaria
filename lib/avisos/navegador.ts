/**
 * Alta y baja de la suscripción push, del lado del navegador.
 *
 * Una suscripción push es del APARATO, no de la persona: el mismo opositor
 * tiene la app en el móvil y en el portátil y quiere el aviso en los dos. Por
 * eso cada navegador guarda su propia fila en `suscripciones_aviso` y por eso
 * todo lo de aquí habla siempre de "este dispositivo".
 *
 * Nada de esto lanza por falta de configuración: sin Supabase, sin sesión o
 * sin claves VAPID se devuelve un motivo y quien llama decide qué enseñar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { RUTA_SW, VAPID_PUBLICA, hayAvisos } from "./config";
import { zonaDelNavegador } from "./zonas";

/** Qué se puede hacer aquí y ahora con los avisos. */
export interface EstadoDispositivo {
  /** El navegador tiene service workers, Push API y Notification. */
  soportado: boolean;
  /** El permiso del navegador. "no-soportado" cuando no hay ni API que preguntar. */
  permiso: NotificationPermission | "no-soportado";
  /** Este navegador tiene una suscripción viva ahora mismo. */
  suscrito: boolean;
  endpoint: string | null;
}

export type MotivoFallo =
  | "sin-soporte"
  | "sin-claves"
  | "sin-sesion"
  | "denegado"
  | "error";

export interface Resultado {
  ok: boolean;
  motivo?: MotivoFallo;
  /** Ya en castellano y listo para pintar. */
  mensaje?: string;
}

/**
 * Safari en iOS solo entrega push a las webs instaladas en la pantalla de
 * inicio, y esta app no es una PWA. Detectarlo permite decir por qué no va en
 * vez de dejar un interruptor que no hace nada.
 */
export function esIosSinInstalar(): boolean {
  if (typeof navigator === "undefined") return false;
  const esIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS se hace pasar por Mac; el táctil lo delata.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!esIos) return false;
  const instalada =
    ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone) ||
    window.matchMedia("(display-mode: standalone)").matches;
  return !instalada;
}

export function soportaAvisos(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Lo que hay ahora mismo en este navegador, sin pedir nada ni tocar nada. */
export async function inspeccionar(): Promise<EstadoDispositivo> {
  if (!soportaAvisos()) {
    return { soportado: false, permiso: "no-soportado", suscrito: false, endpoint: null };
  }
  const permiso = Notification.permission;
  try {
    const registro = await navigator.serviceWorker.getRegistration(RUTA_SW);
    const sub = await registro?.pushManager.getSubscription();
    return {
      soportado: true,
      permiso,
      suscrito: !!sub,
      endpoint: sub?.endpoint ?? null,
    };
  } catch {
    return { soportado: true, permiso, suscrito: false, endpoint: null };
  }
}

/** base64url → bytes. Es el formato en que viaja la clave pública VAPID. */
function clavePublicaEnBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const relleno = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const crudo = atob(base64);
  const bytes = new Uint8Array(crudo.length);
  for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i);
  return bytes;
}

async function registroListo(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register(RUTA_SW);
  // `ready` espera a que haya un service worker ACTIVO. Sin esto, el
  // `pushManager.subscribe` de justo después falla la primera vez.
  return navigator.serviceWorker.ready;
}

/**
 * Da de alta este dispositivo: permiso, service worker, suscripción y fila en
 * Supabase.
 *
 * El permiso denegado se trata como un resultado normal, no como un error: el
 * navegador no deja volver a preguntar una vez dicho que no, así que hay que
 * contarlo y dejar la interfaz coherente (interruptor apagado y una línea
 * explicando dónde se cambia), no reintentar en bucle.
 */
export async function activar(
  supabase: SupabaseClient | null,
  usuarioId: string | null,
): Promise<Resultado> {
  if (!soportaAvisos())
    return {
      ok: false,
      motivo: "sin-soporte",
      mensaje: esIosSinInstalar()
        ? "En iPhone y iPad, Safari solo manda avisos si añades la app a la pantalla de inicio. Todavía no lo soportamos."
        : "Este navegador no admite avisos push.",
    };

  if (!hayAvisos())
    return {
      ok: false,
      motivo: "sin-claves",
      mensaje: "Esta instalación no tiene claves VAPID configuradas.",
    };

  if (!supabase || !usuarioId)
    return {
      ok: false,
      motivo: "sin-sesion",
      mensaje: "Los avisos necesitan cuenta: es el servidor quien los manda.",
    };

  let permiso = Notification.permission;
  if (permiso === "default") permiso = await Notification.requestPermission();
  if (permiso !== "granted")
    return {
      ok: false,
      motivo: "denegado",
      mensaje:
        "Has bloqueado las notificaciones en este navegador. Hay que volver a permitirlas en el candado de la barra de direcciones; desde aquí ya no se puede pedir.",
    };

  try {
    const registro = await registroListo();
    let sub = await registro.pushManager.getSubscription();

    // Si ya había suscripción hecha con OTRA clave VAPID (se rotaron las
    // claves del servidor), `subscribe` da InvalidStateError. La única salida
    // es tirar la vieja y volver a suscribirse.
    if (sub) {
      const anterior = sub.options?.applicationServerKey;
      const actual = clavePublicaEnBytes(VAPID_PUBLICA);
      if (anterior && !mismosBytes(new Uint8Array(anterior), actual)) {
        await sub.unsubscribe();
        sub = null;
      }
    }

    if (!sub) {
      sub = await registro.pushManager.subscribe({
        // Obligatorio en todos los navegadores: nos comprometemos a enseñar
        // una notificación por cada push. El service worker lo cumple siempre.
        userVisibleOnly: true,
        applicationServerKey: clavePublicaEnBytes(VAPID_PUBLICA),
      });
    }

    return await guardarSuscripcion(supabase, usuarioId, sub);
  } catch (e) {
    return {
      ok: false,
      motivo: "error",
      mensaje: mensajeDeError(e),
    };
  }
}

function mismosBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Escribe (o resucita) la fila de este dispositivo.
 *
 * Va con `upsert` sobre (usuario_id, endpoint) porque el mismo navegador puede
 * volver a suscribirse muchas veces —tras limpiar datos, tras rotar claves— y
 * cada vez es la MISMA suscripción, no un aparato nuevo. `caducada_at` y
 * `deleted_at` a null: resuscribirse es exactamente la forma de resucitar un
 * endpoint que el servidor había dado por muerto.
 */
export async function guardarSuscripcion(
  supabase: SupabaseClient,
  usuarioId: string,
  sub: PushSubscription,
): Promise<Resultado> {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh ?? "";
  const auth = json.keys?.auth ?? "";
  if (!json.endpoint || !p256dh || !auth)
    return {
      ok: false,
      motivo: "error",
      mensaje: "El navegador ha devuelto una suscripción incompleta.",
    };

  const { error } = await supabase.from("suscripciones_aviso").upsert(
    {
      usuario_id: usuarioId,
      endpoint: json.endpoint,
      clave_p256dh: p256dh,
      clave_auth: auth,
      user_agent: (navigator.userAgent ?? "").slice(0, 400),
      // La zona del aparato, no la del usuario: las 20:00 del móvil que se fue
      // a Canarias no son las del portátil que se quedó en Madrid.
      zona_horaria: zonaDelNavegador(),
      caducada_at: null,
      deleted_at: null,
    },
    { onConflict: "usuario_id,endpoint" },
  );

  if (error)
    return { ok: false, motivo: "error", mensaje: mensajeDeSupabase(error.message) };
  return { ok: true };
}

/**
 * Baja de este dispositivo.
 *
 * Dos pasos que hay que dar en este orden: primero el navegador (para que el
 * servicio push deje de aceptar mensajes) y después la marca en Supabase. Si
 * fallara el segundo, el peor caso es un envío que no llega a ninguna parte;
 * al revés, el opositor seguiría recibiendo avisos con la app diciendo que no.
 *
 * La fila NO se borra: se marca `deleted_at`, como todo en esta app. Un DELETE
 * físico no viaja y el otro dispositivo seguiría enseñando este aparato en la
 * lista para siempre.
 */
export async function desactivar(
  supabase: SupabaseClient | null,
  endpointForzado?: string,
): Promise<Resultado> {
  let endpoint = endpointForzado ?? null;

  if (soportaAvisos() && !endpointForzado) {
    try {
      const registro = await navigator.serviceWorker.getRegistration(RUTA_SW);
      const sub = await registro?.pushManager.getSubscription();
      if (sub) {
        endpoint = sub.endpoint;
        await sub.unsubscribe();
      }
    } catch {
      // Da igual: seguimos y marcamos la baja en el servidor.
    }
  }

  if (!supabase || !endpoint) return { ok: true };

  const { error } = await supabase
    .from("suscripciones_aviso")
    .update({ deleted_at: new Date().toISOString() })
    .eq("endpoint", endpoint);

  if (error)
    return { ok: false, motivo: "error", mensaje: mensajeDeSupabase(error.message) };
  return { ok: true };
}

/**
 * Notificación local de prueba, sin pasar por el servidor.
 *
 * Comprueba el permiso y el service worker, que es donde falla el 90 % de las
 * veces. NO comprueba la entrega desde Railway: eso solo se ve esperando a la
 * hora, y así se le dice al opositor en la interfaz.
 */
export async function avisoDePrueba(): Promise<Resultado> {
  if (!soportaAvisos() || Notification.permission !== "granted")
    return { ok: false, motivo: "denegado", mensaje: "Primero hay que dar permiso." };
  try {
    const registro = await registroListo();
    await registro.showNotification("Prueba de aviso", {
      body: "Así se verán los recordatorios. Este no ha pasado por el servidor.",
      icon: "/aviso-192.png",
      badge: "/aviso-192.png",
      tag: "prueba",
      data: { url: "/ajustes" },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: "error", mensaje: mensajeDeError(e) };
  }
}

function mensajeDeError(e: unknown): string {
  const nombre = (e as { name?: string })?.name ?? "";
  if (nombre === "NotAllowedError")
    return "El navegador ha bloqueado la suscripción. Revisa los permisos de notificaciones de este sitio.";
  if (nombre === "AbortError")
    return "El navegador no ha podido registrar la suscripción. En Chrome esto suele ser que las notificaciones del sistema están apagadas.";
  const mensaje = (e as { message?: string })?.message;
  return mensaje ? `No se ha podido activar: ${mensaje}` : "No se ha podido activar.";
}

function mensajeDeSupabase(mensaje: string): string {
  if (/suscripciones_aviso/.test(mensaje) && /schema cache|does not exist/i.test(mensaje))
    return "Falta aplicar la migración 0003 en Supabase: no existe la tabla de suscripciones.";
  return `No se ha podido guardar en Supabase: ${mensaje}`;
}

/**
 * Reescribe la fila de este dispositivo si ya estaba suscrito.
 *
 * Se llama en cada arranque de la pantalla de ajustes, y no es redundante: la
 * zona horaria cambia cuando el opositor viaja, el user agent cambia con cada
 * actualización del navegador y, sobre todo, el endpoint puede haberlo rotado
 * el navegador por su cuenta (`pushsubscriptionchange`), en cuyo caso la fila
 * del servidor apunta a un endpoint muerto. Es un upsert barato.
 */
export async function refrescarSuscripcion(
  supabase: SupabaseClient | null,
  usuarioId: string | null,
): Promise<void> {
  if (!supabase || !usuarioId || !soportaAvisos()) return;
  if (Notification.permission !== "granted") return;
  try {
    const registro = await navigator.serviceWorker.getRegistration(RUTA_SW);
    const sub = await registro?.pushManager.getSubscription();
    if (sub) await guardarSuscripcion(supabase, usuarioId, sub);
  } catch {
    // Silencio: es mantenimiento oportunista, no una operación del usuario.
  }
}

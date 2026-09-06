"use client";

import { sincronizarAudios } from "../audio/subida";
import { almacenSync, useStore } from "../store/store";
import { haySupabase } from "../supabase/config";
import { clienteNavegador } from "../supabase/navegador";
import { ponerEstado } from "./estado";
import { ErrorCuentaDistinta, sincronizar } from "./motor";
import { transporteSupabase, type Transporte } from "./transporte";

/* ============================================================
   Cuándo se sincroniza

   Al entrar, al recuperar la conexión, al volver la pestaña a primer
   plano, cada 45 s si hay algo pendiente y al salir de la página (§3).

   Y NUNCA durante un cante. Es la única regla que no admite matices: el
   cante es diez minutos que el opositor no va a repetir, y un tirón por un
   ciclo de sincronización en mitad de un epígrafe le arruina la toma. Lo
   que se dispare mientras tanto se apunta y se ejecuta al salir.

   Nada de esto corre sin Supabase configurado ni sin sesión iniciada: la
   app funciona entera en local y el indicador ni se pinta.

   El reintento es con espera creciente y sin machacar: un error de red no
   vacía la cola (§3.1), así que lo peor que pasa es que se propague más
   tarde. Cada fallo dobla la espera hasta un minuto; el primer acierto la
   reinicia.
   ============================================================ */

const INTERVALO = 45_000;
const ESPERA_MINIMA = 2_000;
const ESPERA_MAXIMA = 60_000;
/** Aunque no haya nada que subir, conviene bajar lo del otro dispositivo. */
const REFRESCO = 5 * 60_000;

interface Servicio {
  usuarioId: string;
  transporte: Transporte;
  /** El mismo cliente del transporte, para Storage (audio de los cantes). */
  cliente: ReturnType<typeof clienteNavegador>;
  reloj: ReturnType<typeof setInterval> | null;
  quitarEscuchas: (() => void) | null;
}

let servicio: Servicio | null = null;
let enVuelo: Promise<void> | null = null;
let fallos = 0;
let esperaHasta = 0;
let bloqueado = false;
let pendienteAlDesbloquear = false;

function hayPendientes(): boolean {
  return Object.keys(useStore.getState().cola).length > 0;
}

function tocaRefresco(): boolean {
  return Date.now() - useStore.getState().sincro.ultimaSync > REFRESCO;
}

/**
 * Corre un ciclo. Nunca dos a la vez: si ya hay uno en vuelo se devuelve el
 * mismo, para que dos disparos simultáneos (volver de fondo con la red
 * recién recuperada) no suban la cola dos veces.
 */
export function sincronizarAhora(opciones: { manual?: boolean } = {}): Promise<void> {
  if (!servicio) return Promise.resolve();
  if (enVuelo) return enVuelo;

  if (bloqueado) {
    pendienteAlDesbloquear = true;
    return Promise.resolve();
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    ponerEstado({ fase: "sin-conexion" });
    return Promise.resolve();
  }

  // El botón de Ajustes se salta la espera del backoff: si el opositor lo
  // pulsa es porque quiere intentarlo ahora, no dentro de un minuto.
  if (opciones.manual) {
    fallos = 0;
    esperaHasta = 0;
  } else if (Date.now() < esperaHasta) {
    return Promise.resolve();
  }

  const activo = servicio;
  ponerEstado({ fase: "sincronizando", proximoIntento: 0 });

  enVuelo = (async () => {
    try {
      await sincronizar(almacenSync(), activo.transporte);
      fallos = 0;
      esperaHasta = 0;
      ponerEstado({ fase: "sincronizado", mensaje: "", proximoIntento: 0 });

      // El binario del cante va DESPUÉS de las filas y en su propio try
      // (docs/sincronizacion.md §8): que no haya podido subir un audio de
      // 5 MB con la wifi de la biblioteca no convierte en fallida una
      // sincronización cuyo expediente ya está arriba. Se reintenta solo,
      // con el backoff de lib/audio/subida.ts.
      if (activo.cliente) {
        try {
          await sincronizarAudios(activo.cliente, activo.usuarioId);
        } catch {
          /* apuntado dentro; nunca degrada el estado de la sincronización */
        }
      }
    } catch (e) {
      fallos += 1;
      // Un expediente de otra cuenta no se arregla reintentando: hasta que
      // el opositor haga algo, insistir cada 45 s solo gasta batería.
      const espera =
        e instanceof ErrorCuentaDistinta
          ? 24 * 3_600_000
          : Math.min(ESPERA_MAXIMA, ESPERA_MINIMA * 2 ** (fallos - 1));
      // Un poco de ruido para que dos pestañas del mismo opositor no
      // reintenten a la vez ni se turnen para siempre.
      esperaHasta = Date.now() + espera + Math.random() * 1000;
      const sinRed = typeof navigator !== "undefined" && navigator.onLine === false;
      ponerEstado({
        fase: sinRed ? "sin-conexion" : "error",
        mensaje: (e as Error)?.message ?? "Error desconocido",
        proximoIntento: esperaHasta,
      });
    } finally {
      enVuelo = null;
    }
  })();

  return enVuelo;
}

/**
 * El modo cante lo llama al entrar y al salir. Lo que se haya disparado
 * mientras tanto se ejecuta en cuanto se desbloquea.
 */
export function bloquearSincronizacion(valor: boolean): void {
  bloqueado = valor;
  if (!valor && pendienteAlDesbloquear) {
    pendienteAlDesbloquear = false;
    void sincronizarAhora();
  }
}

/** Arranca el servicio para una sesión. Devuelve cómo pararlo. */
export function activarSincronizacion(usuarioId: string): () => void {
  if (!haySupabase()) return () => {};
  const cliente = clienteNavegador();
  if (!cliente) return () => {};

  // Cambio de cuenta en la misma pestaña: se para lo anterior y se monta de
  // nuevo, para que no queden dos servicios empujando a dos cuentas.
  if (servicio && servicio.usuarioId !== usuarioId) desactivarSincronizacion();
  if (servicio) return desactivarSincronizacion;

  servicio = {
    usuarioId,
    transporte: transporteSupabase(cliente, usuarioId),
    cliente,
    reloj: null,
    quitarEscuchas: null,
  };
  fallos = 0;
  esperaHasta = 0;
  // Con sesión abierta el indicador no puede decir "solo en este equipo"
  // mientras arranca el primer ciclo: se marca ya que va a haber uno.
  ponerEstado({ fase: "sincronizando", mensaje: "", proximoIntento: 0 });

  const alVolverLaRed = () => void sincronizarAhora();
  const alCambiarVisibilidad = () => {
    if (document.visibilityState === "visible") void sincronizarAhora();
    // Al irse a segundo plano (cambiar de pestaña, bloquear el móvil) es
    // cuando más barato sale subir lo pendiente: la app ya no está pintando
    // nada. `visibilitychange` es además el único aviso fiable en móvil,
    // donde `beforeunload` no siempre llega.
    else if (hayPendientes()) void sincronizarAhora();
  };
  const alSalir = () => {
    if (hayPendientes()) void sincronizarAhora();
  };
  const alDesconectar = () => ponerEstado({ fase: "sin-conexion" });

  window.addEventListener("online", alVolverLaRed);
  window.addEventListener("offline", alDesconectar);
  window.addEventListener("pagehide", alSalir);
  document.addEventListener("visibilitychange", alCambiarVisibilidad);

  servicio.quitarEscuchas = () => {
    window.removeEventListener("online", alVolverLaRed);
    window.removeEventListener("offline", alDesconectar);
    window.removeEventListener("pagehide", alSalir);
    document.removeEventListener("visibilitychange", alCambiarVisibilidad);
  };

  servicio.reloj = setInterval(() => {
    if (hayPendientes() || tocaRefresco()) void sincronizarAhora();
  }, INTERVALO);

  void sincronizarAhora();

  return desactivarSincronizacion;
}

export function desactivarSincronizacion(): void {
  if (!servicio) return;
  if (servicio.reloj) clearInterval(servicio.reloj);
  servicio.quitarEscuchas?.();
  servicio = null;
  pendienteAlDesbloquear = false;
  ponerEstado({ fase: "inactivo", mensaje: "", proximoIntento: 0 });
}

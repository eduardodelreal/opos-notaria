"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Cloud, CloudOff, RefreshCw } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { haySupabase } from "@/lib/supabase/config";
import {
  colorFase,
  etiquetaFase,
  useEstadoSync,
  type Fase,
} from "@/lib/sync/estado";
import {
  activarSincronizacion,
  bloquearSincronizacion,
  sincronizarAhora,
} from "@/lib/sync/servicio";
import { Boton, Card, Punto, TituloSeccion, cx } from "./ui";
import { useSesion } from "./Sesion";
import { fechaHora } from "@/lib/utils/time";

/* ============================================================
   La sincronización en pantalla

   Discreta por decisión: el opositor no viene a mirar cómo va la
   sincronización, viene a estudiar. Un punto de color en la barra lateral y
   el detalle en Ajustes, para cuando algo va mal y hay que mirar.

   Sin Supabase configurado o sin sesión no se pinta nada, ni el punto ni el
   bloque: la app funciona entera en local y anunciar una sincronización que
   no existe solo genera preguntas.
   ============================================================ */

/**
 * El motor. No pinta nada; monta y desmonta el servicio con la sesión.
 *
 * Va en el layout para que siga vivo al navegar entre páginas: si colgara
 * de una pantalla concreta, se pararía en cuanto el opositor cambiara de
 * sitio, que es justo cuando hay algo que subir.
 */
export function MotorSincronizacion() {
  const { configurado, usuario } = useSesion();
  const ruta = usePathname();
  // Por el id y no por el objeto: `onAuthStateChange` emite un usuario nuevo
  // en cada refresco de token, y eso reiniciaría el servicio cada hora sin
  // que haya cambiado nada.
  const usuarioId = usuario?.id;

  React.useEffect(() => {
    if (!configurado || !usuarioId) return;
    return activarSincronizacion(usuarioId);
  }, [configurado, usuarioId]);

  // Mientras el modo cante está en pantalla no se sincroniza: son diez
  // minutos que el opositor no va a repetir y no pueden tener saltos. Lo
  // que se dispare mientras tanto se ejecuta al salir.
  React.useEffect(() => {
    const enCante = ruta.startsWith("/cante/vivo");
    bloquearSincronizacion(enCante);
    return () => bloquearSincronizacion(false);
  }, [ruta]);

  return null;
}

/** ¿Hay algo que enseñar sobre la sincronización en esta instalación? */
function useVisible(): boolean {
  const { configurado, usuario } = useSesion();
  return haySupabase() && configurado && Boolean(usuario);
}

/** Cuántas filas están esperando a subir. Devuelve un número: nada que derivar. */
function usePendientes(): number {
  return useStore((s) => Object.keys(s.cola).length);
}

/* -------------------------------------------------------------------------- */

/** El punto de la barra lateral. Un color, una palabra y la hora. */
export function IndicadorSync() {
  const visible = useVisible();
  const fase = useEstadoSync((s) => s.fase);
  const ultima = useStore((s) => s.sincro.ultimaSync);
  const pendientes = usePendientes();

  if (!visible) return null;

  const titulo = ultima
    ? `Última sincronización: ${fechaHora(ultima)}`
    : "Todavía no se ha sincronizado";

  return (
    <button
      onClick={() => void sincronizarAhora({ manual: true })}
      title={`${etiquetaFase(fase)}. ${titulo}`}
      className="w-full flex items-center gap-2.5 h-8 px-3 rounded-[10px] text-[11.5px] text-subtle hover:text-muted hover:bg-[var(--surface-2)]/60 transition-colors"
    >
      <Punto color={colorFase(fase)} size={7} />
      <span className="truncate">{etiquetaFase(fase)}</span>
      {pendientes > 0 && fase !== "sincronizando" && (
        <span className="ml-auto numeric text-[10.5px]">{pendientes}</span>
      )}
      {fase === "sincronizando" && (
        <RefreshCw className="ml-auto size-3 animate-spin shrink-0" />
      )}
    </button>
  );
}

/* -------------------------------------------------------------------------- */

const EXPLICACION: Record<Fase, string> = {
  sincronizado:
    "Tu expediente está guardado en la nube y al día en todos tus dispositivos.",
  sincronizando: "Subiendo y bajando cambios.",
  "sin-conexion":
    "No hay red. Se sigue guardando todo en este navegador y se subirá en cuanto vuelva la conexión.",
  error:
    "El último intento no salió bien. Nada se ha perdido: los cambios siguen en la cola y se reintentan solos.",
  inactivo:
    "Sin sesión iniciada. Todo se guarda solo en este navegador; si lo borras, se pierde.",
};

/** El bloque de Ajustes: el detalle y el botón de sincronizar ahora. */
export function TarjetaSincronizacion({ className }: { className?: string }) {
  const visible = useVisible();
  const { fase, mensaje } = useEstadoSync();
  const sincro = useStore((s) => s.sincro);
  const pendientes = usePendientes();

  // Sin cuenta no hay tarjeta, ni vacía: no existe la sincronización.
  if (!visible) return null;

  return (
    <Card className={className}>
      <TituloSeccion>Sincronización</TituloSeccion>

      <div className="flex items-center gap-2.5 mb-3">
        <Punto color={colorFase(fase)} size={8} />
        <span className="text-[14px] font-medium">{etiquetaFase(fase)}</span>
        {fase === "sincronizando" ? (
          <Cloud className="size-4 text-subtle" />
        ) : fase === "sin-conexion" ? (
          <CloudOff className="size-4 text-subtle" />
        ) : null}
      </div>

      <p className="text-[12.5px] text-muted leading-relaxed mb-4">
        {EXPLICACION[fase]}
      </p>

      <dl className="grid grid-cols-2 gap-3 mb-4 text-[12.5px]">
        <div>
          <dt className="text-[10.5px] uppercase tracking-[0.1em] text-subtle">
            Última sincronización
          </dt>
          <dd className="numeric mt-1">
            {sincro.ultimaSync ? fechaHora(sincro.ultimaSync) : "nunca"}
          </dd>
        </div>
        <div>
          <dt className="text-[10.5px] uppercase tracking-[0.1em] text-subtle">
            Cambios sin subir
          </dt>
          <dd className="numeric mt-1">{pendientes}</dd>
        </div>
      </dl>

      {fase === "error" && mensaje && (
        <p
          className="text-[12px] leading-relaxed mb-4 rounded-[10px] px-3 py-2 border"
          style={{
            color: "var(--danger)",
            borderColor: "color-mix(in srgb, var(--danger) 35%, transparent)",
            background: "color-mix(in srgb, var(--danger) 10%, transparent)",
          }}
        >
          {mensaje}
        </p>
      )}

      <Boton
        variante="secundario"
        onClick={() => void sincronizarAhora({ manual: true })}
        cargando={fase === "sincronizando"}
      >
        {fase !== "sincronizando" && <RefreshCw className="size-4" />}
        Sincronizar ahora
      </Boton>

      <p className="text-[12px] text-subtle leading-relaxed mt-4">
        Se sincroniza sola al abrir la app, al recuperar la conexión y cada poco
        rato mientras haya cambios. Nunca durante un cante: esos diez minutos no
        se interrumpen por nada.
      </p>
    </Card>
  );
}

/** Aviso de "solo en este equipo" para quien no ha iniciado sesión. */
export function AvisoSinCuenta({ className }: { className?: string }) {
  const { configurado, usuario } = useSesion();
  if (!haySupabase() || !configurado || usuario) return null;
  return (
    <p className={cx("text-[12.5px] text-muted leading-relaxed", className)}>
      No has iniciado sesión: tu expediente vive solo en este navegador. Si creas
      una cuenta, se sube tal cual está y lo tendrás en todos tus dispositivos.
    </p>
  );
}

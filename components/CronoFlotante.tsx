"use client";

import * as React from "react";
import { Pause, Play, Square, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store/store";
import { reloj } from "@/lib/utils/time";
import { Boton, cx } from "./ui";

/** Minutos sin tocar el teclado o el ratón antes de pausar solo. */
const INACTIVIDAD_MIN = 6;

/**
 * Cronómetro flotante. Vive fuera de las páginas para que siga contando
 * navegues donde navegues, y se auto-pausa si el opositor se levanta:
 * las horas que cuenta esta app son horas efectivas, no horas de silla.
 */
export function CronoFlotante() {
  const crono = useStore((s) => s.crono);
  const temas = useStore((s) => s.temas);
  const pausar = useStore((s) => s.pausarCrono);
  const reanudar = useStore((s) => s.reanudarCrono);
  const parar = useStore((s) => s.pararCrono);
  const descartar = useStore((s) => s.descartarCrono);

  const [segundos, setSegundos] = React.useState(0);
  const [autoPausado, setAutoPausado] = React.useState(false);
  const ultimaActividad = React.useRef(Date.now());

  // Tic del reloj: recalculamos desde los timestamps del store, así que
  // un tab dormido o una recarga no pierden ni ganan segundos.
  React.useEffect(() => {
    if (!crono) {
      setSegundos(0);
      return;
    }
    const tic = () => setSegundos(useStore.getState().segundosCrono());
    tic();
    const id = setInterval(tic, 1000);
    return () => clearInterval(id);
  }, [crono]);

  // Detección de inactividad.
  React.useEffect(() => {
    const marcar = () => {
      ultimaActividad.current = Date.now();
      if (autoPausado) setAutoPausado(false);
    };
    const eventos = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    eventos.forEach((e) => window.addEventListener(e, marcar, { passive: true }));
    return () =>
      eventos.forEach((e) => window.removeEventListener(e, marcar));
  }, [autoPausado]);

  React.useEffect(() => {
    if (!crono || crono.pausado) return;
    const id = setInterval(() => {
      const inactivo = Date.now() - ultimaActividad.current;
      if (inactivo > INACTIVIDAD_MIN * 60_000) {
        pausar();
        setAutoPausado(true);
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [crono, pausar]);

  if (!crono) return null;

  const tema = crono.temaId ? temas.find((t) => t.id === crono.temaId) : undefined;
  const etiquetaTipo =
    crono.tipo === "estudio" ? "Estudio" : crono.tipo === "repaso" ? "Repaso" : "Cante";

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 lg:left-auto lg:right-6 lg:translate-x-0 z-40 w-[min(calc(100vw-2rem),420px)]">
      <div
        className={cx(
          "panel px-4 py-3 flex items-center gap-4",
          !crono.pausado && "animate-pulse-ring",
        )}
        style={{ boxShadow: "var(--shadow-lg)" }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5">
            <span className="numeric text-[26px] font-semibold leading-none tracking-tight">
              {reloj(segundos, true)}
            </span>
            <span
              className="text-[10px] uppercase tracking-[0.14em] font-semibold"
              style={{
                color: crono.pausado ? "var(--fg-subtle)" : "var(--laton)",
              }}
            >
              {crono.pausado ? (autoPausado ? "auto-pausa" : "pausa") : etiquetaTipo}
            </span>
          </div>
          <p className="text-[12px] text-muted truncate mt-1">
            {tema ? `T${tema.numero} · ${tema.titulo}` : "Sesión sin tema asignado"}
          </p>
          {autoPausado && (
            <p className="text-[11px] text-[var(--warn)] mt-1">
              Pausado solo tras {INACTIVIDAD_MIN} min sin actividad
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => (crono.pausado ? reanudar() : pausar())}
            className="size-9 grid place-items-center rounded-full bg-[var(--surface-3)] hover:bg-[var(--border-strong)] transition-colors"
            aria-label={crono.pausado ? "Reanudar" : "Pausar"}
          >
            {crono.pausado ? (
              <Play className="size-4 ml-0.5" />
            ) : (
              <Pause className="size-4" />
            )}
          </button>
          <Boton
            tam="sm"
            variante="primario"
            onClick={() => parar()}
            className="h-9 px-3"
          >
            <Square className="size-3.5" />
            Guardar
          </Boton>
          <button
            onClick={descartar}
            className="size-9 grid place-items-center rounded-full text-subtle hover:text-[var(--danger)] transition-colors"
            aria-label="Descartar sesión"
            title="Descartar sin guardar"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

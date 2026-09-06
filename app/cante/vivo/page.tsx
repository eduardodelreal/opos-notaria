"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronRight, Sparkles, X } from "lucide-react";
import { useStore } from "@/lib/store/store";
import {
  AreaTexto,
  Boton,
  Card,
  Punto,
  TituloSeccion,
  Vacio,
  cx,
} from "@/components/ui";
import { ComparativaEpigrafes } from "@/components/graficos";
import { FALLOS, type CanteEpigrafe, type TipoFallo } from "@/lib/data/types";
import { reloj } from "@/lib/utils/time";
import { useFicha, useIA , rutaIA } from "@/lib/ai/hooks";
import { construirDetalleCante } from "@/lib/ai/contexto";

export default function PaginaCanteVivo() {
  return (
    <React.Suspense
      fallback={
        <div className="fixed inset-0 grid place-items-center bg-[var(--bg)]">
          <span className="text-subtle text-sm">Preparando el cante…</span>
        </div>
      }
    >
      <CanteVivo />
    </React.Suspense>
  );
}

type Fase = "listo" | "cantando" | "resumen";

function CanteVivo() {
  const router = useRouter();
  const params = useSearchParams();
  const temaId = params.get("tema") ?? "";

  const tema = useStore((s) => s.temas.find((t) => t.id === temaId));
  const perfil = useStore((s) => s.perfil);
  const materias = useStore((s) => s.materias);
  // Ojo: el selector devuelve la lista cruda y el filtrado va en useMemo.
  // Filtrar dentro del selector crea un array nuevo en cada render y zustand
  // lo compara por identidad -> bucle infinito de renders.
  const todosLosCantes = useStore((s) => s.cantes);
  const cantesPrevios = React.useMemo(
    () =>
      todosLosCantes
        .filter((c) => c.temaId === temaId)
        .sort((a, b) => b.fecha - a.fecha),
    [todosLosCantes, temaId],
  );
  const guardarCante = useStore((s) => s.guardarCante);
  const setAnalisisCante = useStore((s) => s.setAnalisisCante);

  const [fase, setFase] = React.useState<Fase>("listo");
  const [indice, setIndice] = React.useState(0);
  const [inicio, setInicio] = React.useState(0);
  const [inicioEpigrafe, setInicioEpigrafe] = React.useState(0);
  const [ahora, setAhora] = React.useState(0);
  const [registrados, setRegistrados] = React.useState<CanteEpigrafe[]>([]);
  const [fallosActuales, setFallosActuales] = React.useState<TipoFallo[]>([]);
  const [flash, setFlash] = React.useState<string | null>(null);

  const epigrafes = tema?.epigrafes ?? [];
  const sinEpigrafes = epigrafes.length === 0;

  /* --------------------------------- reloj -------------------------------- */
  React.useEffect(() => {
    if (fase !== "cantando") return;
    const id = setInterval(() => setAhora(Date.now()), 200);
    return () => clearInterval(id);
  }, [fase]);

  const segundosTotales = fase === "cantando" ? Math.floor((ahora - inicio) / 1000) : 0;
  const segundosEpigrafe =
    fase === "cantando" ? Math.floor((ahora - inicioEpigrafe) / 1000) : 0;
  const objetivoSeg = perfil.minutosPorTema * 60;

  /* -------------------------------- acciones ------------------------------- */

  const empezar = React.useCallback(() => {
    const t = Date.now();
    setInicio(t);
    setInicioEpigrafe(t);
    setAhora(t);
    setIndice(0);
    setRegistrados([]);
    setFallosActuales([]);
    setFase("cantando");
  }, []);

  const cerrarEpigrafe = React.useCallback(() => {
    const e = epigrafes[indice];
    const segundos = Math.max(1, Math.floor((Date.now() - inicioEpigrafe) / 1000));
    setRegistrados((prev) => [
      ...prev,
      {
        epigrafeId: e?.id ?? `sin-epigrafe-${indice}`,
        titulo: e?.titulo ?? "Tema completo",
        segundos,
        fallos: fallosActuales,
      },
    ]);
    setFallosActuales([]);
  }, [epigrafes, indice, inicioEpigrafe, fallosActuales]);

  const siguiente = React.useCallback(() => {
    if (sinEpigrafes) return;
    cerrarEpigrafe();
    if (indice + 1 >= epigrafes.length) {
      setFase("resumen");
    } else {
      setIndice((i) => i + 1);
      setInicioEpigrafe(Date.now());
    }
  }, [cerrarEpigrafe, indice, epigrafes.length, sinEpigrafes]);

  const terminar = React.useCallback(() => {
    if (fase !== "cantando") return;
    cerrarEpigrafe();
    setFase("resumen");
  }, [fase, cerrarEpigrafe]);

  const marcarFallo = React.useCallback((f: TipoFallo) => {
    setFallosActuales((prev) => [...prev, f]);
    const meta = FALLOS.find((x) => x.id === f)!;
    setFlash(meta.label);
    setTimeout(() => setFlash(null), 700);
  }, []);

  /* -------------------------------- teclado -------------------------------- */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (fase === "listo" && (e.code === "Space" || e.code === "Enter")) {
        e.preventDefault();
        empezar();
        return;
      }
      if (fase !== "cantando") return;
      if (e.code === "Space") {
        e.preventDefault();
        sinEpigrafes ? terminar() : siguiente();
      } else if (e.key === "Escape") {
        e.preventDefault();
        terminar();
      } else {
        const f = FALLOS.find((x) => x.tecla === e.key);
        if (f) {
          e.preventDefault();
          marcarFallo(f.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fase, siguiente, terminar, marcarFallo, empezar, sinEpigrafes]);

  /* --------------------------------- vistas -------------------------------- */

  if (!tema) {
    return (
      <div className="min-h-screen grid place-items-center px-6">
        <Card className="max-w-md w-full p-0">
          <Vacio
            titulo="No encuentro ese tema"
            texto="Vuelve al listado y elige otro."
            accion={
              <Link href="/cante">
                <Boton variante="secundario">Volver al cante</Boton>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const materia = materias.find((m) => m.id === tema.materiaId);

  /* ------------------------------ fase: listo ------------------------------ */
  if (fase === "listo") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 py-16 relative">
        <Link
          href="/cante"
          className="absolute top-6 right-6 size-10 grid place-items-center rounded-full text-subtle hover:text-fg hover:bg-[var(--surface-2)] transition-colors"
          aria-label="Salir"
        >
          <X className="size-5" />
        </Link>

        <div className="max-w-2xl w-full text-center">
          {materia && (
            <div className="inline-flex items-center gap-2 mb-5">
              <Punto color={materia.color} />
              <span className="text-[12px] uppercase tracking-[0.16em] text-subtle">
                {materia.nombre}
              </span>
            </div>
          )}

          <h1 className="font-serif text-[30px] sm:text-[40px] font-semibold leading-[1.15] tracking-[-0.02em]">
            <span className="text-subtle numeric mr-4">{tema.numero}</span>
            {tema.titulo}
          </h1>

          <p className="text-[14px] text-muted mt-6 leading-relaxed">
            {sinEpigrafes ? (
              <>
                Este tema no tiene epígrafes: se cronometra entero. Si los añades,
                tendrás el desglose y la comparativa con tus cantes anteriores.
              </>
            ) : (
              <>
                {epigrafes.length} epígrafes · objetivo {perfil.minutosPorTema} min.
                Espacio para avanzar, 1-4 para marcar fallos, Esc para terminar.
              </>
            )}
          </p>

          <div className="mt-10">
            <Boton variante="primario" tam="lg" onClick={empezar} className="px-10">
              Empezar el cante
            </Boton>
            <p className="text-[12px] text-subtle mt-4">
              o pulsa <kbd className="px-1.5 py-0.5 rounded bg-[var(--surface-3)] border border-[var(--border)] text-[11px]">Espacio</kbd>
            </p>
          </div>

          {cantesPrevios.length > 0 && (
            <p className="text-[12.5px] text-subtle mt-10">
              Último cante: {reloj(cantesPrevios[0].segundos)}
              {cantesPrevios[0].nota != null && ` · nota ${cantesPrevios[0].nota}`}
            </p>
          )}
        </div>
      </div>
    );
  }

  /* ----------------------------- fase: cantando ---------------------------- */
  if (fase === "cantando") {
    const actual = epigrafes[indice];
    const proximo = epigrafes[indice + 1];
    const pct = Math.min(100, (segundosTotales / objetivoSeg) * 100);
    const pasado = segundosTotales > objetivoSeg;

    return (
      <div className="min-h-screen flex flex-col bg-[var(--bg)] relative overflow-hidden">
        {/* barra de tiempo global */}
        <div className="absolute top-0 inset-x-0 h-[3px] bg-[var(--surface-2)]">
          <div
            className="h-full transition-[width] duration-300"
            style={{
              width: `${pct}%`,
              background: pasado ? "var(--danger)" : "var(--laton)",
            }}
          />
        </div>

        <header className="flex items-center justify-between px-6 sm:px-10 pt-8">
          <div className="text-[12px] uppercase tracking-[0.16em] text-subtle">
            {sinEpigrafes
              ? `Tema ${tema.numero}`
              : `Epígrafe ${indice + 1} de ${epigrafes.length}`}
          </div>
          <div className="flex items-baseline gap-3">
            <span
              className="numeric text-[30px] font-semibold tracking-tight tabular-nums"
              style={{ color: pasado ? "var(--danger)" : "var(--fg)" }}
            >
              {reloj(segundosTotales, true)}
            </span>
            <span className="text-[12px] text-subtle numeric">
              / {perfil.minutosPorTema}:00
            </span>
          </div>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center px-6 sm:px-10 text-center max-w-4xl mx-auto w-full">
          {flash && (
            <div
              className="absolute top-24 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-[13px] font-medium animate-rise"
              style={{
                background: "color-mix(in srgb, var(--danger) 18%, var(--surface))",
                color: "var(--danger)",
                border: "1px solid color-mix(in srgb, var(--danger) 40%, transparent)",
              }}
            >
              {flash} marcado
            </div>
          )}

          <h2 className="font-serif text-[32px] sm:text-[46px] leading-[1.2] font-medium tracking-[-0.015em]">
            {sinEpigrafes ? tema.titulo : actual?.titulo}
          </h2>

          <div className="mt-8 flex items-center gap-4">
            <span className="numeric text-[15px] text-muted">
              {reloj(segundosEpigrafe)} en este {sinEpigrafes ? "tema" : "epígrafe"}
            </span>
            {fallosActuales.length > 0 && (
              <span className="flex items-center gap-1.5">
                {fallosActuales.map((f, i) => (
                  <span
                    key={i}
                    className="size-2 rounded-full"
                    style={{ background: "var(--danger)" }}
                  />
                ))}
              </span>
            )}
          </div>

          {proximo && (
            <p className="mt-12 text-[14px] text-subtle max-w-xl leading-relaxed">
              <span className="uppercase tracking-[0.14em] text-[10px] block mb-2 opacity-70">
                Después
              </span>
              {proximo.titulo}
            </p>
          )}
        </main>

        <footer className="px-6 sm:px-10 pb-10">
          <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
            {FALLOS.map((f) => (
              <button
                key={f.id}
                onClick={() => marcarFallo(f.id)}
                title={f.desc}
                className="h-9 px-3.5 rounded-full border border-[var(--border)] text-[12.5px] text-muted hover:text-fg hover:border-[var(--border-strong)] transition-colors inline-flex items-center gap-2"
              >
                <kbd className="text-[10px] text-subtle">{f.tecla}</kbd>
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-center gap-3">
            <Boton variante="fantasma" onClick={terminar}>
              Terminar
            </Boton>
            {!sinEpigrafes && (
              <Boton variante="primario" tam="lg" onClick={siguiente} className="px-8">
                {indice + 1 >= epigrafes.length ? "Cerrar cante" : "Siguiente epígrafe"}
                <ChevronRight className="size-4" />
              </Boton>
            )}
            {sinEpigrafes && (
              <Boton variante="primario" tam="lg" onClick={terminar} className="px-8">
                Cerrar cante
              </Boton>
            )}
          </div>
        </footer>
      </div>
    );
  }

  /* ----------------------------- fase: resumen ----------------------------- */
  return (
    <Resumen
      tema={tema}
      materia={materia}
      registrados={registrados}
      cantesPrevios={cantesPrevios}
      perfil={perfil}
      onGuardar={guardarCante}
      onAnalisis={setAnalisisCante}
      onSalir={() => router.push(`/tema/${tema.id}`)}
    />
  );
}

/* ========================================================================== */
/*                                  Resumen                                   */
/* ========================================================================== */

function Resumen({
  tema,
  materia,
  registrados,
  cantesPrevios,
  perfil,
  onGuardar,
  onAnalisis,
  onSalir,
}: {
  tema: { id: string; numero: number; titulo: string; materiaId: string };
  materia?: { id: string; nombre: string; color: string };
  registrados: CanteEpigrafe[];
  cantesPrevios: import("@/lib/data/types").Cante[];
  perfil: import("@/lib/data/types").Perfil;
  onGuardar: (
    c: Omit<import("@/lib/data/types").Cante, "id" | "fecha"> & { fecha?: number },
  ) => import("@/lib/data/types").Cante;
  onAnalisis: (id: string, a: import("@/lib/data/types").AnalisisCante) => void;
  onSalir: () => void;
}) {
  const ia = useIA();
  const ficha = useFicha();

  const [nota, setNota] = React.useState<number | null>(null);
  const [conPreparador, setConPreparador] = React.useState(false);
  const [feedback, setFeedback] = React.useState("");
  const [analizar, setAnalizar] = React.useState(true);
  const [guardando, setGuardando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const segundos = registrados.reduce((a, e) => a + e.segundos, 0);
  const fallos = registrados.reduce((a, e) => a + e.fallos.length, 0);
  const objetivo = perfil.minutosPorTema * 60;
  const anterior = cantesPrevios[0];

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    const cante = onGuardar({
      temaId: tema.id,
      segundos,
      epigrafes: registrados,
      nota: nota ?? undefined,
      conPreparador,
      feedback: feedback.trim() || undefined,
    });

    if (analizar && ia.disponible) {
      try {
        const detalle = construirDetalleCante(
          cante,
          tema as never,
          materia as never,
          cantesPrevios,
          perfil.minutosPorTema,
        );
        const r = await fetch(rutaIA("/api/ai/analisis-cante"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            detalleCante: detalle,
            ficha: ficha(),
            estilo: perfil.estiloFeedback,
          }),
        });
        const d = await r.json();
        if (r.ok) {
          onAnalisis(cante.id, {
            ...d.analisis,
            generado: Date.now(),
            modelo: d.modelo,
          });
        } else {
          setError(`Cante guardado, pero el análisis ha fallado: ${d.mensaje}`);
          setGuardando(false);
          return;
        }
      } catch (e) {
        setError(`Cante guardado, pero el análisis ha fallado: ${(e as Error).message}`);
        setGuardando(false);
        return;
      }
    }

    onSalir();
  };

  return (
    <div className="min-h-screen px-6 py-12 sm:py-16">
      <div className="max-w-2xl mx-auto">
        <p className="text-[12px] uppercase tracking-[0.16em] text-subtle mb-3">
          Cante terminado
        </p>
        <h1 className="font-serif text-[26px] sm:text-[32px] font-semibold leading-tight tracking-[-0.02em] mb-8">
          <span className="text-subtle numeric mr-3">{tema.numero}</span>
          {tema.titulo}
        </h1>

        <div className="grid grid-cols-3 gap-3 mb-6">
          <Card className="text-center py-4">
            <div
              className="numeric text-[24px] font-semibold"
              style={{ color: segundos > objetivo ? "var(--danger)" : "var(--ok)" }}
            >
              {reloj(segundos)}
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-subtle mt-1.5">
              {segundos > objetivo
                ? `+${reloj(segundos - objetivo)} de más`
                : `${reloj(objetivo - segundos)} de margen`}
            </div>
          </Card>
          <Card className="text-center py-4">
            <div className="numeric text-[24px] font-semibold">
              {registrados.length}
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-subtle mt-1.5">
              {registrados.length === 1 ? "epígrafe" : "epígrafes"}
            </div>
          </Card>
          <Card className="text-center py-4">
            <div
              className="numeric text-[24px] font-semibold"
              style={{ color: fallos ? "var(--danger)" : "var(--ok)" }}
            >
              {fallos}
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-subtle mt-1.5">
              {fallos === 1 ? "fallo" : "fallos"}
            </div>
          </Card>
        </div>

        {registrados.length > 1 && (
          <Card className="mb-6">
            <TituloSeccion>
              {anterior ? "Por epígrafe (gris: cante anterior)" : "Por epígrafe"}
            </TituloSeccion>
            <ComparativaEpigrafes
              filas={registrados.map((e) => ({
                titulo: e.titulo,
                actual: e.segundos,
                anterior: anterior?.epigrafes.find(
                  (x) => x.epigrafeId === e.epigrafeId,
                )?.segundos,
                fallos: e.fallos.length,
              }))}
            />
          </Card>
        )}

        <Card className="mb-5">
          <TituloSeccion>Valoración</TituloSeccion>
          <div className="flex flex-wrap gap-1.5 mb-5">
            {Array.from({ length: 11 }, (_, i) => i).map((n) => (
              <button
                key={n}
                onClick={() => setNota(nota === n ? null : n)}
                className={cx(
                  "size-9 rounded-lg border text-[13px] numeric font-medium transition-all",
                  nota === n
                    ? "text-white border-transparent"
                    : "border-[var(--border)] text-muted hover:text-fg hover:border-[var(--border-strong)]",
                )}
                style={
                  nota === n
                    ? {
                        background:
                          n >= 7 ? "var(--ok)" : n >= 5 ? "var(--warn)" : "var(--danger)",
                      }
                    : undefined
                }
              >
                {n}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2.5 mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={conPreparador}
              onChange={(e) => setConPreparador(e.target.checked)}
              className="size-4 accent-[var(--lacre-bright)]"
            />
            <span className="text-[13.5px]">Este cante ha sido con el preparador</span>
          </label>

          <AreaTexto
            etiqueta="Feedback"
            rows={4}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Lo que te ha dicho el preparador, o lo que tú has notado. Cuanto más concreto, mejor analiza la IA."
          />
        </Card>

        {ia.disponible && (
          <label className="flex items-start gap-3 mb-6 cursor-pointer px-4 py-3.5 rounded-[10px] border"
            style={{
              borderColor: "color-mix(in srgb, var(--laton) 32%, transparent)",
              background: "color-mix(in srgb, var(--laton) 6%, transparent)",
            }}
          >
            <input
              type="checkbox"
              checked={analizar}
              onChange={(e) => setAnalizar(e.target.checked)}
              className="size-4 accent-[var(--laton)] mt-0.5"
            />
            <span>
              <span className="text-[13.5px] font-medium flex items-center gap-2">
                <Sparkles className="size-3.5 text-[var(--laton)]" />
                Analizar el cante con IA al guardar
              </span>
              <span className="text-[12.5px] text-muted block mt-1 leading-relaxed">
                Compara este cante con los anteriores del mismo tema y con tu ficha
                completa, y te dice en qué hincar el codo.
              </span>
            </span>
          </label>
        )}

        {error && (
          <p className="text-[13px] text-[var(--warn)] mb-4 leading-relaxed">{error}</p>
        )}

        <div className="flex items-center justify-end gap-3">
          <Boton variante="fantasma" onClick={onSalir}>
            Descartar
          </Boton>
          <Boton
            variante="primario"
            tam="lg"
            onClick={guardar}
            cargando={guardando}
          >
            <Check className="size-4" />
            {guardando && analizar && ia.disponible
              ? "Guardando y analizando…"
              : "Guardar cante"}
          </Boton>
        </div>
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronRight, Mic, MicOff, Sparkles, X } from "lucide-react";
import { useCantes, useMaterias, useStore, useTema } from "@/lib/store/store";
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
import {
  crearGrabadora,
  grabacionSoportada,
  type Grabadora,
  type ResultadoGrabacion,
} from "@/lib/audio/grabadora";
import { guardarAudio } from "@/lib/audio/almacen";
import { reloj } from "@/lib/utils/time";
import { useFicha, useIA, pedirIA } from "@/lib/ai/hooks";
import { NotaIA } from "@/components/AvisoIA";
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

  const tema = useTema(temaId);
  const perfil = useStore((s) => s.perfil);
  const materias = useMaterias();
  // Ojo: el selector devuelve la lista sin derivar y el filtrado va en
  // useMemo. Filtrar dentro del selector crea un array nuevo en cada render
  // y zustand lo compara por identidad -> bucle infinito de renders. Los
  // hooks de lectura (useCantes, useTema...) sí se pueden usar en el
  // selector: memorizan y devuelven siempre la misma referencia.
  const todosLosCantes = useCantes();
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

  /* ------------------------------ grabación ------------------------------ */
  // Todo lo de aquí es un EXTRA: si el navegador no sabe grabar, si no hay
  // micrófono o si el opositor dice que no, el cante funciona exactamente
  // igual que sin esta función. Ninguna rama de abajo puede impedir empezar.
  const grabadora = React.useRef<Grabadora | null>(null);
  const [soportado, setSoportado] = React.useState(false);
  const [quiereGrabar, setQuiereGrabar] = React.useState(true);
  const [grabando, setGrabando] = React.useState(false);
  const [avisoAudio, setAvisoAudio] = React.useState<string | null>(null);
  const [audio, setAudio] = React.useState<ResultadoGrabacion | null>(null);

  // `grabacionSoportada()` mira `window`: en el render del servidor no
  // existe, así que se resuelve tras montar para no romper la hidratación.
  React.useEffect(() => {
    setSoportado(grabacionSoportada());
    grabadora.current = crearGrabadora();
    // Soltar el micrófono al salir de la página es obligatorio: si no, el
    // punto rojo de la pestaña se queda encendido para siempre.
    return () => grabadora.current?.soltar();
  }, []);

  /** Pide el permiso. Devuelve si se puede grabar; nunca lanza. */
  const asegurarPermiso = React.useCallback(async () => {
    if (!grabadora.current) return false;
    const ok = await grabadora.current.pedirPermiso();
    if (!ok) {
      setQuiereGrabar(false);
      setAvisoAudio(
        "Sin acceso al micrófono. El cante va igual; solo no se graba.",
      );
    } else {
      setAvisoAudio(null);
    }
    return ok;
  }, []);

  const alternarGrabacion = React.useCallback(async () => {
    if (quiereGrabar) {
      setQuiereGrabar(false);
      setAvisoAudio(null);
      grabadora.current?.soltar();
      return;
    }
    setQuiereGrabar(true);
    // El permiso se pide AQUÍ, con el clic del opositor y antes de empezar:
    // un diálogo del navegador a media recitación arruina la toma.
    await asegurarPermiso();
  }, [quiereGrabar, asegurarPermiso]);

  /** Abre el tramo del epígrafe `i` en la grabación. Coste: un push. */
  const marcarEnAudio = React.useCallback(
    (i: number) => {
      const e = epigrafes[i];
      grabadora.current?.marcar(
        e?.id ?? `sin-epigrafe-${i}`,
        e?.titulo ?? "Tema completo",
      );
    },
    [epigrafes],
  );

  const detenerGrabacion = React.useCallback(async () => {
    const r = await grabadora.current?.parar();
    setGrabando(false);
    if (r) setAudio(r);
  }, []);

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

  const empezar = React.useCallback(async () => {
    // El único `await` de todo el cante, y está ANTES de la primera palabra:
    // si el stream ya estaba abierto (el opositor activó la casilla antes)
    // resuelve en el acto; si no, el diálogo del navegador sale aquí y no en
    // mitad del epígrafe 3.
    let conAudio = false;
    if (quiereGrabar && soportado) {
      conAudio = await asegurarPermiso();
      if (conAudio) conAudio = grabadora.current?.empezar() ?? false;
    }
    setGrabando(conAudio);
    setAudio(null);

    const t = Date.now();
    setInicio(t);
    setInicioEpigrafe(t);
    setAhora(t);
    setIndice(0);
    setRegistrados([]);
    setFallosActuales([]);
    setFase("cantando");
    if (conAudio) marcarEnAudio(0);
  }, [quiereGrabar, soportado, asegurarPermiso, marcarEnAudio]);

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
      // El `parar()` se lanza sin esperarlo: la fase cambia ya y el blob se
      // ensambla mientras se pinta el resumen.
      void detenerGrabacion();
      setFase("resumen");
    } else {
      setIndice((i) => i + 1);
      setInicioEpigrafe(Date.now());
      marcarEnAudio(indice + 1);
    }
  }, [
    cerrarEpigrafe,
    indice,
    epigrafes.length,
    sinEpigrafes,
    marcarEnAudio,
    detenerGrabacion,
  ]);

  const terminar = React.useCallback(() => {
    if (fase !== "cantando") return;
    cerrarEpigrafe();
    void detenerGrabacion();
    setFase("resumen");
  }, [fase, cerrarEpigrafe, detenerGrabacion]);

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
        void empezar();
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

          {soportado && (
            <div className="mt-9 flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  // Se quita el foco: si no, la barra espaciadora que arranca
                  // el cante volvería a pulsar este botón.
                  e.currentTarget.blur();
                  void alternarGrabacion();
                }}
                aria-pressed={quiereGrabar}
                className={cx(
                  "inline-flex items-center gap-2.5 h-10 px-4 rounded-full border text-[13px] transition-colors",
                  quiereGrabar
                    ? "text-fg border-[var(--border-strong)] bg-[var(--surface-2)]"
                    : "text-subtle border-[var(--border)] hover:text-fg",
                )}
              >
                {quiereGrabar ? (
                  <Mic className="size-4" style={{ color: "var(--lacre-bright)" }} />
                ) : (
                  <MicOff className="size-4" />
                )}
                {quiereGrabar ? "Se grabará el audio" : "Sin grabar el audio"}
              </button>
              <p className="text-[12px] text-subtle max-w-md leading-relaxed">
                {quiereGrabar
                  ? "La grabación se queda en este dispositivo. Después podrás escucharla y, si tienes el texto del tema, comparar lo que dijiste con lo que ponía."
                  : "El cante se cronometra igual; simplemente no se guarda el audio."}
              </p>
            </div>
          )}

          {avisoAudio && (
            <p className="text-[12.5px] mt-4 text-[var(--warn)] leading-relaxed">
              {avisoAudio}
            </p>
          )}

          <div className="mt-10">
            <Boton
              variante="primario"
              tam="lg"
              onClick={() => void empezar()}
              className="px-10"
            >
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
            {grabando && (
              // Indicador y nada más: pulsar aquí no abre diálogos ni
              // confirmaciones. Detener la grabación no detiene el cante.
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  void detenerGrabacion();
                }}
                title="Dejar de grabar (el cante sigue)"
                className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-subtle hover:text-fg transition-colors self-center mr-1"
              >
                <span
                  className="size-2 rounded-full animate-pulse"
                  style={{ background: "var(--lacre-bright)" }}
                />
                Grabando
              </button>
            )}
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
      audio={audio}
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
  audio,
  onGuardar,
  onAnalisis,
  onSalir,
}: {
  tema: { id: string; numero: number; titulo: string; materiaId: string };
  materia?: { id: string; nombre: string; color: string };
  registrados: CanteEpigrafe[];
  cantesPrevios: import("@/lib/data/types").Cante[];
  perfil: import("@/lib/data/types").Perfil;
  audio: ResultadoGrabacion | null;
  onGuardar: (
    c: Omit<import("@/lib/data/types").Cante, "id" | "fecha" | "actualizado"> & {
      fecha?: number;
    },
  ) => import("@/lib/data/types").Cante;
  onAnalisis: (id: string, a: import("@/lib/data/types").AnalisisCante) => void;
  onSalir: () => void;
}) {
  const ia = useIA();
  const ficha = useFicha();
  const setAudioCante = useStore((s) => s.setAudioCante);

  const [conservarAudio, setConservarAudio] = React.useState(true);
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

  // El cante creado, por si hay que volver a pulsar "Guardar" tras un fallo
  // del análisis o de la grabación: sin esto, el segundo intento crearía un
  // cante duplicado con las mismas horas.
  const creado = React.useRef<import("@/lib/data/types").Cante | null>(null);

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    const cante =
      creado.current ??
      onGuardar({
        temaId: tema.id,
        segundos,
        epigrafes: registrados,
        nota: nota ?? undefined,
        conPreparador,
        feedback: feedback.trim() || undefined,
      });
    creado.current = cante;

    // La grabación, ANTES del análisis: el blob ya está en memoria y
    // escribirlo es lo único que puede perderse al cerrar la pestaña. Va al
    // almacén de audio, indexado por el id del cante, nunca al store.
    if (audio && conservarAudio) {
      const ok = await guardarAudio(cante.id, {
        blob: audio.blob,
        mime: audio.mime,
        segundos: audio.segundos,
        creado: Date.now(),
      });
      if (ok) {
        // Por el store, para que el reloj se selle y la fila viaje: la ruta
        // de Storage la rellena después la subida (lib/audio/subida.ts).
        setAudioCante(cante.id, {
          mime: audio.mime,
          bytes: audio.blob.size,
          segundos: audio.segundos,
          marcas: audio.marcas,
        });
      } else {
        setError(
          "El cante está guardado, pero la grabación no ha cabido en este navegador " +
            "(sin espacio o en modo incógnito). Vuelve a pulsar Guardar para seguir sin ella.",
        );
        setConservarAudio(false);
        setGuardando(false);
        return;
      }
    }

    // `listo` y no `disponible`: si la instalación pide sesión y no la hay,
    // el análisis daría 401 y el cante quedaría guardado con un error al
    // lado. Se guarda igual, sin analizar, y la casilla ya lo avisaba.
    if (analizar && ia.listo) {
      try {
        const detalle = construirDetalleCante(
          cante,
          tema as never,
          materia as never,
          cantesPrevios,
          perfil.minutosPorTema,
        );
        const r = await pedirIA("/api/ai/analisis-cante", {
          detalleCante: detalle,
          ficha: ficha(),
          estilo: perfil.estiloFeedback,
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

        {audio && (
          <label className="flex items-start gap-3 mb-5 cursor-pointer px-4 py-3.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)]">
            <input
              type="checkbox"
              checked={conservarAudio}
              onChange={(e) => setConservarAudio(e.target.checked)}
              className="size-4 accent-[var(--lacre-bright)] mt-0.5"
            />
            <span>
              <span className="text-[13.5px] font-medium flex items-center gap-2">
                <Mic className="size-3.5 text-[var(--lacre-bright)]" />
                Guardar la grabación ({reloj(audio.segundos)})
              </span>
              <span className="text-[12.5px] text-muted block mt-1 leading-relaxed">
                Se queda en este dispositivo. Si tienes cuenta, sube sola cuando
                haya red; desde la ficha del tema podrás escucharla y compararla
                con el texto del tema.
              </span>
            </span>
          </label>
        )}

        {/* Si lo que falta es la sesión se sigue enseñando la casilla, pero
            apagada y con el motivo: hacerla desaparecer dejaría al opositor
            preguntándose dónde está el análisis que vio la vez anterior. */}
        {(ia.disponible || ia.bloqueado) && (
          <label className="flex items-start gap-3 mb-6 cursor-pointer px-4 py-3.5 rounded-[10px] border"
            style={{
              borderColor: "color-mix(in srgb, var(--laton) 32%, transparent)",
              background: "color-mix(in srgb, var(--laton) 6%, transparent)",
            }}
          >
            <input
              type="checkbox"
              checked={analizar && !ia.bloqueado}
              disabled={ia.bloqueado}
              onChange={(e) => setAnalizar(e.target.checked)}
              className="size-4 accent-[var(--laton)] mt-0.5 disabled:opacity-40"
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
              {ia.bloqueado && (
                <span className="block mt-1.5">
                  <NotaIA ia={ia} />
                </span>
              )}
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
            {guardando && analizar && ia.listo
              ? "Guardando y analizando…"
              : "Guardar cante"}
          </Boton>
        </div>
      </div>
    </div>
  );
}

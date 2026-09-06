"use client";

import * as React from "react";
import Link from "next/link";
import { Brain, Check, Eye, Play, RotateCcw, X } from "lucide-react";
import { useKeyPoints, useMaterias, useProgresos, useStore, useTemas } from "@/lib/store/store";
import { Cabecera } from "@/components/Shell";
import {
  Badge,
  Barra,
  Boton,
  Card,
  Metrica,
  Pestanas,
  Punto,
  TituloSeccion,
  Vacio,
  cx,
} from "@/components/ui";
import { ESTADOS } from "@/lib/data/types";
import { colaDeRepaso, estadoEfectivo, intervaloDias } from "@/lib/data/srs";
import { haceTexto, horasMin } from "@/lib/utils/time";
import { plural } from "@/lib/utils/texto";

export default function Repaso() {
  const [pestana, setPestana] = React.useState<"temas" | "keypoints">("temas");
  const temas = useTemas();
  const progresos = useProgresos();
  const perfil = useStore((s) => s.perfil);
  const keypoints = useKeyPoints();

  const cola = React.useMemo(
    () => colaDeRepaso(temas, progresos, 40),
    [temas, progresos],
  );

  const pendientes = React.useMemo(
    () => keypoints.filter((k) => k.proximoRepaso <= Date.now()),
    [keypoints],
  );

  if (!temas.length) {
    return (
      <>
        <Cabecera titulo="Repaso" />
        <Card className="p-0">
          <Vacio
            icono={<Brain className="size-5" />}
            titulo="Sin temas no hay repaso"
            texto="Da de alta tu programa y la app empezará a calcular cuándo toca volver a cada tema."
            accion={
              <Link href="/programa">
                <Boton variante="primario">Añadir temas</Boton>
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <Cabecera
        titulo="Repaso"
        descripcion="El intervalo de cada tema sale de su estado, tu dificultad declarada, la nota media de cante y las vueltas que llevas. No es Anki: aquí la unidad es el tema."
      />

      <div className="mb-5">
        <Pestanas
          valor={pestana}
          onCambio={setPestana}
          opciones={[
            { id: "temas", label: "Temas oxidados", contador: cola.length },
            { id: "keypoints", label: "Keypoints", contador: pendientes.length },
          ]}
        />
      </div>

      {pestana === "temas" ? <ColaTemas cola={cola} /> : <DrillKeyPoints />}
    </>
  );
}

/* ========================================================================== */

function ColaTemas({
  cola,
}: {
  cola: ReturnType<typeof colaDeRepaso>;
}) {
  const perfil = useStore((s) => s.perfil);
  const temas = useTemas();
  const materias = useMaterias();
  const iniciarCrono = useStore((s) => s.iniciarCrono);

  if (!cola.length) {
    return (
      <Card className="p-0">
        <Vacio
          icono={<Check className="size-5" />}
          titulo="Vas al día"
          texto="Ningún tema se ha pasado de su fecha de repaso. Aprovecha para meter temas nuevos."
          accion={
            <Link href="/programa">
              <Boton variante="secundario">Ver el programa</Boton>
            </Link>
          }
        />
      </Card>
    );
  }

  const criticos = cola.filter((c) => c.urgencia >= 1.6).length;

  return (
    <>
      <div className="grid sm:grid-cols-3 gap-4 mb-5">
        <Card>
          <Metrica valor={cola.length} etiqueta="Temas pasados de fecha" />
        </Card>
        <Card>
          <Metrica
            valor={criticos}
            etiqueta="En rojo"
            color={criticos ? "var(--danger)" : undefined}
            sub="más del 60% pasados de plazo"
          />
        </Card>
        <Card>
          <Metrica
            valor={cola[0]?.diasSinTocar ?? 0}
            sufijo="días"
            etiqueta="El más abandonado"
          />
        </Card>
      </div>

      <Card className="p-0 overflow-hidden">
        {cola.map((c, i) => {
          const estado = estadoEfectivo(c.progreso, perfil.diasOxido);
          const meta = ESTADOS.find((e) => e.id === estado)!;
          const materia = materias.find((m) => m.id === c.tema.materiaId);
          const intervalo = intervaloDias(c.progreso);
          const exceso = Math.round((c.urgencia - 1) * 100);

          return (
            <div
              key={c.tema.id}
              className={cx(
                "flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 hover:bg-[var(--surface-2)] transition-colors",
                i > 0 && "border-t border-[var(--border)]",
              )}
            >
              <Punto color={meta.color} />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/tema/${c.tema.id}`}
                  className="text-[13.5px] hover:underline truncate block"
                >
                  <span className="text-subtle numeric mr-2">T{c.tema.numero}</span>
                  {c.tema.titulo}
                </Link>
                <p className="text-[11.5px] text-subtle mt-0.5">
                  {materia?.nombre} · toca cada {intervalo} días · última vez{" "}
                  {haceTexto(
                    c.progreso.ultimoCante ?? c.progreso.ultimoEstudio ?? Date.now(),
                  )}
                </p>
              </div>

              <div className="w-24 shrink-0">
                <Barra
                  valor={Math.min(100, c.urgencia * 62)}
                  color={
                    c.urgencia >= 1.6
                      ? "var(--danger)"
                      : c.urgencia >= 1.2
                        ? "var(--warn)"
                        : "var(--info)"
                  }
                  alto={5}
                />
                <p className="text-[10.5px] text-subtle mt-1 numeric text-right">
                  {exceso > 0 ? `+${exceso}%` : "en plazo"}
                </p>
              </div>

              <div className="flex gap-1.5 shrink-0">
                <Boton
                  tam="sm"
                  variante="secundario"
                  onClick={() => iniciarCrono("repaso", c.tema.id)}
                >
                  <Play className="size-3.5" />
                  Repasar
                </Boton>
                <Link href={`/cante/vivo?tema=${c.tema.id}`}>
                  <Boton tam="sm" variante="primario">
                    Cantar
                  </Boton>
                </Link>
              </div>
            </div>
          );
        })}
      </Card>
    </>
  );
}

/* ========================================================================== */
/*                          Drill de keypoints                                */
/* ========================================================================== */

function DrillKeyPoints() {
  const keypoints = useKeyPoints();
  const temas = useTemas();
  const responder = useStore((s) => s.responderKeyPoint);

  const [cola, setCola] = React.useState<string[]>([]);
  const [i, setI] = React.useState(0);
  const [revelado, setRevelado] = React.useState(false);
  const [resultados, setResultados] = React.useState({ ok: 0, ko: 0 });
  const [activo, setActivo] = React.useState(false);

  const pendientes = React.useMemo(
    () => keypoints.filter((k) => k.proximoRepaso <= Date.now()),
    [keypoints],
  );

  const empezar = (todos: boolean) => {
    const base = todos ? keypoints : pendientes;
    const ids = base.map((k) => k.id).sort(() => Math.random() - 0.5);
    setCola(ids);
    setI(0);
    setRevelado(false);
    setResultados({ ok: 0, ko: 0 });
    setActivo(true);
  };

  const actual = activo ? keypoints.find((k) => k.id === cola[i]) : undefined;

  const contestar = (acierto: boolean) => {
    if (!actual) return;
    responder(actual.id, acierto);
    setResultados((r) => ({
      ok: r.ok + (acierto ? 1 : 0),
      ko: r.ko + (acierto ? 0 : 1),
    }));
    if (i + 1 >= cola.length) {
      setActivo(false);
    } else {
      setI((v) => v + 1);
      setRevelado(false);
    }
  };

  React.useEffect(() => {
    if (!activo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        if (!revelado) setRevelado(true);
      } else if (revelado && (e.key === "1" || e.key === "ArrowLeft")) {
        contestar(false);
      } else if (revelado && (e.key === "2" || e.key === "ArrowRight")) {
        contestar(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!keypoints.length) {
    return (
      <Card className="p-0">
        <Vacio
          icono={<Brain className="size-5" />}
          titulo="No tienes keypoints"
          texto="Los keypoints son los datos que se caen en el cante: artículos, plazos, listas. Se crean desde la ficha de cada tema, a mano o extrayéndolos del texto con IA."
          accion={
            <Link href="/programa">
              <Boton variante="secundario">Ir al programa</Boton>
            </Link>
          }
        />
      </Card>
    );
  }

  if (!activo) {
    const acertadas = keypoints.reduce((a, k) => a + k.aciertos, 0);
    const falladas = keypoints.reduce((a, k) => a + k.fallos, 0);
    const total = acertadas + falladas;

    return (
      <>
        {(resultados.ok > 0 || resultados.ko > 0) && (
          <Card className="mb-4 flex items-center gap-6">
            <div className="flex-1">
              <p className="text-[15px] font-medium">Ronda terminada</p>
              <p className="text-[13px] text-muted mt-1">
                {resultados.ok} aciertos y {resultados.ko} fallos de{" "}
                {resultados.ok + resultados.ko}.
              </p>
            </div>
            <Boton variante="secundario" onClick={() => empezar(false)}>
              <RotateCcw className="size-4" />
              Otra ronda
            </Boton>
          </Card>
        )}

        <div className="grid sm:grid-cols-3 gap-4 mb-5">
          <Card>
            <Metrica valor={keypoints.length} etiqueta="Keypoints en total" />
          </Card>
          <Card>
            <Metrica
              valor={pendientes.length}
              etiqueta="Tocan hoy"
              color={pendientes.length ? "var(--laton)" : undefined}
            />
          </Card>
          <Card>
            <Metrica
              valor={total ? `${Math.round((acertadas / total) * 100)}%` : "—"}
              etiqueta="Acierto histórico"
              sub={`${total} respuestas`}
            />
          </Card>
        </div>

        <Card className="p-0">
          <Vacio
            icono={<Brain className="size-5" />}
            titulo={
              pendientes.length
                ? `${plural(pendientes.length, "keypoint")} te ${pendientes.length === 1 ? "espera" : "esperan"}`
                : "Nada pendiente por hoy"
            }
            texto="Espacio para ver la respuesta, 1 si has fallado, 2 si la sabías."
            accion={
              <div className="flex gap-2">
                {pendientes.length > 0 && (
                  <Boton variante="primario" onClick={() => empezar(false)}>
                    Repasar los de hoy
                  </Boton>
                )}
                <Boton variante="secundario" onClick={() => empezar(true)}>
                  Repasar todos
                </Boton>
              </div>
            }
          />
        </Card>
      </>
    );
  }

  if (!actual) return null;
  const tema = temas.find((t) => t.id === actual.temaId);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[12px] text-subtle numeric">
          {i + 1} / {cola.length}
        </span>
        <div className="flex items-center gap-3 text-[12px]">
          <span style={{ color: "var(--ok)" }}>{resultados.ok}✓</span>
          <span style={{ color: "var(--danger)" }}>{resultados.ko}✗</span>
          <button
            onClick={() => setActivo(false)}
            className="text-subtle hover:text-fg transition-colors ml-2"
          >
            Salir
          </button>
        </div>
      </div>

      <Barra valor={((i + 1) / cola.length) * 100} alto={4} />

      <Card className="mt-5 min-h-[280px] flex flex-col justify-center text-center py-12">
        {tema && (
          <p className="text-[11px] uppercase tracking-[0.14em] text-subtle mb-5">
            T{tema.numero} · {tema.titulo.slice(0, 60)}
          </p>
        )}
        <p className="font-serif text-[22px] sm:text-[26px] leading-snug px-4">
          {actual.anverso}
        </p>

        {revelado ? (
          <>
            <div className="hairline my-7 mx-8" />
            <p className="text-[17px] leading-relaxed px-6 text-[var(--laton)]">
              {actual.reverso}
            </p>
          </>
        ) : (
          <div className="mt-9">
            <Boton variante="secundario" onClick={() => setRevelado(true)}>
              <Eye className="size-4" />
              Ver respuesta
            </Boton>
          </div>
        )}
      </Card>

      {revelado && (
        <div className="grid grid-cols-2 gap-3 mt-4">
          <Boton
            variante="secundario"
            tam="lg"
            onClick={() => contestar(false)}
            className="border-[color-mix(in_srgb,var(--danger)_40%,transparent)] text-[var(--danger)]"
          >
            <X className="size-4" />
            La he fallado
          </Boton>
          <Boton
            variante="secundario"
            tam="lg"
            onClick={() => contestar(true)}
            className="border-[color-mix(in_srgb,var(--ok)_40%,transparent)] text-[var(--ok)]"
          >
            <Check className="size-4" />
            La sabía
          </Boton>
        </div>
      )}
    </div>
  );
}

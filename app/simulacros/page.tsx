"use client";

import * as React from "react";
import Link from "next/link";
import {
  Check,
  Dices,
  FileText,
  Play,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import {
  useCantes,
  useMaterias,
  useProgresos,
  useSimulacros,
  useStore,
  useTemas,
} from "@/lib/store/store";
import { materiasOrdenadas } from "@/lib/data/materias";
import { Cabecera } from "@/components/Shell";
import {
  AreaTexto,
  Badge,
  Boton,
  Campo,
  Card,
  Metrica,
  Pestanas,
  Punto,
  TituloSeccion,
  Vacio,
  cx,
} from "@/components/ui";
import { urgencia } from "@/lib/data/srs";
import { fecha, reloj } from "@/lib/utils/time";
import { useIA, pedirIA } from "@/lib/ai/hooks";
import { NotaIA } from "@/components/AvisoIA";
import type { Simulacro, Tema } from "@/lib/data/types";

export default function Simulacros() {
  const [pestana, setPestana] = React.useState<"cante" | "dictamen">("cante");
  const simulacros = useSimulacros();

  return (
    <>
      <Cabecera
        titulo="Simulacros"
        descripcion="Reproduce las condiciones del examen: bolas al azar, tiempo tasado y corrección al final."
      />
      <div className="mb-5">
        <Pestanas
          valor={pestana}
          onCambio={setPestana}
          opciones={[
            {
              id: "cante",
              label: "Bombo de cante",
              contador: simulacros.filter((s) => s.tipo === "cante").length,
            },
            {
              id: "dictamen",
              label: "Dictamen",
              contador: simulacros.filter((s) => s.tipo === "dictamen").length,
            },
          ]}
        />
      </div>

      {pestana === "cante" ? <Bombo /> : <Dictamen />}

      <Historial tipo={pestana} />
    </>
  );
}

/* ========================================================================== */
/*                             Bombo de cante                                 */
/* ========================================================================== */

function Bombo() {
  const temas = useTemas();
  const materiasSinOrdenar = useMaterias();
  const cantes = useCantes();
  const progresos = useProgresos();
  const materias = React.useMemo(
    () => materiasOrdenadas(materiasSinOrdenar),
    [materiasSinOrdenar],
  );
  const addSimulacro = useStore((s) => s.addSimulacro);
  const updateSimulacro = useStore((s) => s.updateSimulacro);

  const [cuantos, setCuantos] = React.useState(5);
  const [materiasSel, setMateriasSel] = React.useState<string[]>([]);
  const [excluirRecientes, setExcluirRecientes] = React.useState(true);
  const [ponderar, setPonderar] = React.useState(false);
  const [sorteando, setSorteando] = React.useState(false);
  const [sorteados, setSorteados] = React.useState<Tema[]>([]);
  const [enCurso, setEnCurso] = React.useState<Simulacro | null>(null);
  const [notas, setNotas] = React.useState<(number | null)[]>([]);

  const elegibles = React.useMemo(() => {
    const hace14dias = Date.now() - 14 * 86_400_000;
    return temas.filter((t) => {
      if (materiasSel.length && !materiasSel.includes(t.materiaId)) return false;
      if (excluirRecientes) {
        const ultimo = progresos[t.id]?.ultimoCante;
        if (ultimo && ultimo > hace14dias) return false;
      }
      return true;
    });
  }, [temas, materiasSel, excluirRecientes, progresos]);

  const sortear = () => {
    if (elegibles.length === 0) return;
    setSorteando(true);
    setSorteados([]);

    // El bombo: si se pondera, los temas más flojos entran más veces.
    const bombo: Tema[] = [];
    for (const t of elegibles) {
      const p = progresos[t.id];
      let peso = 1;
      if (ponderar && p) {
        const u = urgencia(p);
        const nota = p.notaMedia ?? 5;
        peso = Math.max(1, Math.round(u * 2 + (10 - nota) / 2));
      }
      for (let i = 0; i < peso; i++) bombo.push(t);
    }

    const elegidos: Tema[] = [];
    const usados = new Set<string>();
    let intentos = 0;
    while (elegidos.length < Math.min(cuantos, elegibles.length) && intentos < 5000) {
      const t = bombo[Math.floor(Math.random() * bombo.length)];
      if (!usados.has(t.id)) {
        usados.add(t.id);
        elegidos.push(t);
      }
      intentos++;
    }

    // Animación de bolas cayendo, una por una.
    elegidos.forEach((t, i) => {
      setTimeout(() => {
        setSorteados((prev) => [...prev, t]);
        if (i === elegidos.length - 1) setSorteando(false);
      }, 320 * (i + 1));
    });
  };

  const empezar = () => {
    const s = addSimulacro({
      tipo: "cante",
      fecha: Date.now(),
      temaIds: sorteados.map((t) => t.id),
      minutos: sorteados.length * useStore.getState().perfil.minutosPorTema,
      segundosUsados: 0,
      notas: sorteados.map(() => null),
      completado: false,
    });
    setEnCurso(s);
    setNotas(sorteados.map(() => null));
  };

  const cerrar = () => {
    if (!enCurso) return;
    updateSimulacro(enCurso.id, { notas, completado: true });
    setEnCurso(null);
    setSorteados([]);
    setNotas([]);
  };

  if (enCurso) {
    return (
      <Card className="mb-5">
        <TituloSeccion>Simulacro en curso — pon nota a cada tema</TituloSeccion>
        <div className="space-y-4">
          {sorteados.map((t, i) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3">
              <span className="text-[13.5px] flex-1 min-w-[200px] truncate">
                <span className="text-subtle numeric mr-2">T{t.numero}</span>
                {t.titulo}
              </span>
              <div className="flex gap-1">
                {Array.from({ length: 11 }, (_, n) => n).map((n) => (
                  <button
                    key={n}
                    onClick={() =>
                      setNotas((prev) => {
                        const c = [...prev];
                        c[i] = c[i] === n ? null : n;
                        return c;
                      })
                    }
                    className={cx(
                      "size-7 rounded-md border text-[11.5px] numeric transition-all",
                      notas[i] === n
                        ? "text-white border-transparent"
                        : "border-[var(--border)] text-muted hover:text-fg",
                    )}
                    style={
                      notas[i] === n
                        ? {
                            background:
                              n >= 7
                                ? "var(--ok)"
                                : n >= 5
                                  ? "var(--warn)"
                                  : "var(--danger)",
                          }
                        : undefined
                    }
                  >
                    {n}
                  </button>
                ))}
              </div>
              <Link href={`/cante/vivo?tema=${t.id}`}>
                <Boton tam="sm" variante="secundario">
                  Cantar
                </Boton>
              </Link>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Boton variante="fantasma" onClick={() => setEnCurso(null)}>
            Dejarlo a medias
          </Boton>
          <Boton variante="primario" onClick={cerrar}>
            <Check className="size-4" />
            Cerrar simulacro
          </Boton>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid lg:grid-cols-[1fr_1.3fr] gap-4 mb-5">
      <Card>
        <TituloSeccion>Configurar el bombo</TituloSeccion>

        <Campo
          etiqueta="Temas a sortear"
          type="number"
          min={1}
          max={20}
          value={cuantos}
          onChange={(e) => setCuantos(Math.max(1, Number(e.target.value) || 1))}
          className="mb-4"
        />

        <span className="block text-xs font-medium text-muted mb-2">
          Materias (vacío = todas)
        </span>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {materias.map((m) => {
            const activo = materiasSel.includes(m.id);
            return (
              <button
                key={m.id}
                onClick={() =>
                  setMateriasSel((prev) =>
                    activo ? prev.filter((x) => x !== m.id) : [...prev, m.id],
                  )
                }
                className={cx(
                  "h-8 px-3 rounded-lg border text-[12.5px] inline-flex items-center gap-2 transition-all",
                  activo
                    ? "text-fg"
                    : "border-[var(--border)] text-muted hover:text-fg",
                )}
                style={
                  activo
                    ? {
                        borderColor: `color-mix(in srgb, ${m.color} 55%, transparent)`,
                        background: `color-mix(in srgb, ${m.color} 14%, transparent)`,
                      }
                    : undefined
                }
              >
                <Punto color={m.color} size={6} />
                {m.abrev}
              </button>
            );
          })}
        </div>

        <label className="flex items-start gap-2.5 mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={excluirRecientes}
            onChange={(e) => setExcluirRecientes(e.target.checked)}
            className="size-4 accent-[var(--lacre-bright)] mt-0.5"
          />
          <span className="text-[13px] leading-snug">
            Excluir los cantados en los últimos 14 días
            <span className="block text-[11.5px] text-subtle mt-0.5">
              Para que no salga siempre lo que acabas de trabajar
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2.5 mb-5 cursor-pointer">
          <input
            type="checkbox"
            checked={ponderar}
            onChange={(e) => setPonderar(e.target.checked)}
            className="size-4 accent-[var(--lacre-bright)] mt-0.5"
          />
          <span className="text-[13px] leading-snug">
            Cargar el bombo hacia tus temas flojos
            <span className="block text-[11.5px] text-subtle mt-0.5">
              Más papeletas para los oxidados y los de nota baja
            </span>
          </span>
        </label>

        <p className="text-[12px] text-subtle mb-4">
          {elegibles.length} temas entran en el bombo con estos filtros.
        </p>

        <Boton
          variante="primario"
          tam="lg"
          className="w-full"
          onClick={sortear}
          disabled={sorteando || elegibles.length === 0}
        >
          <Dices className={cx("size-4", sorteando && "animate-spin")} />
          {sorteando ? "Sorteando…" : "Sacar bolas"}
        </Boton>
      </Card>

      <Card>
        <TituloSeccion>Bolas</TituloSeccion>
        {sorteados.length === 0 ? (
          <Vacio
            icono={<Dices className="size-5" />}
            titulo="El bombo está parado"
            texto="Configura el sorteo y saca las bolas. Igual que en el examen: no eliges tú."
          />
        ) : (
          <>
            <div className="space-y-2.5">
              {sorteados.map((t, i) => {
                const m = materias.find((x) => x.id === t.materiaId);
                return (
                  <div
                    key={t.id}
                    className="flex items-center gap-3.5 px-4 py-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] animate-rise"
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    <span
                      className="size-9 rounded-full grid place-items-center numeric text-[13px] font-semibold shrink-0"
                      style={{
                        background: `color-mix(in srgb, ${m?.color ?? "var(--laton)"} 22%, var(--surface))`,
                        border: `1px solid color-mix(in srgb, ${m?.color ?? "var(--laton)"} 50%, transparent)`,
                        color: m?.color,
                      }}
                    >
                      {t.numero}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] truncate">{t.titulo}</p>
                      <p className="text-[11.5px] text-subtle mt-0.5">{m?.nombre}</p>
                    </div>
                    <Link href={`/tema/${t.id}`}>
                      <Boton tam="sm" variante="fantasma">
                        Ver
                      </Boton>
                    </Link>
                  </div>
                );
              })}
            </div>

            {!sorteando && (
              <div className="flex justify-end gap-2 mt-5">
                <Boton variante="secundario" onClick={sortear}>
                  <Dices className="size-4" />
                  Repetir sorteo
                </Boton>
                <Boton variante="primario" onClick={empezar}>
                  <Play className="size-4" />
                  Empezar simulacro
                </Boton>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

/* ========================================================================== */
/*                                 Dictamen                                   */
/* ========================================================================== */

function Dictamen() {
  const ia = useIA();
  const perfil = useStore((s) => s.perfil);
  const temas = useTemas();
  const addSimulacro = useStore((s) => s.addSimulacro);

  const [supuesto, setSupuesto] = React.useState("");
  const [respuesta, setRespuesta] = React.useState("");
  const [correccion, setCorreccion] = React.useState("");
  const [minutos, setMinutos] = React.useState(240);
  const [inicio, setInicio] = React.useState<number | null>(null);
  const [ahora, setAhora] = React.useState(Date.now());
  const [cargando, setCargando] = React.useState<"generar" | "corregir" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!inicio) return;
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [inicio]);

  const restante = inicio
    ? Math.max(0, minutos * 60 - Math.floor((ahora - inicio) / 1000))
    : minutos * 60;

  const llamar = async (modo: "generar" | "corregir") => {
    setCargando(modo);
    setError(null);
    try {
      const r = await pedirIA("/api/ai/dictamen", {
        modo,
        supuesto,
        respuesta,
        estilo: perfil.estiloFeedback,
        temas: temas
          .slice(0, 40)
          .map((t) => `T${t.numero} ${t.titulo}`)
          .join("; "),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.mensaje ?? "El modelo no ha podido responder.");
        return;
      }
      if (modo === "generar") {
        setSupuesto(d.texto);
        setRespuesta("");
        setCorreccion("");
      } else {
        setCorreccion(d.texto);
        addSimulacro({
          tipo: "dictamen",
          fecha: Date.now(),
          temaIds: [],
          minutos,
          segundosUsados: inicio ? Math.floor((Date.now() - inicio) / 1000) : 0,
          notas: [],
          supuesto,
          respuesta,
          correccion: d.texto,
          completado: true,
        });
        setInicio(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(null);
    }
  };

  return (
    <div className="space-y-4 mb-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-subtle">
            Supuesto práctico
          </h2>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={minutos}
              onChange={(e) => setMinutos(Number(e.target.value) || 240)}
              className="w-20 h-8 px-2.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] text-[13px] numeric outline-none"
              aria-label="Minutos"
            />
            <span className="text-[12px] text-subtle mr-2">min</span>
            {inicio ? (
              <>
                <span
                  className="numeric text-[18px] font-semibold"
                  style={{ color: restante < 600 ? "var(--danger)" : "var(--fg)" }}
                >
                  {reloj(restante, true)}
                </span>
                <Boton tam="sm" variante="secundario" onClick={() => setInicio(null)}>
                  <Square className="size-3.5" />
                  Parar
                </Boton>
              </>
            ) : (
              <Boton
                tam="sm"
                variante="secundario"
                onClick={() => setInicio(Date.now())}
                disabled={!supuesto.trim()}
              >
                <Play className="size-3.5" />
                Arrancar reloj
              </Boton>
            )}
            {(ia.disponible || ia.bloqueado) && (
              <Boton
                tam="sm"
                variante="oro"
                onClick={() => llamar("generar")}
                cargando={cargando === "generar"}
                disabled={!ia.listo}
                title={ia.bloqueado ? "Inicia sesión para usar la IA" : undefined}
              >
                <Sparkles className="size-3.5" />
                Generar supuesto
              </Boton>
            )}
          </div>
        </div>

        <AreaTexto
          rows={supuesto ? 12 : 5}
          value={supuesto}
          onChange={(e) => setSupuesto(e.target.value)}
          placeholder="Pega aquí el supuesto de tu preparador, o pide uno a la IA."
          className="prose-tema"
        />
      </Card>

      <Card>
        <TituloSeccion>Tu dictamen</TituloSeccion>
        <AreaTexto
          rows={16}
          value={respuesta}
          onChange={(e) => setRespuesta(e.target.value)}
          placeholder="Redacta aquí. Identifica las instituciones, ordena, fundamenta y mójate con una solución."
          className="prose-tema"
        />
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <span className="text-[12px] text-subtle numeric">
            {respuesta.trim().split(/\s+/).filter(Boolean).length} palabras
          </span>
          <Boton
            variante="primario"
            onClick={() => llamar("corregir")}
            cargando={cargando === "corregir"}
            disabled={!ia.listo || !respuesta.trim()}
          >
            <Sparkles className="size-4" />
            Corregir con la rúbrica
          </Boton>
        </div>
        <p className="text-[12px] mt-2 text-right">
          <NotaIA ia={ia} />
        </p>
        {error && (
          <p className="text-[13px] text-[var(--danger)] mt-3">{error}</p>
        )}
      </Card>

      {correccion && (
        <Card
          style={{
            borderColor: "color-mix(in srgb, var(--laton) 32%, transparent)",
            background: "color-mix(in srgb, var(--laton) 5%, transparent)",
          }}
        >
          <TituloSeccion>Corrección</TituloSeccion>
          <div className="prose-tema whitespace-pre-wrap text-[14.5px]">
            {correccion}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ========================================================================== */

function Historial({ tipo }: { tipo: "cante" | "dictamen" }) {
  const todos = useSimulacros();
  const simulacros = React.useMemo(
    () => todos.filter((x) => x.tipo === tipo).sort((a, b) => b.fecha - a.fecha),
    [todos, tipo],
  );
  const temas = useTemas();
  const remove = useStore((s) => s.removeSimulacro);

  if (!simulacros.length) return null;

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-[var(--border)]">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-subtle">
          Histórico
        </h2>
      </div>
      {simulacros.map((s, i) => {
        const notas = s.notas.filter((n): n is number => n != null);
        const media = notas.length
          ? Number((notas.reduce((a, b) => a + b, 0) / notas.length).toFixed(1))
          : null;
        return (
          <div
            key={s.id}
            className={cx(
              "flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 group",
              i > 0 && "border-t border-[var(--border)]",
            )}
          >
            <span className="text-[13px] shrink-0 w-28">{fecha(s.fecha)}</span>
            <div className="min-w-0 flex-1">
              {s.tipo === "cante" ? (
                <p className="text-[12.5px] text-muted truncate">
                  {s.temaIds
                    .map((id) => {
                      const t = temas.find((x) => x.id === id);
                      return t ? `T${t.numero}` : "?";
                    })
                    .join(" · ")}
                </p>
              ) : (
                <p className="text-[12.5px] text-muted truncate">
                  {s.supuesto?.slice(0, 90) ?? "Dictamen"}…
                </p>
              )}
            </div>
            {!s.completado && <Badge color="var(--warn)">a medias</Badge>}
            {media != null && (
              <span
                className="numeric text-[15px] font-semibold shrink-0"
                style={{
                  color:
                    media >= 7 ? "var(--ok)" : media >= 5 ? "var(--warn)" : "var(--danger)",
                }}
              >
                {media}
              </span>
            )}
            <button
              onClick={() => remove(s.id)}
              className="opacity-0 group-hover:opacity-100 text-subtle hover:text-[var(--danger)] transition-all shrink-0"
              aria-label="Borrar"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        );
      })}
    </Card>
  );
}

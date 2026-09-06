"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  Brain,
  ChevronDown,
  ListTree,
  Mic,
  NotebookPen,
  Play,
  Plus,
  Sparkles,
  Star,
  Trash2,
  Wand2,
} from "lucide-react";
import { useStore } from "@/lib/store/store";
import {
  AreaTexto,
  Badge,
  Barra,
  Boton,
  Campo,
  Card,
  Metrica,
  Modal,
  Pestanas,
  Punto,
  TituloSeccion,
  Vacio,
  cx,
  useConfirmacion,
} from "@/components/ui";
import { ComparativaEpigrafes, Linea } from "@/components/graficos";
import { ESTADOS, type AnalisisCante, type Cante } from "@/lib/data/types";
import { estadoEfectivo, intervaloDias, ultimoContacto } from "@/lib/data/srs";
import { aEpigrafes, minutosEstimados, parsearEpigrafes } from "@/lib/data/parser";
import { fecha, haceTexto, horasMin, reloj } from "@/lib/utils/time";
import { plural } from "@/lib/utils/texto";
import { useFicha, useIA } from "@/lib/ai/hooks";
import { construirDetalleCante } from "@/lib/ai/contexto";
import { TarjetaAnalisis } from "@/components/TarjetaAnalisis";

type Pestana = "epigrafes" | "cantes" | "keypoints" | "notas";

export default function FichaTema() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const tema = useStore((s) => s.temas.find((t) => t.id === id));
  const materias = useStore((s) => s.materias);
  const progresos = useStore((s) => s.progresos);
  const perfil = useStore((s) => s.perfil);
  const cantes = useStore((s) => s.cantes);
  const keypoints = useStore((s) => s.keypoints);
  const notas = useStore((s) => s.notas);

  const setEstado = useStore((s) => s.setEstado);
  const setDificultad = useStore((s) => s.setDificultad);
  const alternarFavorito = useStore((s) => s.alternarFavorito);
  const iniciarCrono = useStore((s) => s.iniciarCrono);
  const updateTema = useStore((s) => s.updateTema);
  const removeTema = useStore((s) => s.removeTema);

  const [pestana, setPestana] = React.useState<Pestana>("epigrafes");
  const { pedir, dialogo } = useConfirmacion();

  if (!tema) {
    return (
      <Card className="p-0">
        <Vacio
          titulo="Este tema ya no existe"
          texto="Puede que lo hayas borrado o que hayas importado otro expediente."
          accion={
            <Link href="/programa">
              <Boton variante="secundario">Volver al programa</Boton>
            </Link>
          }
        />
      </Card>
    );
  }

  const progreso = progresos[tema.id] ?? {
    temaId: tema.id,
    estado: "nuevo" as const,
    segundos: 0,
    dificultad: 3,
    vueltas: 0,
  };
  const materia = materias.find((m) => m.id === tema.materiaId);
  const estado = estadoEfectivo(progreso, perfil.diasOxido);
  const metaEstado = ESTADOS.find((e) => e.id === estado)!;

  const misCantes = React.useMemo(
    () => cantes.filter((c) => c.temaId === tema.id).sort((a, b) => b.fecha - a.fecha),
    [cantes, tema.id],
  );
  const misKeypoints = keypoints.filter((k) => k.temaId === tema.id);
  const misNotas = notas.filter((n) => n.temaId === tema.id);

  const ultimo = ultimoContacto(progreso);
  const intervalo = intervaloDias(progreso);

  return (
    <>
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-2 text-[13px] text-muted hover:text-fg transition-colors mb-5"
      >
        <ArrowLeft className="size-4" />
        Volver
      </button>

      {/* ------------------------------ Cabecera ----------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-5 mb-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 mb-2.5">
            {materia && (
              <Badge color={materia.color}>
                <Punto color={materia.color} size={6} />
                {materia.nombre}
              </Badge>
            )}
            <Badge color={metaEstado.color}>{metaEstado.label}</Badge>
            {progreso.vueltas > 0 && (
              <span className="text-[11.5px] text-subtle">
                {progreso.vueltas}ª vuelta
              </span>
            )}
          </div>
          <h1 className="font-serif text-[26px] sm:text-[30px] font-semibold leading-tight tracking-[-0.02em]">
            <span className="text-subtle numeric mr-3">{tema.numero}</span>
            {tema.titulo}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => alternarFavorito(tema.id)}
            className={cx(
              "size-10 grid place-items-center rounded-[10px] border transition-colors",
              progreso.favorito
                ? "border-[var(--laton)] text-[var(--laton)] bg-[var(--laton-soft)]"
                : "border-[var(--border)] text-subtle hover:text-fg",
            )}
            aria-label="Marcar como prioritario"
            title="Marcar como prioritario"
          >
            <Star className={cx("size-4", progreso.favorito && "fill-current")} />
          </button>
          <Boton onClick={() => iniciarCrono("estudio", tema.id)}>
            <Play className="size-4" />
            Estudiar
          </Boton>
          <Link href={`/cante/vivo?tema=${tema.id}`}>
            <Boton variante="primario">
              <Mic className="size-4" />
              Cantar
            </Boton>
          </Link>
        </div>
      </div>

      {/* ------------------------------ Métricas ----------------------------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <Card>
          <Metrica valor={horasMin(progreso.segundos)} etiqueta="Tiempo invertido" />
        </Card>
        <Card>
          <Metrica
            valor={progreso.notaMedia ?? "—"}
            sufijo={progreso.notaMedia != null ? "/10" : undefined}
            etiqueta="Nota media"
            sub={plural(misCantes.length, "cante")}
            color={
              progreso.notaMedia == null
                ? undefined
                : progreso.notaMedia >= 7
                  ? "var(--ok)"
                  : progreso.notaMedia >= 5
                    ? "var(--warn)"
                    : "var(--danger)"
            }
          />
        </Card>
        <Card>
          <Metrica
            valor={ultimo ? haceTexto(ultimo) : "nunca"}
            etiqueta="Último contacto"
            sub={ultimo ? fecha(ultimo) : "sin actividad"}
          />
        </Card>
        <Card>
          <Metrica
            valor={intervalo}
            sufijo="días"
            etiqueta="Intervalo de repaso"
            sub="calculado por el SRS"
          />
        </Card>
      </div>

      {/* -------------------------- Estado y dificultad ---------------------- */}
      <Card className="mb-5">
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <TituloSeccion>Estado del tema</TituloSeccion>
            <div className="flex flex-wrap gap-1.5">
              {ESTADOS.filter((e) => e.id !== "oxidado").map((e) => (
                <button
                  key={e.id}
                  onClick={() => setEstado(tema.id, e.id)}
                  title={e.desc}
                  className={cx(
                    "h-8 px-3 rounded-lg border text-[12.5px] inline-flex items-center gap-2 transition-all",
                    progreso.estado === e.id
                      ? "text-fg"
                      : "border-[var(--border)] text-muted hover:text-fg",
                  )}
                  style={
                    progreso.estado === e.id
                      ? {
                          borderColor: `color-mix(in srgb, ${e.color} 55%, transparent)`,
                          background: `color-mix(in srgb, ${e.color} 14%, transparent)`,
                        }
                      : undefined
                  }
                >
                  <Punto color={e.color} size={7} />
                  {e.label}
                </button>
              ))}
            </div>
            {estado === "oxidado" && progreso.estado !== "oxidado" && (
              <p className="text-[12px] text-[var(--st-oxidado)] mt-3">
                Marcado como oxidado automáticamente: llevas más de {perfil.diasOxido} días sin tocarlo.
              </p>
            )}
          </div>

          <div>
            <TituloSeccion>
              Dificultad percibida
            </TituloSeccion>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={5}
                value={progreso.dificultad}
                onChange={(e) => setDificultad(tema.id, Number(e.target.value))}
                className="flex-1 accent-[var(--lacre-bright)]"
              />
              <span className="numeric text-[15px] font-semibold w-5 text-center">
                {progreso.dificultad}
              </span>
            </div>
            <p className="text-[12px] text-muted mt-2.5 leading-relaxed">
              Cuanto más difícil lo marques, más corto será el intervalo entre repasos.
              Ahora mismo vuelve cada {intervalo} días.
            </p>
          </div>
        </div>
      </Card>

      {/* ------------------------------ Pestañas ----------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Pestanas
          valor={pestana}
          onCambio={setPestana}
          opciones={[
            { id: "epigrafes", label: "Epígrafes", contador: tema.epigrafes.length },
            { id: "cantes", label: "Cantes", contador: misCantes.length },
            { id: "keypoints", label: "Keypoints", contador: misKeypoints.length },
            { id: "notas", label: "Notas", contador: misNotas.length },
          ]}
        />
        <button
          onClick={() =>
            pedir(
              "Borrar tema",
              `Se borra «T${tema.numero} ${tema.titulo}» con todos sus cantes, keypoints y notas.`,
              () => {
                removeTema(tema.id);
                router.push("/programa");
              },
            )
          }
          className="text-[12px] text-subtle hover:text-[var(--danger)] transition-colors inline-flex items-center gap-1.5"
        >
          <Trash2 className="size-3.5" />
          Borrar tema
        </button>
      </div>

      {pestana === "epigrafes" && <PanelEpigrafes tema={tema} />}
      {pestana === "cantes" && <PanelCantes tema={tema} cantes={misCantes} />}
      {pestana === "keypoints" && <PanelKeyPoints tema={tema} />}
      {pestana === "notas" && <PanelNotas tema={tema} />}

      {dialogo}
    </>
  );
}

/* ========================================================================== */
/*                                Epígrafes                                   */
/* ========================================================================== */

function PanelEpigrafes({ tema }: { tema: { id: string; titulo: string; epigrafes: { id: string; orden: number; titulo: string; texto?: string }[] } }) {
  const setEpigrafes = useStore((s) => s.setEpigrafes);
  const addEpigrafe = useStore((s) => s.addEpigrafe);
  const updateEpigrafe = useStore((s) => s.updateEpigrafe);
  const removeEpigrafe = useStore((s) => s.removeEpigrafe);

  const [modalPegar, setModalPegar] = React.useState(false);
  const [nuevo, setNuevo] = React.useState("");
  const [abierto, setAbierto] = React.useState<string | null>(null);

  const minutosTotales = tema.epigrafes.reduce(
    (a, e) => a + minutosEstimados(e.texto),
    0,
  );

  return (
    <>
      <Card className="p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-[var(--border)]">
          <div className="text-[12.5px] text-muted">
            {tema.epigrafes.length
              ? `${plural(tema.epigrafes.length, "epígrafe")}${minutosTotales > 0 ? ` · ~${minutosTotales.toFixed(1)} min de cante estimados` : ""}`
              : "Sin epígrafes todavía"}
          </div>
          <Boton tam="sm" variante="secundario" onClick={() => setModalPegar(true)}>
            <Wand2 className="size-3.5" />
            Pegar tema y trocear
          </Boton>
        </div>

        {tema.epigrafes.length === 0 ? (
          <Vacio
            icono={<ListTree className="size-5" />}
            titulo="Este tema no tiene epígrafes"
            texto="Sin epígrafes el cante se cronometra entero. Con ellos sabrás en qué punto exacto pierdes tiempo y qué apartado fallas siempre."
            accion={
              <Boton variante="primario" onClick={() => setModalPegar(true)}>
                <Wand2 className="size-4" />
                Pegar el texto del tema
              </Boton>
            }
          />
        ) : (
          <div>
            {tema.epigrafes.map((e, i) => {
              const expandido = abierto === e.id;
              return (
                <div
                  key={e.id}
                  className={cx(i > 0 && "border-t border-[var(--border)]")}
                >
                  <div className="flex items-start gap-3 px-5 py-3 group">
                    <span className="numeric text-[12px] text-subtle w-5 shrink-0 mt-1">
                      {e.orden}
                    </span>
                    <input
                      value={e.titulo}
                      onChange={(ev) =>
                        updateEpigrafe(tema.id, e.id, { titulo: ev.target.value })
                      }
                      className="flex-1 bg-transparent text-[14px] outline-none min-w-0 py-0.5"
                    />
                    {e.texto && (
                      <span className="text-[11px] text-subtle shrink-0 mt-1 numeric">
                        ~{minutosEstimados(e.texto)} min
                      </span>
                    )}
                    <button
                      onClick={() => setAbierto(expandido ? null : e.id)}
                      className="text-subtle hover:text-fg transition-colors shrink-0 mt-0.5"
                      aria-label="Ver texto"
                    >
                      <ChevronDown
                        className={cx(
                          "size-4 transition-transform",
                          expandido && "rotate-180",
                        )}
                      />
                    </button>
                    <button
                      onClick={() => removeEpigrafe(tema.id, e.id)}
                      className="opacity-0 group-hover:opacity-100 text-subtle hover:text-[var(--danger)] transition-all shrink-0 mt-0.5"
                      aria-label="Borrar epígrafe"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>

                  {expandido && (
                    <div className="px-5 pb-5 pl-13">
                      <AreaTexto
                        rows={10}
                        value={e.texto ?? ""}
                        onChange={(ev) =>
                          updateEpigrafe(tema.id, e.id, { texto: ev.target.value })
                        }
                        placeholder="Pega aquí el texto de este epígrafe tal y como te lo estudias…"
                        className="prose-tema"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex gap-2 px-5 py-3.5 border-t border-[var(--border)]">
          <input
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && nuevo.trim()) {
                addEpigrafe(tema.id, nuevo);
                setNuevo("");
              }
            }}
            placeholder="Añadir epígrafe a mano…"
            className="flex-1 h-9 px-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] text-[13.5px] outline-none focus:border-[var(--border-strong)]"
          />
          <Boton
            tam="sm"
            variante="secundario"
            className="h-9"
            disabled={!nuevo.trim()}
            onClick={() => {
              addEpigrafe(tema.id, nuevo);
              setNuevo("");
            }}
          >
            <Plus className="size-3.5" />
            Añadir
          </Boton>
        </div>
      </Card>

      <ModalPegarTema
        abierto={modalPegar}
        onCerrar={() => setModalPegar(false)}
        onAplicar={(eps) => {
          setEpigrafes(tema.id, aEpigrafes(eps));
          setModalPegar(false);
        }}
      />
    </>
  );
}

function ModalPegarTema({
  abierto,
  onCerrar,
  onAplicar,
}: {
  abierto: boolean;
  onCerrar: () => void;
  onAplicar: (eps: { titulo: string; texto: string }[]) => void;
}) {
  const [texto, setTexto] = React.useState("");
  const parseados = React.useMemo(
    () => (texto.trim() ? parsearEpigrafes(texto) : []),
    [texto],
  );

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Pegar el texto del tema"
      descripcion="Detecta cómo numeras tus epígrafes (I, II… / 1, 2… / a), b)… / guiones) y trocea el texto por ahí. Reemplaza los epígrafes actuales."
      ancho="max-w-3xl"
    >
      <AreaTexto
        rows={12}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={"I. Concepto y caracteres.\nLa hipoteca es un derecho real de garantía…\n\nII. Clases de hipoteca.\nSe distingue entre hipotecas voluntarias y legales…"}
        className="font-serif"
      />

      {texto.trim() && parseados.length === 0 && (
        <p className="text-[12.5px] text-[var(--warn)] mt-3 leading-relaxed">
          No se ha encontrado una numeración clara. Comprueba que cada epígrafe empiece
          en su propia línea con un marcador (I., 1., a), —). Si tu tema no lleva
          numeración, mete los epígrafes a mano desde la lista.
        </p>
      )}

      {parseados.length > 0 && (
        <div className="mt-4 rounded-[10px] border border-[var(--border)] overflow-hidden">
          <div className="px-3.5 py-2.5 bg-[var(--surface-2)] text-[12px] font-medium">
            {plural(parseados.length, "epígrafe")} detectado{parseados.length === 1 ? "" : "s"}
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-[var(--border)]">
            {parseados.map((p, i) => (
              <div key={i} className="px-3.5 py-2.5">
                <div className="flex gap-3">
                  <span className="numeric text-subtle text-[12px] w-5 shrink-0">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">{p.titulo}</p>
                    {p.texto && (
                      <p className="text-[12px] text-subtle mt-1 line-clamp-2">
                        {p.texto.slice(0, 160)}
                        {p.texto.length > 160 ? "…" : ""}
                      </p>
                    )}
                  </div>
                  <span className="ml-auto text-[11px] text-subtle numeric shrink-0">
                    ~{minutosEstimados(p.texto)} min
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-5">
        <Boton variante="fantasma" onClick={onCerrar}>
          Cancelar
        </Boton>
        <Boton
          variante="primario"
          disabled={!parseados.length}
          onClick={() => onAplicar(parseados)}
        >
          Guardar {parseados.length ? plural(parseados.length, "epígrafe") : "epígrafes"}
        </Boton>
      </div>
    </Modal>
  );
}

/* ========================================================================== */
/*                                  Cantes                                    */
/* ========================================================================== */

function PanelCantes({
  tema,
  cantes,
}: {
  tema: { id: string; numero: number; titulo: string; materiaId: string };
  cantes: Cante[];
}) {
  const materias = useStore((s) => s.materias);
  const perfil = useStore((s) => s.perfil);
  const setAnalisis = useStore((s) => s.setAnalisisCante);
  const removeCante = useStore((s) => s.removeCante);
  const ia = useIA();
  const ficha = useFicha();

  const [analizando, setAnalizando] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [abierto, setAbierto] = React.useState<string | null>(cantes[0]?.id ?? null);

  const analizar = async (cante: Cante) => {
    setAnalizando(cante.id);
    setError(null);
    try {
      const anteriores = cantes.filter((c) => c.fecha < cante.fecha);
      const detalle = construirDetalleCante(
        cante,
        tema as never,
        materias.find((m) => m.id === tema.materiaId),
        anteriores,
        perfil.minutosPorTema,
      );
      const r = await fetch("/api/ai/analisis-cante", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          detalleCante: detalle,
          ficha: ficha(),
          estilo: perfil.estiloFeedback,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.mensaje ?? "No se ha podido analizar el cante.");
        return;
      }
      setAnalisis(cante.id, {
        ...(d.analisis as AnalisisCante),
        generado: Date.now(),
        modelo: d.modelo,
      });
      setAbierto(cante.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalizando(null);
    }
  };

  if (!cantes.length) {
    return (
      <Card className="p-0">
        <Vacio
          icono={<Mic className="size-5" />}
          titulo="Aún no has cantado este tema"
          texto="En el modo cante se cronometra cada epígrafe y marcas los fallos sobre la marcha. Con dos cantes ya hay comparativa; con tres, la IA empieza a ver patrones."
          accion={
            <Link href={`/cante/vivo?tema=${tema.id}`}>
              <Boton variante="primario">
                <Mic className="size-4" />
                Cantar ahora
              </Boton>
            </Link>
          }
        />
      </Card>
    );
  }

  const conNota = cantes.filter((c) => c.nota != null);

  return (
    <div className="space-y-4">
      {conNota.length >= 2 && (
        <Card>
          <TituloSeccion>Evolución de la nota</TituloSeccion>
          <Linea
            puntos={conNota.map((c) => ({ ts: c.fecha, valor: c.nota! }))}
            min={0}
            max={10}
            formato={(v) => String(Math.round(v))}
          />
        </Card>
      )}

      {error && (
        <div className="rounded-[10px] border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_9%,transparent)] px-4 py-3 text-[13px] text-[var(--danger)]">
          {error}
        </div>
      )}

      {cantes.map((c, i) => {
        const anterior = cantes[i + 1];
        const expandido = abierto === c.id;
        return (
          <Card key={c.id} className="p-0 overflow-hidden">
            <button
              onClick={() => setAbierto(expandido ? null : c.id)}
              className="w-full flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 text-left hover:bg-[var(--surface-2)] transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <span className="text-[14px] font-medium">{fecha(c.fecha)}</span>
                  {c.conPreparador && (
                    <Badge color="var(--lacre-bright)">con preparador</Badge>
                  )}
                  {c.analisis && (
                    <Badge color="var(--laton)">
                      <Sparkles className="size-3" />
                      analizado
                    </Badge>
                  )}
                </div>
                <p className="text-[12px] text-muted mt-1">
                  {reloj(c.segundos)} · objetivo {perfil.minutosPorTema} min ·{" "}
                  {c.epigrafes.length
                    ? plural(c.epigrafes.length, "epígrafe")
                    : "sin desglose"}
                  {c.epigrafes.some((e) => e.fallos.length) &&
                    ` · ${plural(
                      c.epigrafes.reduce((a, e) => a + e.fallos.length, 0),
                      "fallo",
                    )}`}
                </p>
              </div>
              {c.nota != null && (
                <span
                  className="numeric text-[22px] font-semibold"
                  style={{
                    color:
                      c.nota >= 7
                        ? "var(--ok)"
                        : c.nota >= 5
                          ? "var(--warn)"
                          : "var(--danger)",
                  }}
                >
                  {c.nota}
                </span>
              )}
              <ChevronDown
                className={cx(
                  "size-4 text-subtle transition-transform",
                  expandido && "rotate-180",
                )}
              />
            </button>

            {expandido && (
              <div className="px-5 pb-5 space-y-5 border-t border-[var(--border)] pt-5">
                {c.epigrafes.length > 0 && (
                  <div>
                    <TituloSeccion>
                      {anterior ? "Tiempo por epígrafe (barra gris: cante anterior)" : "Tiempo por epígrafe"}
                    </TituloSeccion>
                    <ComparativaEpigrafes
                      filas={c.epigrafes.map((e) => {
                        const prev = anterior?.epigrafes.find(
                          (x) => x.epigrafeId === e.epigrafeId,
                        );
                        return {
                          titulo: e.titulo,
                          actual: e.segundos,
                          anterior: prev?.segundos,
                          fallos: e.fallos.length,
                        };
                      })}
                    />
                  </div>
                )}

                {c.feedback && (
                  <div>
                    <TituloSeccion>Feedback del preparador</TituloSeccion>
                    <p className="text-[13.5px] leading-relaxed text-muted whitespace-pre-wrap">
                      {c.feedback}
                    </p>
                  </div>
                )}

                {c.analisis ? (
                  <TarjetaAnalisis analisis={c.analisis} />
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <Boton
                      variante="oro"
                      onClick={() => analizar(c)}
                      cargando={analizando === c.id}
                      disabled={!ia.disponible || analizando !== null}
                    >
                      <Sparkles className="size-4" />
                      {analizando === c.id ? "Analizando…" : "Sacar conclusiones con IA"}
                    </Boton>
                    {!ia.disponible && !ia.cargando && (
                      <span className="text-[12px] text-subtle">
                        Configura ANTHROPIC_API_KEY para activar el análisis.
                      </span>
                    )}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={() => removeCante(c.id)}
                    className="text-[12px] text-subtle hover:text-[var(--danger)] transition-colors inline-flex items-center gap-1.5"
                  >
                    <Trash2 className="size-3.5" />
                    Borrar este cante
                  </button>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/* ========================================================================== */
/*                                 Keypoints                                  */
/* ========================================================================== */

function PanelKeyPoints({
  tema,
}: {
  tema: { id: string; titulo: string; epigrafes: { id: string; titulo: string; texto?: string }[] };
}) {
  const todosKeypoints = useStore((s) => s.keypoints);
  const keypoints = React.useMemo(
    () => todosKeypoints.filter((k) => k.temaId === tema.id),
    [todosKeypoints, tema.id],
  );
  const addKeyPoint = useStore((s) => s.addKeyPoint);
  const removeKeyPoint = useStore((s) => s.removeKeyPoint);
  const ia = useIA();

  const [anverso, setAnverso] = React.useState("");
  const [reverso, setReverso] = React.useState("");
  const [generando, setGenerando] = React.useState(false);
  const [sugerencias, setSugerencias] = React.useState<
    { anverso: string; reverso: string }[]
  >([]);
  const [error, setError] = React.useState<string | null>(null);

  const textoTema = tema.epigrafes
    .map((e) => `${e.titulo}\n${e.texto ?? ""}`)
    .join("\n\n")
    .trim();

  const generar = async () => {
    setGenerando(true);
    setError(null);
    try {
      const r = await fetch("/api/ai/keypoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: textoTema, tema: tema.titulo }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.mensaje ?? "No se han podido generar los keypoints.");
        return;
      }
      setSugerencias(d.keypoints ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerando(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <TituloSeccion
          accion={
            ia.disponible && (
              <Boton
                tam="sm"
                variante="oro"
                onClick={generar}
                cargando={generando}
                disabled={textoTema.length < 60}
                title={
                  textoTema.length < 60
                    ? "Necesitas texto en los epígrafes para poder extraer keypoints"
                    : undefined
                }
              >
                <Sparkles className="size-3.5" />
                Extraer del texto
              </Boton>
            )
          }
        >
          Nuevo keypoint
        </TituloSeccion>

        <div className="grid sm:grid-cols-2 gap-3">
          <Campo
            etiqueta="Pregunta"
            value={anverso}
            onChange={(e) => setAnverso(e.target.value)}
            placeholder="¿Plazo de la acción rescisoria por fraude?"
          />
          <Campo
            etiqueta="Respuesta"
            value={reverso}
            onChange={(e) => setReverso(e.target.value)}
            placeholder="4 años (art. 1299 CC)"
            onKeyDown={(e) => {
              if (e.key === "Enter" && anverso.trim() && reverso.trim()) {
                addKeyPoint(tema.id, anverso, reverso);
                setAnverso("");
                setReverso("");
              }
            }}
          />
        </div>
        <div className="flex justify-end mt-3">
          <Boton
            variante="secundario"
            tam="sm"
            disabled={!anverso.trim() || !reverso.trim()}
            onClick={() => {
              addKeyPoint(tema.id, anverso, reverso);
              setAnverso("");
              setReverso("");
            }}
          >
            <Plus className="size-3.5" />
            Añadir
          </Boton>
        </div>

        {error && (
          <p className="text-[12.5px] text-[var(--danger)] mt-3">{error}</p>
        )}

        {sugerencias.length > 0 && (
          <div className="mt-5">
            <div className="hairline mb-4" />
            <p className="text-[11px] uppercase tracking-[0.14em] text-subtle mb-3">
              {sugerencias.length} propuestas del modelo — revisa antes de guardar
            </p>
            <div className="space-y-2">
              {sugerencias.map((s, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 px-3.5 py-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{s.anverso}</p>
                    <p className="text-[12.5px] text-muted mt-1">{s.reverso}</p>
                  </div>
                  <Boton
                    tam="sm"
                    variante="secundario"
                    onClick={() => {
                      addKeyPoint(tema.id, s.anverso, s.reverso);
                      setSugerencias((v) => v.filter((_, j) => j !== i));
                    }}
                  >
                    Guardar
                  </Boton>
                </div>
              ))}
            </div>
            <button
              onClick={() => setSugerencias([])}
              className="text-[12px] text-subtle hover:text-fg transition-colors mt-3"
            >
              Descartar el resto
            </button>
          </div>
        )}
      </Card>

      {keypoints.length === 0 ? (
        <Card className="p-0">
          <Vacio
            icono={<Brain className="size-5" />}
            titulo="Sin keypoints"
            texto="Los keypoints son los datos que se caen en el cante: artículos, plazos, listas de requisitos. Entran en la cola de repaso diaria."
          />
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          {keypoints.map((k, i) => (
            <div
              key={k.id}
              className={cx(
                "flex items-start gap-4 px-5 py-3.5 group",
                i > 0 && "border-t border-[var(--border)]",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium">{k.anverso}</p>
                <p className="text-[13px] text-muted mt-1">{k.reverso}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[11px] text-subtle numeric">
                  {k.aciertos}✓ {k.fallos}✗
                </p>
                <p className="text-[10.5px] text-subtle mt-0.5">
                  cada {k.intervaloDias}d
                </p>
              </div>
              <button
                onClick={() => removeKeyPoint(k.id)}
                className="opacity-0 group-hover:opacity-100 text-subtle hover:text-[var(--danger)] transition-all shrink-0 mt-1"
                aria-label="Borrar keypoint"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/* ========================================================================== */
/*                                   Notas                                    */
/* ========================================================================== */

function PanelNotas({ tema }: { tema: { id: string } }) {
  const todasNotas = useStore((s) => s.notas);
  const notas = React.useMemo(
    () => todasNotas.filter((n) => n.temaId === tema.id),
    [todasNotas, tema.id],
  );
  const addNota = useStore((s) => s.addNota);
  const updateNota = useStore((s) => s.updateNota);
  const removeNota = useStore((s) => s.removeNota);
  const [texto, setTexto] = React.useState("");

  return (
    <div className="space-y-4">
      <Card>
        <AreaTexto
          etiqueta="Nueva nota"
          rows={4}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Lo que te dijo el preparador, la duda que te quedó, el enlace con otro tema…"
        />
        <div className="flex justify-end mt-3">
          <Boton
            variante="secundario"
            tam="sm"
            disabled={!texto.trim()}
            onClick={() => {
              addNota(tema.id, texto);
              setTexto("");
            }}
          >
            <Plus className="size-3.5" />
            Guardar nota
          </Boton>
        </div>
      </Card>

      {notas.length === 0 ? (
        <Card className="p-0">
          <Vacio
            icono={<NotebookPen className="size-5" />}
            titulo="Sin notas en este tema"
            texto="El feedback verbal del preparador se pierde. Escríbelo aquí y se acumula como dato."
          />
        </Card>
      ) : (
        notas
          .sort((a, b) => b.actualizado - a.actualizado)
          .map((n) => (
            <Card key={n.id} className="group">
              <textarea
                value={n.texto}
                onChange={(e) => updateNota(n.id, e.target.value)}
                rows={Math.max(2, Math.ceil(n.texto.length / 90))}
                className="w-full bg-transparent text-[14px] leading-relaxed outline-none resize-none prose-tema"
              />
              <div className="flex items-center justify-between mt-3">
                <span className="text-[11px] text-subtle">
                  {haceTexto(n.actualizado)}
                </span>
                <button
                  onClick={() => removeNota(n.id)}
                  className="opacity-0 group-hover:opacity-100 text-subtle hover:text-[var(--danger)] transition-all"
                  aria-label="Borrar nota"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </Card>
          ))
      )}
    </div>
  );
}

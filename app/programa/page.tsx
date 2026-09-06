"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  LayoutGrid,
  List,
  Palette,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  temasOrdenados,
  useMaterias,
  useProgresos,
  useStore,
  useTemas,
} from "@/lib/store/store";
import { materiasOrdenadas } from "@/lib/data/materias";
import { Cabecera } from "@/components/Shell";
import {
  AreaTexto,
  Boton,
  Campo,
  Card,
  Modal,
  Pestanas,
  Punto,
  Selector,
  Vacio,
  cx,
  useConfirmacion,
} from "@/components/ui";
import { ESTADOS, type EstadoTema } from "@/lib/data/types";
import { estadoEfectivo } from "@/lib/data/srs";
import { parsearListaTemas } from "@/lib/data/parser";
import { haceTexto, horasMin } from "@/lib/utils/time";
import { plural } from "@/lib/utils/texto";

type Vista = "mural" | "lista";

export default function Programa() {
  const perfil = useStore((s) => s.perfil);
  const materiasSinOrdenar = useMaterias();
  const temas = useTemas();
  const addTemasMasivo = useStore((s) => s.addTemasMasivo);
  const addTema = useStore((s) => s.addTema);
  const addMateria = useStore((s) => s.addMateria);
  const updateMateria = useStore((s) => s.updateMateria);
  const removeMateria = useStore((s) => s.removeMateria);
  const removeTema = useStore((s) => s.removeTema);
  const moverMateria = useStore((s) => s.moverMateria);
  const setPerfil = useStore((s) => s.setPerfil);
  const progresos = useProgresos();
  // El orden de la barra de materias sale de `Materia.orden`, no del array.
  const materias = React.useMemo(
    () => materiasOrdenadas(materiasSinOrdenar),
    [materiasSinOrdenar],
  );

  // La vista no es estado local: es una preferencia del perfil, así que
  // el opositor que trabaja en lista no tiene que volver a elegirla cada vez
  // que entra ni en cada aparato. El botón de arriba SIGUE siendo el mismo
  // control; lo que cambia es dónde se guarda lo que dice.
  const vista = perfil.vistaPrograma;
  const setVista = (v: Vista) => setPerfil({ vistaPrograma: v });
  const [busqueda, setBusqueda] = React.useState("");
  const [filtroMateria, setFiltroMateria] = React.useState("todas");
  const [filtroEstado, setFiltroEstado] = React.useState<"todos" | EstadoTema>("todos");
  const [modalTemas, setModalTemas] = React.useState(false);
  const [modalMaterias, setModalMaterias] = React.useState(false);
  const { pedir, dialogo } = useConfirmacion();

  // El criterio lo pone el opositor en Ajustes. Por defecto es "numero",
  // que es el orden de siempre: materia y número, como el programa impreso.
  const ordenados = React.useMemo(
    () => temasOrdenados(temas, materias, perfil.ordenTemas, progresos, perfil.diasOxido),
    [temas, materias, perfil.ordenTemas, progresos, perfil.diasOxido],
  );

  const filtrados = React.useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return ordenados.filter((t) => {
      if (filtroMateria !== "todas" && t.materiaId !== filtroMateria) return false;
      if (filtroEstado !== "todos") {
        const p = progresos[t.id];
        const e = p ? estadoEfectivo(p, perfil.diasOxido) : "nuevo";
        if (e !== filtroEstado) return false;
      }
      if (q && !`${t.numero} ${t.titulo}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [ordenados, filtroMateria, filtroEstado, busqueda, progresos, perfil.diasOxido]);

  const porMateria = React.useMemo(() => {
    const mapa = new Map<string, typeof filtrados>();
    for (const t of filtrados) {
      const arr = mapa.get(t.materiaId) ?? [];
      arr.push(t);
      mapa.set(t.materiaId, arr);
    }
    return mapa;
  }, [filtrados]);

  const contadores = React.useMemo(() => {
    const c: Record<string, number> = { todos: temas.length };
    for (const e of ESTADOS) c[e.id] = 0;
    for (const t of temas) {
      const p = progresos[t.id];
      const e = p ? estadoEfectivo(p, perfil.diasOxido) : "nuevo";
      c[e] = (c[e] ?? 0) + 1;
    }
    return c;
  }, [temas, progresos, perfil.diasOxido]);

  return (
    <>
      <Cabecera
        titulo="Programa"
        descripcion={
          temas.length
            ? `${temas.length} temas repartidos en ${materias.length} materias. Cada celda es un tema; el color, su estado real hoy.`
            : "Da de alta tu programa. Puedes pegarlo entero y la app lo trocea."
        }
        acciones={
          <>
            <Boton variante="secundario" onClick={() => setModalMaterias(true)}>
              <Palette className="size-4" />
              Materias
            </Boton>
            <Boton variante="primario" onClick={() => setModalTemas(true)}>
              <Plus className="size-4" />
              Añadir temas
            </Boton>
          </>
        }
      />

      {temas.length === 0 ? (
        <Card className="p-0">
          <Vacio
            icono={<ClipboardPaste className="size-5" />}
            titulo="Todavía no hay temas"
            texto="Abre «Añadir temas», elige la materia y pega la lista del programa: una línea por tema. Reconoce la numeración («Tema 12.—», «12.», «12 ») y respeta tus números."
            accion={
              <Boton variante="primario" tam="lg" onClick={() => setModalTemas(true)}>
                <Plus className="size-4" />
                Añadir temas
              </Boton>
            }
          />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-5">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-subtle pointer-events-none" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar tema por número o título…"
                className="w-full h-10 pl-9 pr-3 rounded-[10px] bg-[var(--bg-elevated)] border border-[var(--border)] text-sm placeholder:text-subtle outline-none focus:border-[var(--border-strong)] transition-colors"
              />
            </div>

            <select
              value={filtroMateria}
              onChange={(e) => setFiltroMateria(e.target.value)}
              className="h-10 px-3 rounded-[10px] bg-[var(--bg-elevated)] border border-[var(--border)] text-sm cursor-pointer outline-none"
            >
              <option value="todas">Todas las materias</option>
              {materias.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
              {(["mural", "lista"] as Vista[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setVista(v)}
                  className={cx(
                    "size-8 grid place-items-center rounded-lg transition-colors",
                    vista === v ? "bg-[var(--surface)] text-fg" : "text-subtle hover:text-fg",
                  )}
                  aria-label={v === "mural" ? "Vista mural" : "Vista lista"}
                >
                  {v === "mural" ? <LayoutGrid className="size-4" /> : <List className="size-4" />}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-5">
            <button
              onClick={() => setFiltroEstado("todos")}
              className={cx(
                "h-7 px-3 rounded-full border text-[12px] transition-colors",
                filtroEstado === "todos"
                  ? "border-[var(--border-strong)] bg-[var(--surface-2)] text-fg"
                  : "border-[var(--border)] text-muted hover:text-fg",
              )}
            >
              Todos <span className="numeric text-subtle ml-1">{contadores.todos}</span>
            </button>
            {ESTADOS.map((e) => (
              <button
                key={e.id}
                onClick={() => setFiltroEstado(filtroEstado === e.id ? "todos" : e.id)}
                title={e.desc}
                className={cx(
                  "h-7 px-3 rounded-full border text-[12px] inline-flex items-center gap-2 transition-all",
                  filtroEstado === e.id
                    ? "border-[var(--border-strong)] bg-[var(--surface-2)] text-fg"
                    : "border-[var(--border)] text-muted hover:text-fg",
                )}
              >
                <Punto color={e.color} size={7} />
                {e.label}
                <span className="numeric text-subtle">{contadores[e.id] ?? 0}</span>
              </button>
            ))}
          </div>

          {filtrados.length === 0 ? (
            <Card className="p-0">
              <Vacio titulo="Ningún tema encaja con el filtro" />
            </Card>
          ) : (
            <div className="space-y-6">
              {materias
                .filter((m) => porMateria.has(m.id))
                .map((m) => {
                  const lista = porMateria.get(m.id)!;
                  return (
                    <section key={m.id}>
                      <div className="flex items-center gap-3 mb-3">
                        <Punto color={m.color} size={9} />
                        <h2 className="text-[13px] font-semibold tracking-tight">
                          {m.nombre}
                        </h2>
                        <span className="text-[11px] text-subtle numeric">
                          {lista.length}
                        </span>
                        <div className="flex-1 hairline" />
                      </div>

                      {vista === "mural" ? (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(46px,1fr))] gap-1.5">
                          {lista.map((t) => {
                            const p = progresos[t.id];
                            const estado = p
                              ? estadoEfectivo(p, perfil.diasOxido)
                              : "nuevo";
                            const meta = ESTADOS.find((e) => e.id === estado)!;
                            return (
                              <Link
                                key={t.id}
                                href={`/tema/${t.id}`}
                                title={`T${t.numero} · ${t.titulo}\n${meta.label}${p?.segundos ? ` · ${horasMin(p.segundos)}` : ""}`}
                                className="group relative aspect-square rounded-[7px] grid place-items-center transition-all duration-200 hover:scale-[1.14] hover:z-10"
                                style={{
                                  background:
                                    estado === "nuevo"
                                      ? "var(--surface-2)"
                                      : `color-mix(in srgb, ${meta.color} 26%, var(--surface))`,
                                  border: `1px solid ${
                                    estado === "nuevo"
                                      ? "var(--border)"
                                      : `color-mix(in srgb, ${meta.color} 55%, transparent)`
                                  }`,
                                  boxShadow:
                                    estado === "dominado"
                                      ? `0 0 14px -4px ${meta.color}`
                                      : undefined,
                                }}
                              >
                                <span
                                  className="numeric text-[11px] font-medium"
                                  style={{
                                    color:
                                      estado === "nuevo"
                                        ? "var(--fg-subtle)"
                                        : meta.color,
                                  }}
                                >
                                  {t.numero}
                                </span>
                                {p?.favorito && (
                                  <span
                                    className="absolute top-1 right-1 size-1.5 rounded-full"
                                    style={{ background: "var(--laton)" }}
                                  />
                                )}
                              </Link>
                            );
                          })}
                        </div>
                      ) : (
                        <Card className="p-0 overflow-hidden">
                          {lista.map((t, i) => {
                            const p = progresos[t.id];
                            const estado = p
                              ? estadoEfectivo(p, perfil.diasOxido)
                              : "nuevo";
                            const meta = ESTADOS.find((e) => e.id === estado)!;
                            return (
                              <div
                                key={t.id}
                                className={cx(
                                  "flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--surface-2)] transition-colors group",
                                  i > 0 && "border-t border-[var(--border)]",
                                )}
                              >
                                <Punto color={meta.color} />
                                <span className="numeric text-[12px] text-subtle w-8 shrink-0">
                                  {t.numero}
                                </span>
                                <Link
                                  href={`/tema/${t.id}`}
                                  className="text-[13.5px] flex-1 truncate hover:underline"
                                >
                                  {t.titulo}
                                </Link>
                                {t.epigrafes.length > 0 && (
                                  <span className="text-[11px] text-subtle shrink-0">
                                    {t.epigrafes.length} epígrafes
                                  </span>
                                )}
                                {p?.segundos ? (
                                  <span className="text-[11.5px] text-muted numeric shrink-0 w-16 text-right">
                                    {horasMin(p.segundos)}
                                  </span>
                                ) : null}
                                <span className="text-[11px] text-subtle shrink-0 w-20 text-right hidden sm:block">
                                  {p?.ultimoCante ? haceTexto(p.ultimoCante) : "sin cante"}
                                </span>
                                <button
                                  onClick={() =>
                                    pedir(
                                      "Borrar tema",
                                      `Se borra «T${t.numero} ${t.titulo}» con sus cantes, notas y keypoints. No se puede deshacer.`,
                                      () => removeTema(t.id),
                                    )
                                  }
                                  className="opacity-0 group-hover:opacity-100 text-subtle hover:text-[var(--danger)] transition-all shrink-0"
                                  aria-label="Borrar tema"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </div>
                            );
                          })}
                        </Card>
                      )}
                    </section>
                  );
                })}
            </div>
          )}
        </>
      )}

      <ModalAnadirTemas
        abierto={modalTemas}
        onCerrar={() => setModalTemas(false)}
        materias={materias}
        temasExistentes={temas}
        onImportar={addTemasMasivo}
        onUno={addTema}
      />

      <ModalMaterias
        abierto={modalMaterias}
        onCerrar={() => setModalMaterias(false)}
        materias={materias}
        temas={temas}
        onAdd={addMateria}
        onUpdate={updateMateria}
        onMover={moverMateria}
        onRemove={(id, nombre, n) =>
          pedir(
            "Borrar materia",
            `Se borra «${nombre}» y sus ${n} temas, con todo su historial. No se puede deshacer.`,
            () => removeMateria(id),
          )
        }
      />

      {dialogo}
    </>
  );
}

/* ========================================================================== */
/*                          Modal: añadir temas                               */
/* ========================================================================== */

function ModalAnadirTemas({
  abierto,
  onCerrar,
  materias,
  temasExistentes,
  onImportar,
  onUno,
}: {
  abierto: boolean;
  onCerrar: () => void;
  materias: { id: string; nombre: string }[];
  temasExistentes: { materiaId: string; numero: number }[];
  onImportar: (materiaId: string, filas: { numero: number; titulo: string }[]) => number;
  onUno: (materiaId: string, numero: number, titulo: string) => unknown;
}) {
  const [pestana, setPestana] = React.useState<"importar" | "uno">("importar");
  const [materiaId, setMateriaId] = React.useState(materias[0]?.id ?? "");
  const [texto, setTexto] = React.useState("");
  const [numero, setNumero] = React.useState("");
  const [titulo, setTitulo] = React.useState("");
  const [hecho, setHecho] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (abierto) {
      setHecho(null);
      if (!materiaId && materias[0]) setMateriaId(materias[0].id);
    }
  }, [abierto, materias, materiaId]);

  const ultimoNumero = React.useMemo(() => {
    const nums = temasExistentes
      .filter((t) => t.materiaId === materiaId)
      .map((t) => t.numero);
    return nums.length ? Math.max(...nums) : 0;
  }, [temasExistentes, materiaId]);

  const parseados = React.useMemo(
    () => (texto.trim() ? parsearListaTemas(texto, ultimoNumero + 1) : []),
    [texto, ultimoNumero],
  );

  const duplicados = React.useMemo(() => {
    const existentes = new Set(
      temasExistentes.filter((t) => t.materiaId === materiaId).map((t) => t.numero),
    );
    return parseados.filter((p) => existentes.has(p.numero)).length;
  }, [parseados, temasExistentes, materiaId]);

  const importar = () => {
    if (!parseados.length || !materiaId) return;
    const n = onImportar(
      materiaId,
      parseados.map((p) => ({ numero: p.numero, titulo: p.titulo })),
    );
    setHecho(`${n} temas añadidos.`);
    setTexto("");
  };

  const anadirUno = () => {
    if (!titulo.trim() || !materiaId) return;
    const n = Number(numero) || ultimoNumero + 1;
    onUno(materiaId, n, titulo);
    setHecho(`Tema ${n} añadido.`);
    setTitulo("");
    setNumero("");
  };

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Añadir temas"
      descripcion="Tú controlas tu programa: el número y el título son los tuyos, la app no impone ninguno."
      ancho="max-w-2xl"
    >
      <div className="space-y-5">
        <Pestanas
          valor={pestana}
          onCambio={setPestana}
          opciones={[
            { id: "importar", label: "Pegar lista" },
            { id: "uno", label: "Uno a uno" },
          ]}
        />

        <Selector
          etiqueta="Materia"
          value={materiaId}
          onChange={(e) => setMateriaId(e.target.value)}
        >
          {materias.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre}
            </option>
          ))}
        </Selector>

        {pestana === "importar" ? (
          <>
            <AreaTexto
              etiqueta="Lista de temas"
              rows={9}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={"1. La persona física. El nacimiento y la personalidad.\n2. La ausencia. La declaración de fallecimiento.\nTema 3.— La nacionalidad y la vecindad civil."}
              pista={`Una línea por tema. Si la línea no trae número, se numera correlativamente desde el ${ultimoNumero + 1}.`}
            />

            {parseados.length > 0 && (
              <div className="rounded-[10px] border border-[var(--border)] overflow-hidden">
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-[var(--surface-2)] text-[12px]">
                  <span className="font-medium">
                    {plural(parseados.length, "tema")} detectado{parseados.length === 1 ? "" : "s"}
                  </span>
                  {duplicados > 0 && (
                    <span className="text-[var(--warn)]">
                      {duplicados} repiten un número ya existente
                    </span>
                  )}
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-[var(--border)]">
                  {parseados.slice(0, 60).map((p, i) => (
                    <div key={i} className="flex gap-3 px-3.5 py-2 text-[12.5px]">
                      <span className="numeric text-subtle w-7 shrink-0">
                        {p.numero}
                      </span>
                      <span className="truncate flex-1">{p.titulo}</span>
                      {!p.numeroExplicito && (
                        <span className="text-[10px] text-subtle shrink-0">auto</span>
                      )}
                    </div>
                  ))}
                  {parseados.length > 60 && (
                    <div className="px-3.5 py-2 text-[12px] text-subtle">
                      … y {parseados.length - 60} más
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-between items-center gap-3">
              <span className="text-[12px] text-[var(--ok)]">{hecho}</span>
              <Boton
                variante="primario"
                onClick={importar}
                disabled={!parseados.length || !materiaId}
              >
                Importar {parseados.length ? plural(parseados.length, "tema") : "temas"}
              </Boton>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <Campo
                etiqueta="Número"
                type="number"
                min={1}
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder={String(ultimoNumero + 1)}
              />
              <Campo
                etiqueta="Título del tema"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && anadirUno()}
                placeholder="La hipoteca. Concepto, caracteres y clases."
              />
            </div>
            <div className="flex justify-between items-center gap-3">
              <span className="text-[12px] text-[var(--ok)]">{hecho}</span>
              <Boton variante="primario" onClick={anadirUno} disabled={!titulo.trim()}>
                <Plus className="size-4" />
                Añadir tema
              </Boton>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ========================================================================== */
/*                           Modal: materias                                  */
/* ========================================================================== */

const PALETA = [
  "#c94152",
  "#c9a227",
  "#3f93c4",
  "#46a35c",
  "#9b7bd4",
  "#d9822b",
  "#4bb3a5",
  "#c96ba0",
];

function ModalMaterias({
  abierto,
  onCerrar,
  materias,
  temas,
  onAdd,
  onUpdate,
  onMover,
  onRemove,
}: {
  abierto: boolean;
  onCerrar: () => void;
  materias: { id: string; nombre: string; abrev: string; color: string }[];
  temas: { materiaId: string }[];
  onAdd: (nombre: string, abrev: string, color: string) => unknown;
  onUpdate: (id: string, parcial: { nombre?: string; color?: string }) => void;
  onMover: (id: string, direccion: -1 | 1) => void;
  onRemove: (id: string, nombre: string, n: number) => void;
}) {
  const [nombre, setNombre] = React.useState("");
  const [color, setColor] = React.useState(PALETA[0]);

  const cuenta = (id: string) => temas.filter((t) => t.materiaId === id).length;

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Materias"
      descripcion="Vienen las cinco clásicas de Notarías, pero puedes renombrarlas, cambiarles el color, reordenarlas, borrarlas o añadir las tuyas. El orden manda en el mural, en la barra lateral y en todas las listas de temas."
      ancho="max-w-xl"
    >
      <div className="space-y-2 mb-6">
        {materias.map((m, i) => (
          <div
            key={m.id}
            className="flex items-center gap-3 px-3 py-2.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)]"
          >
            {/* Subir/bajar y no arrastrar: el arrastre necesita puntero fino
                y aquí basta con mover una materia de sitio de uvas a peras.
                Cada pulsación intercambia el `orden` con la vecina, que es
                una escritura de dos filas y viaja como cualquier otra. */}
            <div className="flex flex-col shrink-0 -my-1">
              <button
                onClick={() => onMover(m.id, -1)}
                disabled={i === 0}
                aria-label={`Subir ${m.nombre}`}
                title="Subir"
                className="text-subtle hover:text-fg disabled:opacity-25 disabled:pointer-events-none transition-colors leading-none"
              >
                <ChevronUp className="size-3.5" />
              </button>
              <button
                onClick={() => onMover(m.id, 1)}
                disabled={i === materias.length - 1}
                aria-label={`Bajar ${m.nombre}`}
                title="Bajar"
                className="text-subtle hover:text-fg disabled:opacity-25 disabled:pointer-events-none transition-colors leading-none"
              >
                <ChevronDown className="size-3.5" />
              </button>
            </div>
            <input
              type="color"
              value={m.color}
              onChange={(e) => onUpdate(m.id, { color: e.target.value })}
              className="size-6 rounded-md bg-transparent border-0 cursor-pointer shrink-0 p-0"
              aria-label={`Color de ${m.nombre}`}
            />
            <input
              value={m.nombre}
              onChange={(e) => onUpdate(m.id, { nombre: e.target.value })}
              className="flex-1 bg-transparent text-[13.5px] outline-none min-w-0"
            />
            <span className="text-[11px] text-subtle numeric shrink-0">
              {cuenta(m.id)} temas
            </span>
            <button
              onClick={() => onRemove(m.id, m.nombre, cuenta(m.id))}
              className="text-subtle hover:text-[var(--danger)] transition-colors shrink-0"
              aria-label={`Borrar ${m.nombre}`}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="hairline mb-5" />

      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Campo
            etiqueta="Nueva materia"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Derecho Procesal"
          />
        </div>
        <div className="flex gap-1.5 pb-1">
          {PALETA.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className="size-6 rounded-full transition-transform"
              style={{
                background: c,
                transform: color === c ? "scale(1.2)" : undefined,
                boxShadow: color === c ? `0 0 0 2px var(--surface), 0 0 0 4px ${c}` : undefined,
              }}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
        <Boton
          variante="secundario"
          onClick={() => {
            if (!nombre.trim()) return;
            onAdd(nombre, nombre.slice(0, 3), color);
            setNombre("");
          }}
          disabled={!nombre.trim()}
        >
          <Plus className="size-4" />
          Añadir
        </Boton>
      </div>
    </Modal>
  );
}

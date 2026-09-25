"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Scale,
  Trash2,
  Wand2,
} from "lucide-react";
import { useStore } from "@/lib/store/store";
import {
  AreaTexto,
  Badge,
  Boton,
  Campo,
  Card,
  Modal,
  Selector,
  Vacio,
  cx,
} from "@/components/ui";
import {
  agruparPorEpigrafe,
  etiquetaArticulo,
  parsearArticulos,
} from "@/lib/data/articulos";
import {
  NIVELES_LECTURA,
  type Articulo,
  type Epigrafe,
  type NivelLectura,
  type Tema,
} from "@/lib/data/types";
import { plural } from "@/lib/utils/texto";

/* ============================================================
   La lente del tema

   El mismo tema se lee a tres profundidades: el índice de artículos para
   el barrido de antes de cantar, los artículos con su texto, y el tema
   entero. No es una pestaña aparte ni una pantalla nueva: es lo mismo
   visto con más o menos detalle, y por eso el selector va pegado al texto
   y no escondido en Ajustes.

   El nivel elegido vive en `perfil.nivelLectura`, así que viaja con el
   perfil y el tema siguiente se abre como se dejó el anterior: quien
   repasa a golpe de artículo no tiene que volver a elegir en cada tema.
   ============================================================ */

/** Etiquetas cortas para el móvil. Las largas no caben en el segmentado. */
const CORTO: Record<NivelLectura, string> = {
  articulos: "Artículos",
  "articulos-texto": "Desarrollados",
  completo: "Completo",
};

export function useNivelLectura(): [NivelLectura, (n: NivelLectura) => void] {
  const nivel = useStore((s) => s.perfil.nivelLectura);
  const setPerfil = useStore((s) => s.setPerfil);
  const set = React.useCallback(
    (n: NivelLectura) => setPerfil({ nivelLectura: n }),
    [setPerfil],
  );
  return [nivel, set];
}

export function SelectorNivel() {
  const [nivel, setNivel] = useNivelLectura();
  return (
    <div
      role="group"
      aria-label="Nivel de lectura"
      className="flex w-full sm:inline-flex sm:w-auto items-center gap-1 p-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]"
    >
      {NIVELES_LECTURA.map((n) => (
        <button
          key={n.id}
          data-nivel={n.id}
          aria-pressed={nivel === n.id}
          aria-label={n.label}
          title={n.desc}
          onClick={() => setNivel(n.id)}
          className={cx(
            "h-8 flex-1 sm:flex-none px-2 sm:px-3 rounded-lg text-[12.5px] font-medium transition-all whitespace-nowrap",
            nivel === n.id
              ? "bg-[var(--surface)] text-fg shadow-sm"
              : "text-muted hover:text-fg",
          )}
        >
          <span className="hidden sm:inline">{n.label}</span>
          <span className="sm:hidden">{CORTO[n.id]}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ el artículo -------------------------------- */

/**
 * El color de la etiqueta del cuerpo legal. Son tokens que ya existen —los
 * mismos con los que se pintan los estados del mural—, repartidos por el
 * nombre del cuerpo: así el CC es siempre del mismo color en todos los
 * temas y el ojo lo reconoce sin leerlo. Nada de colores nuevos.
 */
const TOKENS_CUERPO = [
  "var(--laton)",
  "var(--info)",
  "var(--st-dominado)",
  "var(--st-estudiando)",
  "var(--lacre-bright)",
  "var(--st-cantable)",
];

function colorCuerpo(cuerpo: string): string {
  let suma = 0;
  for (let i = 0; i < cuerpo.length; i++) suma = (suma * 31 + cuerpo.charCodeAt(i)) % 9973;
  return TOKENS_CUERPO[suma % TOKENS_CUERPO.length];
}

function FilaArticulo({
  articulo,
  nivel,
  editable,
  onEditar,
}: {
  articulo: Articulo;
  nivel: NivelLectura;
  editable: boolean;
  onEditar: (a: Articulo) => void;
}) {
  const removeArticulo = useStore((s) => s.removeArticulo);
  const moverArticulo = useStore((s) => s.moverArticulo);
  const conTexto = nivel !== "articulos" && !!articulo.contenido;

  return (
    <div
      data-articulo={articulo.id}
      className={cx(
        "group rounded-[10px] -mx-2 px-2 transition-colors hover:bg-[var(--surface-2)]",
        conTexto ? "py-2" : "py-1",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[10.5px] text-subtle shrink-0">art.</span>
        <span className="numeric text-[15px] font-semibold shrink-0">
          {articulo.numero}
        </span>
        {articulo.cuerpo && (
          <Badge color={colorCuerpo(articulo.cuerpo)} className="shrink-0 translate-y-[1px]">
            {articulo.cuerpo}
          </Badge>
        )}
        <span
          className={cx(
            "text-[13.5px] min-w-[8rem] flex-1",
            articulo.titulo ? "text-fg" : "text-subtle italic",
          )}
        >
          {articulo.titulo || "sin rúbrica"}
        </span>

        {editable && (
          <span className="flex items-center gap-0.5 shrink-0 ml-auto sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
            <button
              onClick={() => moverArticulo(articulo.id, -1)}
              className="hidden sm:block text-subtle hover:text-fg transition-colors p-1"
              aria-label={`Subir ${etiquetaArticulo(articulo)}`}
            >
              <ChevronUp className="size-3.5" />
            </button>
            <button
              onClick={() => moverArticulo(articulo.id, 1)}
              className="hidden sm:block text-subtle hover:text-fg transition-colors p-1"
              aria-label={`Bajar ${etiquetaArticulo(articulo)}`}
            >
              <ChevronDown className="size-3.5" />
            </button>
            <button
              onClick={() => onEditar(articulo)}
              className="text-subtle hover:text-fg transition-colors p-1"
              aria-label={`Editar ${etiquetaArticulo(articulo)}`}
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              onClick={() => removeArticulo(articulo.id)}
              className="text-subtle hover:text-[var(--danger)] transition-colors p-1"
              aria-label={`Borrar ${etiquetaArticulo(articulo)}`}
            >
              <Trash2 className="size-3.5" />
            </button>
          </span>
        )}
      </div>

      {conTexto && (
        <p
          data-articulo-texto={articulo.id}
          className="prose-tema mt-1.5 ml-[26px] pl-3 border-l border-[var(--border)] whitespace-pre-wrap"
        >
          {articulo.contenido}
        </p>
      )}
    </div>
  );
}

/* ------------------------------ la lectura --------------------------------- */

/**
 * El tema recorrido de arriba abajo al nivel elegido.
 *
 * `articulos` llega ya filtrado y ordenado desde fuera: filtrar dentro de
 * un selector de Zustand crearía un array nuevo en cada render y con él el
 * bucle infinito de siempre (docs/decisiones.md).
 */
export function LecturaTema({
  epigrafes,
  articulos,
  nivel,
  editable = false,
  onEditar,
}: {
  epigrafes: Epigrafe[];
  articulos: Articulo[];
  nivel: NivelLectura;
  editable?: boolean;
  onEditar?: (a: Articulo) => void;
}) {
  const grupos = React.useMemo(
    () => agruparPorEpigrafe(articulos, epigrafes),
    [articulos, epigrafes],
  );
  const editar = onEditar ?? (() => {});
  const completo = nivel === "completo";

  // En "solo artículos" un epígrafe sin artículos no aporta nada: el
  // índice tiene que caber en una pantalla, no arrastrar cabeceras vacías.
  const visibles = grupos.filter(
    (g) => g.articulos.length || (completo && g.epigrafe),
  );

  if (!visibles.length) return null;

  return (
    <div className={cx(completo ? "space-y-6" : "space-y-4")}>
      {visibles.map((g, i) => (
        <section key={g.epigrafe?.id ?? "sueltos"}>
          {g.epigrafe ? (
            <h3 className="flex items-baseline gap-2.5 mb-2">
              <span className="numeric text-[11.5px] text-subtle shrink-0">
                {g.epigrafe.orden}
              </span>
              <span className="text-[13px] font-semibold tracking-[-0.01em]">
                {g.epigrafe.titulo}
              </span>
            </h3>
          ) : (
            i > 0 && (
              <h3 className="text-[11px] uppercase tracking-[0.14em] text-subtle mb-2">
                Sin epígrafe asignado
              </h3>
            )
          )}

          {g.articulos.length > 0 && (
            <div className={cx(g.epigrafe && "ml-[18px]")}>
              {g.articulos.map((a) => (
                <FilaArticulo
                  key={a.id}
                  articulo={a}
                  nivel={nivel}
                  editable={editable}
                  onEditar={editar}
                />
              ))}
            </div>
          )}

          {completo && g.epigrafe?.texto && (
            <p
              data-epigrafe-texto={g.epigrafe.id}
              className={cx(
                "prose-tema whitespace-pre-wrap",
                g.epigrafe && "ml-[18px]",
                g.articulos.length ? "mt-3" : "mt-1",
              )}
            >
              {g.epigrafe.texto}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

/* --------------------------- alta pegando un bloque ------------------------ */

export function ModalPegarArticulos({
  abierto,
  onCerrar,
  tema,
}: {
  abierto: boolean;
  onCerrar: () => void;
  tema: Tema;
}) {
  const addArticulos = useStore((s) => s.addArticulos);
  const [texto, setTexto] = React.useState("");
  const [cuerpo, setCuerpo] = React.useState("CC");
  const [epigrafeId, setEpigrafeId] = React.useState("");

  const parseados = React.useMemo(
    () => (texto.trim() ? parsearArticulos(texto, cuerpo) : []),
    [texto, cuerpo],
  );

  const cerrar = () => {
    setTexto("");
    onCerrar();
  };

  return (
    <Modal
      abierto={abierto}
      onCerrar={cerrar}
      titulo="Pegar artículos"
      descripcion="Pega el bloque tal y como lo tengas: del BOE, del temario o de tus apuntes. Se parte por «Artículo 1255», «Art. 34 LH» o «104 LH» y se queda con la rúbrica y el texto de cada uno."
      ancho="max-w-3xl"
    >
      <div className="grid sm:grid-cols-[120px_1fr] gap-3 mb-4">
        <Campo
          etiqueta="Cuerpo legal"
          value={cuerpo}
          onChange={(e) => setCuerpo(e.target.value)}
          placeholder="CC"
          aria-label="Cuerpo legal por defecto"
        />
        <Selector
          etiqueta="Epígrafe"
          value={epigrafeId}
          onChange={(e) => setEpigrafeId(e.target.value)}
          aria-label="Epígrafe al que se asignan"
        >
          <option value="">Sin asignar (a nivel de tema)</option>
          {tema.epigrafes.map((e) => (
            <option key={e.id} value={e.id}>
              {e.orden}. {e.titulo}
            </option>
          ))}
        </Selector>
      </div>

      <AreaTexto
        rows={11}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        aria-label="Bloque de artículos"
        placeholder={
          "Artículo 1857. Requisitos esenciales.\nSon requisitos esenciales de los contratos de prenda e hipoteca…\n\nArt. 1858 CC — Realización del valor\nEs también de esencia de estos contratos que, vencida la obligación…"
        }
        className="font-serif"
      />

      {texto.trim() && parseados.length === 0 && (
        <p className="text-[12.5px] text-[var(--warn)] mt-3 leading-relaxed">
          No se ha encontrado ningún artículo. Cada uno tiene que empezar en su
          propia línea con su número: «Artículo 1255», «Art. 34 LH» o «104 LH».
          Si es uno suelto y no hay forma, métele los campos a mano.
        </p>
      )}

      {parseados.length > 0 && (
        <div className="mt-4 rounded-[10px] border border-[var(--border)] overflow-hidden">
          <div className="px-3.5 py-2.5 bg-[var(--surface-2)] text-[12px] font-medium">
            {plural(parseados.length, "artículo")} detectado
            {parseados.length === 1 ? "" : "s"}
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-[var(--border)]">
            {parseados.map((p, i) => (
              <div key={i} className="px-3.5 py-2.5">
                <div className="flex items-baseline gap-2.5">
                  <span className="numeric text-[13.5px] font-semibold shrink-0">
                    {p.numero}
                  </span>
                  {p.cuerpo && (
                    <Badge color={colorCuerpo(p.cuerpo)} className="shrink-0">
                      {p.cuerpo}
                    </Badge>
                  )}
                  <span
                    className={cx(
                      "text-[13px] min-w-0",
                      p.titulo ? "" : "text-subtle italic",
                    )}
                  >
                    {p.titulo || "sin rúbrica"}
                  </span>
                </div>
                {p.contenido && (
                  <p className="text-[12px] text-subtle mt-1 line-clamp-2">
                    {p.contenido.slice(0, 180)}
                    {p.contenido.length > 180 ? "…" : ""}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-5">
        <Boton variante="fantasma" onClick={cerrar}>
          Cancelar
        </Boton>
        <Boton
          variante="primario"
          disabled={!parseados.length}
          onClick={() => {
            addArticulos(tema.id, parseados, epigrafeId || undefined);
            cerrar();
          }}
        >
          Guardar {parseados.length ? plural(parseados.length, "artículo") : "artículos"}
        </Boton>
      </div>
    </Modal>
  );
}

/* ------------------------- alta suelta y retoque --------------------------- */

/**
 * El formulario campo a campo. No es la vía principal —los artículos se
 * pegan— pero es la única forma de arreglar lo que el troceado haya leído
 * mal y de meter uno suelto sin abrir el Código.
 */
export function ModalArticulo({
  abierto,
  onCerrar,
  tema,
  articulo,
}: {
  abierto: boolean;
  onCerrar: () => void;
  tema: Tema;
  articulo?: Articulo;
}) {
  const addArticulo = useStore((s) => s.addArticulo);
  const updateArticulo = useStore((s) => s.updateArticulo);

  const [cuerpo, setCuerpo] = React.useState("");
  const [numero, setNumero] = React.useState("");
  const [titulo, setTitulo] = React.useState("");
  const [contenido, setContenido] = React.useState("");
  const [epigrafeId, setEpigrafeId] = React.useState("");

  // Cada vez que se abre, el formulario se llena con lo que toque: el
  // artículo que se está retocando, o vacío si es un alta.
  React.useEffect(() => {
    if (!abierto) return;
    setCuerpo(articulo?.cuerpo ?? "");
    setNumero(articulo?.numero ?? "");
    setTitulo(articulo?.titulo ?? "");
    setContenido(articulo?.contenido ?? "");
    setEpigrafeId(articulo?.epigrafeId ?? "");
  }, [abierto, articulo]);

  const guardar = () => {
    if (!numero.trim()) return;
    const datos = {
      cuerpo,
      numero,
      titulo,
      contenido,
      epigrafeId: epigrafeId || undefined,
    };
    if (articulo) {
      updateArticulo(articulo.id, {
        cuerpo: cuerpo.trim(),
        numero: numero.trim(),
        titulo: titulo.trim(),
        contenido: contenido.trim(),
        epigrafeId: epigrafeId || undefined,
      });
    } else {
      addArticulo(tema.id, datos);
    }
    onCerrar();
  };

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={articulo ? "Editar artículo" : "Añadir un artículo"}
      descripcion={
        articulo
          ? undefined
          : "Para dar de alta varios a la vez, pega el bloque entero: se trocea solo."
      }
      ancho="max-w-2xl"
    >
      <div className="grid sm:grid-cols-[100px_130px_1fr] gap-3">
        <Campo
          etiqueta="Cuerpo"
          value={cuerpo}
          onChange={(e) => setCuerpo(e.target.value)}
          placeholder="CC"
        />
        <Campo
          etiqueta="Número"
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          placeholder="1255"
        />
        <Campo
          etiqueta="Rúbrica"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Libertad de pacto"
        />
      </div>

      <div className="mt-3">
        <Selector
          etiqueta="Epígrafe"
          value={epigrafeId}
          onChange={(e) => setEpigrafeId(e.target.value)}
        >
          <option value="">Sin asignar (a nivel de tema)</option>
          {tema.epigrafes.map((e) => (
            <option key={e.id} value={e.id}>
              {e.orden}. {e.titulo}
            </option>
          ))}
        </Selector>
      </div>

      <div className="mt-3">
        <AreaTexto
          etiqueta="Texto íntegro"
          rows={7}
          value={contenido}
          onChange={(e) => setContenido(e.target.value)}
          placeholder="Los contratantes pueden establecer los pactos, cláusulas y condiciones que tengan por conveniente…"
          className="prose-tema"
        />
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <Boton variante="fantasma" onClick={onCerrar}>
          Cancelar
        </Boton>
        <Boton variante="primario" disabled={!numero.trim()} onClick={guardar}>
          {articulo ? "Guardar cambios" : "Añadir artículo"}
        </Boton>
      </div>
    </Modal>
  );
}

/* --------------------------- el panel del tema ----------------------------- */

/**
 * La lente montada sobre un tema: el selector de nivel arriba, la lectura
 * debajo y las dos vías de alta al pie. Es lo que se ve en la ficha del
 * tema y, con `editable={false}`, lo mismo que se recorre en el repaso.
 */
export function PanelLectura({
  tema,
  articulos,
}: {
  tema: Tema;
  articulos: Articulo[];
}) {
  const [nivel] = useNivelLectura();
  const [pegar, setPegar] = React.useState(false);
  const [editando, setEditando] = React.useState<Articulo | undefined>();
  const [formulario, setFormulario] = React.useState(false);

  const conTexto = articulos.filter((a) => a.contenido).length;

  return (
    <>
      <Card className="p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-[var(--border)]">
          <div className="text-[12.5px] text-muted inline-flex items-center gap-2">
            <Scale className="size-3.5 text-subtle" />
            {articulos.length
              ? `${plural(articulos.length, "artículo")}${
                  conTexto < articulos.length
                    ? ` · ${articulos.length - conTexto} sin texto`
                    : ""
                }`
              : "Sin artículos todavía"}
          </div>
          <SelectorNivel />
        </div>

        {articulos.length === 0 ? (
          <Vacio
            icono={<Scale className="size-5" />}
            titulo="Este tema no tiene artículos"
            texto="El barrido de antes de cantar es la lista de artículos: número y rúbrica, uno detrás de otro. Pega el bloque tal cual y se trocea solo."
            accion={
              <Boton variante="primario" onClick={() => setPegar(true)}>
                <Wand2 className="size-4" />
                Pegar artículos
              </Boton>
            }
          />
        ) : (
          <div className="px-5 py-4">
            <LecturaTema
              epigrafes={tema.epigrafes}
              articulos={articulos}
              nivel={nivel}
              editable
              onEditar={(a) => setEditando(a)}
            />
          </div>
        )}

        <div className="flex flex-wrap gap-2 px-5 py-3.5 border-t border-[var(--border)]">
          <Boton tam="sm" variante="secundario" onClick={() => setPegar(true)}>
            <Wand2 className="size-3.5" />
            Pegar artículos
          </Boton>
          <Boton
            tam="sm"
            variante="fantasma"
            onClick={() => {
              setEditando(undefined);
              setFormulario(true);
            }}
          >
            <Plus className="size-3.5" />
            Añadir uno a mano
          </Boton>
        </div>
      </Card>

      <ModalPegarArticulos
        abierto={pegar}
        onCerrar={() => setPegar(false)}
        tema={tema}
      />
      <ModalArticulo
        abierto={formulario || !!editando}
        onCerrar={() => {
          setFormulario(false);
          setEditando(undefined);
        }}
        tema={tema}
        articulo={editando}
      />
    </>
  );
}

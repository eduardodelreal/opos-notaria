"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowDownWideNarrow,
  BookOpenText,
  Download,
  Moon,
  Rows3,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import { useCantes, useKeyPoints, useSesiones, useStore, useTemas } from "@/lib/store/store";
import { Cabecera } from "@/components/Shell";
import {
  Badge,
  Boton,
  Campo,
  Card,
  Selector,
  TituloSeccion,
  cx,
  useConfirmacion,
} from "@/components/ui";
import { AvisoSinCuenta, TarjetaSincronizacion } from "@/components/Sincronizacion";
import { AjustesAvisos } from "@/components/AjustesAvisos";
import { vaciarAudios } from "@/lib/audio/almacen";
import {
  ACENTOS,
  ACENTO_PERSONAL_INICIAL,
  ORDENES,
  TAMANO_TEMA_INICIAL,
  TAMANO_TEMA_MAXIMO,
  TAMANO_TEMA_MINIMO,
  TONOS,
  paletaDe,
  veredictoAcento,
} from "@/lib/data/apariencia";
import { ESTADOS, type Perfil, type Tono } from "@/lib/data/types";

export default function Ajustes() {
  const perfil = useStore((s) => s.perfil);
  const sesiones = useSesiones();
  const temas = useTemas();
  const cantes = useCantes();
  const keypoints = useKeyPoints();
  const setPerfil = useStore((s) => s.setPerfil);
  const exportar = useStore((s) => s.exportar);
  const importar = useStore((s) => s.importar);
  const borrarTodo = useStore((s) => s.borrarTodo);
  const { pedir, dialogo } = useConfirmacion();

  const [mensaje, setMensaje] = React.useState<{ ok: boolean; texto: string } | null>(
    null,
  );
  const inputRef = React.useRef<HTMLInputElement>(null);

  const descargar = () => {
    const blob = new Blob([exportar()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `opos-notaria-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMensaje({ ok: true, texto: "Copia descargada." });
  };

  const subir = async (archivo: File) => {
    const texto = await archivo.text();
    const r = importar(texto);
    setMensaje(
      r.ok
        ? { ok: true, texto: "Expediente importado." }
        : { ok: false, texto: r.error ?? "No se ha podido importar." },
    );
  };

  return (
    <>
      <Cabecera
        titulo="Ajustes"
        descripcion="Tu perfil, tus objetivos y tus datos. Todo se guarda en este navegador; nada sale de aquí salvo lo que mandas a la IA cuando la usas."
      />

      <div className="grid lg:grid-cols-2 gap-4">
        {/* -------------------------------- Perfil ---------------------------- */}
        <Card>
          <TituloSeccion>Perfil</TituloSeccion>
          <div className="space-y-4">
            <Campo
              etiqueta="Cómo te llamas"
              value={perfil.nombre}
              onChange={(e) => setPerfil({ nombre: e.target.value })}
              placeholder="Tu nombre"
            />
            <Selector
              etiqueta="Oposición"
              value={perfil.oposicion}
              onChange={(e) =>
                setPerfil({ oposicion: e.target.value as Perfil["oposicion"] })
              }
            >
              <option value="notarias">Notarías</option>
              <option value="registros">Registros de la Propiedad</option>
              <option value="judicatura">Judicatura / Fiscales</option>
            </Selector>
            <Campo
              etiqueta="Preparador"
              value={perfil.preparador ?? ""}
              onChange={(e) => setPerfil({ preparador: e.target.value })}
              placeholder="Nombre de tu preparador (opcional)"
            />
            <div className="grid grid-cols-2 gap-3">
              <Campo
                etiqueta="Empecé la oposición"
                type="date"
                value={new Date(perfil.fechaInicio).toISOString().slice(0, 10)}
                onChange={(e) =>
                  setPerfil({ fechaInicio: new Date(e.target.value).getTime() })
                }
              />
              <Campo
                etiqueta="Examen objetivo"
                type="date"
                value={perfil.fechaExamen ?? ""}
                onChange={(e) => setPerfil({ fechaExamen: e.target.value })}
                pista="Se usa para avisarte si no llegas"
              />
            </div>
          </div>
        </Card>

        {/* ------------------------------ Objetivos --------------------------- */}
        <Card>
          <TituloSeccion>Objetivos y reglas</TituloSeccion>
          <div className="space-y-4">
            <Campo
              etiqueta="Horas de estudio por semana"
              type="number"
              min={1}
              max={100}
              value={perfil.objetivoHorasSemana}
              onChange={(e) =>
                setPerfil({ objetivoHorasSemana: Number(e.target.value) || 40 })
              }
              pista="Sé honesto: el plan de la IA se construye sobre lo que haces, no sobre lo que te propones"
            />
            <Campo
              etiqueta="Minutos por tema en el cante"
              type="number"
              min={1}
              max={60}
              value={perfil.minutosPorTema}
              onChange={(e) =>
                setPerfil({ minutosPorTema: Number(e.target.value) || 10 })
              }
              pista="El tiempo que da tu tribunal. Marca la línea roja del modo cante"
            />
            <Campo
              etiqueta="Días para marcar un tema como oxidado"
              type="number"
              min={7}
              max={365}
              value={perfil.diasOxido}
              onChange={(e) => setPerfil({ diasOxido: Number(e.target.value) || 45 })}
              pista="Un tema dominado que lleva más de este tiempo sin tocarse se pinta en rojo"
            />
            <Selector
              etiqueta="Cómo quieres el feedback de la IA"
              value={perfil.estiloFeedback}
              onChange={(e) =>
                setPerfil({
                  estiloFeedback: e.target.value as Perfil["estiloFeedback"],
                })
              }
            >
              <option value="directo">Directo — al fallo, sin rodeos</option>
              <option value="equilibrado">Equilibrado — exigente y constructivo</option>
              <option value="amable">Amable — exigente pero cuidando la moral</option>
            </Selector>
          </div>
        </Card>

        {/* -------------------------------- Avisos ---------------------------- */}
        {/* Se pinta solo si hay Supabase, sesión y claves VAPID; en cualquier
            otro caso el propio componente devuelve null. */}
        <AjustesAvisos />

        {/* ------------------------------ Apariencia -------------------------- */}
        <BloqueApariencia />

        {/* ---------------------------- Cómo se ordena ------------------------ */}
        <Card>
          <TituloSeccion>Cómo se listan tus temas</TituloSeccion>
          <div className="space-y-4">
            <Selector
              etiqueta="Orden de los temas"
              value={perfil.ordenTemas}
              onChange={(e) =>
                setPerfil({ ordenTemas: e.target.value as Perfil["ordenTemas"] })
              }
            >
              {ORDENES.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label} — {o.pista}
                </option>
              ))}
            </Selector>
            <p className="text-[12.5px] text-muted leading-relaxed">
              Vale para el programa, el cante, el crono y el repaso. Dentro de cada
              materia: el mural se lee por materias y eso no cambia.{" "}
              <span className="text-subtle">
                En el cante y en el repaso, que son colas de «qué toca ahora», el
                orden por número se sustituye por la urgencia; cualquier otro
                criterio que elijas aquí sí manda también allí.
              </span>
            </p>
            <div className="hairline" />
            <p className="text-[12.5px] text-muted leading-relaxed">
              El orden de las <strong className="font-medium text-fg">materias</strong>{" "}
              se cambia en{" "}
              <Link href="/programa" className="text-[var(--laton)] hover:underline">
                Programa → Materias
              </Link>
              , con las flechas de cada fila. Manda en el mural, en los filtros y en
              todas las listas.
            </p>
          </div>
        </Card>

        {/* -------------------------------- Datos ----------------------------- */}
        <Card>
          <TituloSeccion>Tus datos</TituloSeccion>
          <div className="grid grid-cols-4 gap-3 mb-5 text-center">
            {[
              { v: temas.length, l: "temas" },
              { v: cantes.length, l: "cantes" },
              { v: sesiones.length, l: "sesiones" },
              { v: keypoints.length, l: "keypoints" },
            ].map((x) => (
              <div key={x.l}>
                <div className="numeric text-[20px] font-semibold">{x.v}</div>
                <div className="text-[10.5px] uppercase tracking-[0.1em] text-subtle mt-1">
                  {x.l}
                </div>
              </div>
            ))}
          </div>

          <p className="text-[12.5px] text-muted leading-relaxed mb-4">
            Todo vive en IndexedDB, en este navegador. Si formateas el equipo o borras
            los datos del sitio, se pierde: descarga una copia de vez en cuando.
          </p>

          <AvisoSinCuenta className="mb-4" />

          <div className="flex flex-wrap gap-2">
            <Boton variante="secundario" onClick={descargar}>
              <Download className="size-4" />
              Descargar copia
            </Boton>
            <Boton variante="secundario" onClick={() => inputRef.current?.click()}>
              <Upload className="size-4" />
              Importar
            </Boton>
            <input
              ref={inputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) subir(f);
                e.target.value = "";
              }}
            />
            <Boton
              variante="peligro"
              onClick={() =>
                pedir(
                  "Borrar todo",
                  "Se borran temas, cantes, sesiones, keypoints, notas, simulacros y las grabaciones de los cantes. No hay vuelta atrás. Descarga una copia antes si tienes dudas.",
                  () => {
                    // Los audios viven en su propia base de IndexedDB, así que
                    // no se los lleva el borrado del expediente: hay que
                    // vaciarlos a mano o quedarían megas huérfanos.
                    void vaciarAudios();
                    borrarTodo();
                  },
                )
              }
            >
              <Trash2 className="size-4" />
              Borrar todo
            </Boton>
          </div>

          {mensaje && (
            <p
              className="text-[12.5px] mt-3"
              style={{ color: mensaje.ok ? "var(--ok)" : "var(--danger)" }}
            >
              {mensaje.texto}
            </p>
          )}
        </Card>
      </div>

      <TarjetaSincronizacion className="mt-4" />

      <Card className="mt-4">
        <TituloSeccion>Sobre la IA</TituloSeccion>
        <p className="text-[13px] text-muted leading-relaxed">
          Las funciones de IA (análisis de cantes, chat, plan semanal, keypoints y
          corrección de dictámenes) llaman a la API de Anthropic desde el servidor de
          la app, con la clave que pongas en{" "}
          <code className="text-[var(--laton)]">.env.local</code>. En cada llamada se
          envía tu ficha: temas, estados, horas, cantes, notas y epígrafes fallados.
          No se manda el texto completo de tus temas salvo cuando pides extraer
          keypoints de un tema concreto o corregir un dictamen. Sin clave, la app
          funciona entera menos esas funciones.
        </p>
      </Card>

      {dialogo}
    </>
  );
}

/* ========================================================================== */
/*                                Apariencia                                  */
/* ========================================================================== */

/**
 * Valor que se pinta al instante y se guarda en el perfil cuando reposa.
 *
 * Lo necesitan el selector de color y el deslizador del cuerpo de texto:
 * los dos disparan `change` en cada píxel de arrastre, y cada escritura del
 * perfil serializa el expediente entero a IndexedDB y encola una fila para
 * sincronizar. Sin esto, arrastrar un deslizador dos segundos son cien
 * escrituras. La vista previa usa el valor local, así que el opositor ve el
 * cambio mientras arrastra; lo que espera es el guardado.
 */
function useDiferido<T>(
  valor: T,
  guardar: (v: T) => void,
  ms = 200,
): readonly [T, (v: T) => void] {
  const [local, setLocal] = React.useState(valor);
  const guardarRef = React.useRef(guardar);
  guardarRef.current = guardar;

  // Si el valor cambia por fuera (otro dispositivo, importar una copia), el
  // control tiene que seguirlo.
  React.useEffect(() => setLocal(valor), [valor]);

  React.useEffect(() => {
    if (local === valor) return;
    const id = setTimeout(() => guardarRef.current(local), ms);
    return () => clearTimeout(id);
  }, [local, valor, ms]);

  return [local, setLocal] as const;
}

const ICONO_TONO: Record<Tono, React.ComponentType<{ className?: string }>> = {
  dark: Moon,
  light: Sun,
  sepia: BookOpenText,
};

function BloqueApariencia() {
  const perfil = useStore((s) => s.perfil);
  const setPerfil = useStore((s) => s.setPerfil);

  const [colorLibre, setColorLibre] = useDiferido(
    perfil.acentoPersonal ?? ACENTO_PERSONAL_INICIAL,
    (v) => setPerfil({ acentoPersonal: v, acento: "personal" }),
  );
  const [cuerpo, setCuerpo] = useDiferido(perfil.tamanoTema, (v) =>
    setPerfil({ tamanoTema: v }),
  );

  // El color de cada botón de acento es el que se va a aplicar de verdad,
  // ya corregido para este tono: la muestra no puede prometer un color y
  // pintar otro.
  const muestras = React.useMemo(
    () =>
      new Map(
        ACENTOS.map((a) => [
          a.id,
          paletaDe({
            ...perfil,
            acento: a.id,
            acentoPersonal: a.id === "personal" ? colorLibre : perfil.acentoPersonal,
          }),
        ]),
      ),
    [perfil, colorLibre],
  );

  const veredicto = React.useMemo(
    () => veredictoAcento(colorLibre, perfil.tema),
    [colorLibre, perfil.tema],
  );

  return (
    <Card className="lg:col-span-2">
      <TituloSeccion accion={
        <button
          onClick={() =>
            setPerfil({
              tema: "dark",
              acento: "lacre",
              fuenteTemas: "serif",
              tamanoTema: TAMANO_TEMA_INICIAL,
              densidad: "normal",
            })
          }
          className="text-[11.5px] text-subtle hover:text-fg transition-colors"
        >
          Volver a la de siempre
        </button>
      }>
        Apariencia
      </TituloSeccion>

      <div className="grid lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-6">
          {/* ---------------------------- tono base ------------------------- */}
          <Grupo
            titulo="Fondo"
            pista="El sepia es papel cálido: para leer temas durante horas cansa menos que el blanco"
          >
            <div className="grid grid-cols-3 gap-2.5">
              {TONOS.map((t) => {
                const Icono = ICONO_TONO[t.id];
                return (
                  <button
                    key={t.id}
                    data-tono={t.id}
                    aria-pressed={perfil.tema === t.id}
                    onClick={() => setPerfil({ tema: t.id })}
                    title={t.descripcion}
                    className={cx(
                      "h-[74px] rounded-[12px] border flex flex-col items-center justify-center gap-2 transition-all",
                      perfil.tema === t.id
                        ? "border-[var(--laton)] bg-[var(--laton-soft)] text-fg"
                        : "border-[var(--border)] text-muted hover:text-fg",
                    )}
                  >
                    <Icono className="size-5" />
                    <span className="text-[13px]">{t.nombre}</span>
                  </button>
                );
              })}
            </div>
          </Grupo>

          {/* ------------------------------ acento -------------------------- */}
          <Grupo
            titulo="Acento"
            pista="El color del lacre. El latón dorado no se toca: es lo que hace que la app siga siendo la misma"
          >
            <div className="flex flex-wrap gap-2">
              {ACENTOS.map((a) => {
                const p = muestras.get(a.id)!;
                const activo = perfil.acento === a.id;
                return (
                  <button
                    key={a.id}
                    data-acento={a.id}
                    aria-pressed={activo}
                    onClick={() =>
                      setPerfil(
                        a.id === "personal"
                          ? { acento: "personal", acentoPersonal: colorLibre }
                          : { acento: a.id },
                      )
                    }
                    title={a.descripcion}
                    className={cx(
                      "h-9 pl-2 pr-3 rounded-full border inline-flex items-center gap-2 text-[12.5px] transition-all",
                      activo
                        ? "border-[var(--border-strong)] bg-[var(--surface-2)] text-fg"
                        : "border-[var(--border)] text-muted hover:text-fg",
                    )}
                  >
                    <span
                      className="size-5 rounded-full shrink-0"
                      style={{
                        background: p.lacre,
                        boxShadow: activo ? `0 0 0 2px var(--surface), 0 0 0 3.5px ${p.lacre}` : undefined,
                      }}
                    />
                    {a.nombre}
                  </button>
                );
              })}
            </div>

            {perfil.acento === "personal" && (
              <div className="mt-3 flex items-center gap-3 flex-wrap">
                <input
                  type="color"
                  aria-label="Color del acento"
                  value={colorLibre}
                  onChange={(e) => setColorLibre(e.target.value)}
                  className="size-9 rounded-md bg-transparent border-0 cursor-pointer p-0 shrink-0"
                />
                <p className="text-[12px] text-muted leading-relaxed flex-1 min-w-[220px]">
                  {veredicto.corregido ? (
                    <>
                      Ese color no se leía sobre este fondo, así que se ha ajustado a{" "}
                      <code className="text-fg">{veredicto.aplicado}</code>. Contraste{" "}
                      {veredicto.contrasteFondo.toFixed(1)}:1.
                    </>
                  ) : (
                    <>
                      Contraste {veredicto.contrasteFondo.toFixed(1)}:1 contra el fondo.
                      Se lee bien, va tal cual.
                    </>
                  )}
                </p>
              </div>
            )}
          </Grupo>

          {/* --------------------------- tipografía ------------------------- */}
          <Grupo
            titulo="Texto de los temas"
            pista="Solo cambia el texto que estudias: los titulares y la interfaz se quedan como están"
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
                {(
                  [
                    { id: "serif", label: "Serif" },
                    { id: "sans", label: "Sans" },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    data-fuente={f.id}
                    aria-pressed={perfil.fuenteTemas === f.id}
                    onClick={() => setPerfil({ fuenteTemas: f.id })}
                    className={cx(
                      "h-8 px-3.5 rounded-lg text-[13px] font-medium transition-all",
                      perfil.fuenteTemas === f.id
                        ? "bg-[var(--surface)] text-fg shadow-sm"
                        : "text-muted hover:text-fg",
                    )}
                    style={{
                      fontFamily: f.id === "serif" ? "var(--font-serif)" : "var(--font-ui)",
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <label className="flex-1 min-w-[220px] flex items-center gap-3">
                <span className="text-[12px] text-muted shrink-0">Cuerpo</span>
                <input
                  type="range"
                  aria-label="Cuerpo del texto de los temas"
                  min={TAMANO_TEMA_MINIMO}
                  max={TAMANO_TEMA_MAXIMO}
                  step={1}
                  value={cuerpo}
                  onChange={(e) => setCuerpo(Number(e.target.value))}
                  className="flex-1 accent-[var(--lacre-bright)]"
                />
                <span className="numeric text-[12.5px] text-subtle w-10 text-right shrink-0">
                  {cuerpo}px
                </span>
              </label>
            </div>
          </Grupo>

          {/* ---------------------------- densidad -------------------------- */}
          <Grupo
            titulo="Densidad"
            pista="La compacta encoge el aire de la interfaz, no la letra: cabe más en pantalla"
          >
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
              {(
                [
                  { id: "normal", label: "Normal", icono: Rows3 },
                  { id: "compacta", label: "Compacta", icono: ArrowDownWideNarrow },
                ] as const
              ).map((d) => {
                const Icono = d.icono;
                return (
                  <button
                    key={d.id}
                    data-densidad={d.id}
                    aria-pressed={perfil.densidad === d.id}
                    onClick={() => setPerfil({ densidad: d.id })}
                    className={cx(
                      "h-8 px-3.5 rounded-lg text-[13px] font-medium transition-all inline-flex items-center gap-2",
                      perfil.densidad === d.id
                        ? "bg-[var(--surface)] text-fg shadow-sm"
                        : "text-muted hover:text-fg",
                    )}
                  >
                    <Icono className="size-3.5" />
                    {d.label}
                  </button>
                );
              })}
            </div>
          </Grupo>
        </div>

        {/* --------------------------- vista previa ------------------------- */}
        <div>
          <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-subtle mb-3">
            Vista previa
          </span>
          {/* No es una maqueta aparte: la app entera ya está pintada con lo
              que hay elegido (components/Proveedor.tsx lo aplica sobre
              <html> en cuanto cambia el perfil). Esto es una muestra de las
              piezas que no se ven desde Ajustes —un párrafo de temario, el
              botón primario, los estados del mural— para no tener que
              navegar a otra pantalla para comprobar. */}
          <div className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
            <p className="text-[10.5px] uppercase tracking-[0.12em] text-subtle mb-2">
              Tema 47 · epígrafe II
            </p>
            <p
              data-vista-previa="tema"
              className="prose-tema"
              style={{ fontSize: `${cuerpo / 16}rem` }}
            >
              La hipoteca es un derecho real de garantía que sujeta directa e
              inmediatamente los bienes sobre los que se impone al cumplimiento de la
              obligación para cuya seguridad fue constituida.
            </p>
            <div className="hairline my-4" />
            <div className="flex flex-wrap items-center gap-2">
              <Boton tam="sm" variante="primario">
                Empezar el cante
              </Boton>
              <Boton tam="sm" variante="secundario">
                Repasar
              </Boton>
            </div>
            <div className="flex flex-wrap gap-2 mt-3.5">
              {ESTADOS.map((e) => (
                <Badge key={e.id} color={e.color}>
                  {e.label}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Grupo({
  titulo,
  pista,
  children,
}: {
  titulo: string;
  pista: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="block text-[12.5px] font-medium mb-1">{titulo}</span>
      <p className="text-[11.5px] text-subtle leading-relaxed mb-2.5">{pista}</p>
      {children}
    </div>
  );
}

"use client";

import * as React from "react";
import { Play, Timer } from "lucide-react";
import {
  temasOrdenados,
  useMaterias,
  useProgresos,
  useSesiones,
  useStore,
  useTemas,
} from "@/lib/store/store";
import { Cabecera } from "@/components/Shell";
import {
  Boton,
  Card,
  Metrica,
  Selector,
  TituloSeccion,
  Vacio,
  cx,
} from "@/components/ui";
import { Anillo, Barras, MapaCalor } from "@/components/graficos";
import { horas, horasMin, fechaHora, inicioSemana } from "@/lib/utils/time";
import { serieDiaria } from "@/lib/data/srs";
import type { TipoSesion } from "@/lib/data/types";

const POMODOROS = [
  { min: 25, label: "25 min", desc: "Pomodoro clásico" },
  { min: 50, label: "50 min", desc: "Bloque largo" },
  { min: 90, label: "90 min", desc: "Ciclo ultradiano" },
];

export default function Cronos() {
  const temas = useTemas();
  const materias = useMaterias();
  const sesiones = useSesiones();
  const crono = useStore((s) => s.crono);
  const iniciarCrono = useStore((s) => s.iniciarCrono);
  const perfil = useStore((s) => s.perfil);
  const progresos = useProgresos();

  const [temaId, setTemaId] = React.useState("");
  const [tipo, setTipo] = React.useState<TipoSesion>("estudio");
  const [objetivo, setObjetivo] = React.useState<number | null>(null);
  const [segundos, setSegundos] = React.useState(0);

  // El desplegable de "a qué tema le echas la hora" respeta el criterio del
  // opositor: quien ordena por tiempo invertido se encuentra arriba los
  // temas a los que menos horas les ha echado, que es justo lo que busca al
  // abrir el crono.
  const ordenados = React.useMemo(
    () => temasOrdenados(temas, materias, perfil.ordenTemas, progresos, perfil.diasOxido),
    [temas, materias, perfil.ordenTemas, progresos, perfil.diasOxido],
  );

  React.useEffect(() => {
    if (!crono) {
      setSegundos(0);
      return;
    }
    const tic = () => setSegundos(useStore.getState().segundosCrono());
    tic();
    const id = setInterval(tic, 500);
    return () => clearInterval(id);
  }, [crono]);

  const serie = React.useMemo(() => serieDiaria(sesiones, 182), [sesiones]);

  const semana = React.useMemo(() => {
    const dias = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
    const inicio = inicioSemana();
    return dias.map((d, i) => {
      const desde = inicio + i * 86_400_000;
      const hasta = desde + 86_400_000;
      return {
        etiqueta: d,
        valor: sesiones
          .filter((s) => s.inicio >= desde && s.inicio < hasta)
          .reduce((a, s) => a + s.segundos, 0),
      };
    });
  }, [sesiones]);

  const porTipo = React.useMemo(() => {
    const acc: Record<TipoSesion, number> = { estudio: 0, repaso: 0, cante: 0 };
    for (const s of sesiones) acc[s.tipo] += s.segundos;
    return acc;
  }, [sesiones]);

  const recientes = React.useMemo(
    () => [...sesiones].sort((a, b) => b.inicio - a.inicio).slice(0, 12),
    [sesiones],
  );

  const totalSemana = semana.reduce((a, d) => a + d.valor, 0);
  const pctObjetivo = objetivo ? (segundos / (objetivo * 60)) * 100 : 0;

  return (
    <>
      <Cabecera
        titulo="Cronos"
        descripcion="Horas efectivas, no horas de silla. El cronómetro se pausa solo si te levantas y sigue contando aunque cambies de página."
      />

      <div className="grid lg:grid-cols-[1fr_1.1fr] gap-4 mb-4">
        {/* ------------------------------ Lanzador ---------------------------- */}
        <Card>
          {crono ? (
            <div className="flex flex-col items-center py-4">
              <Anillo
                valor={objetivo ? pctObjetivo : Math.min(100, (segundos / 3600) * 100)}
                tamano={168}
                grosor={11}
                color={
                  objetivo && pctObjetivo >= 100 ? "var(--ok)" : "var(--laton)"
                }
                centro={
                  <span className="numeric text-[30px]">
                    {Math.floor(segundos / 60)}
                    <span className="text-[16px] text-subtle">
                      :{String(segundos % 60).padStart(2, "0")}
                    </span>
                  </span>
                }
                sub={crono.pausado ? "en pausa" : crono.tipo}
              />
              <p className="text-[13px] text-muted mt-5 text-center">
                {crono.temaId
                  ? temas.find((t) => t.id === crono.temaId)?.titulo
                  : "Sesión sin tema asignado"}
              </p>
              {objetivo && (
                <p className="text-[12px] text-subtle mt-1.5">
                  Objetivo de {objetivo} min
                  {pctObjetivo >= 100 && " — cumplido, puedes parar"}
                </p>
              )}
              <p className="text-[12px] text-subtle mt-4">
                Los controles están en la barra flotante de abajo.
              </p>
            </div>
          ) : (
            <>
              <TituloSeccion>Nueva sesión</TituloSeccion>

              <div className="grid grid-cols-3 gap-2 mb-4">
                {(
                  [
                    { id: "estudio", label: "Estudio" },
                    { id: "repaso", label: "Repaso" },
                    { id: "cante", label: "Cante" },
                  ] as { id: TipoSesion; label: string }[]
                ).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTipo(t.id)}
                    className={cx(
                      "h-10 rounded-[10px] border text-[13px] font-medium transition-all",
                      tipo === t.id
                        ? "border-[var(--lacre)] bg-[var(--lacre-soft)] text-fg"
                        : "border-[var(--border)] text-muted hover:text-fg",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <Selector
                etiqueta="Tema (opcional)"
                value={temaId}
                onChange={(e) => setTemaId(e.target.value)}
                className="mb-4"
              >
                <option value="">Sin tema concreto</option>
                {ordenados.map((t) => (
                  <option key={t.id} value={t.id}>
                    T{t.numero} · {t.titulo.slice(0, 60)}
                  </option>
                ))}
              </Selector>

              <div className="mb-5">
                <span className="block text-xs font-medium text-muted mb-2">
                  Objetivo del bloque
                </span>
                <div className="grid grid-cols-4 gap-2">
                  <button
                    onClick={() => setObjetivo(null)}
                    className={cx(
                      "h-10 rounded-[10px] border text-[12.5px] transition-all",
                      objetivo === null
                        ? "border-[var(--border-strong)] bg-[var(--surface-2)] text-fg"
                        : "border-[var(--border)] text-muted hover:text-fg",
                    )}
                  >
                    Libre
                  </button>
                  {POMODOROS.map((p) => (
                    <button
                      key={p.min}
                      onClick={() => setObjetivo(p.min)}
                      title={p.desc}
                      className={cx(
                        "h-10 rounded-[10px] border text-[12.5px] transition-all",
                        objetivo === p.min
                          ? "border-[var(--border-strong)] bg-[var(--surface-2)] text-fg"
                          : "border-[var(--border)] text-muted hover:text-fg",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <Boton
                variante="primario"
                tam="lg"
                className="w-full"
                onClick={() => iniciarCrono(tipo, temaId || undefined)}
              >
                <Play className="size-4" />
                Arrancar
              </Boton>
            </>
          )}
        </Card>

        {/* ------------------------------- Semana ----------------------------- */}
        <Card>
          <TituloSeccion
            accion={
              <span className="text-[11px] text-subtle numeric">
                {horas(totalSemana)} h esta semana
              </span>
            }
          >
            Reparto semanal
          </TituloSeccion>
          <Barras datos={semana} alto={150} />

          <div className="hairline my-5" />

          <div className="grid grid-cols-3 gap-4">
            <Metrica valor={horas(porTipo.estudio)} sufijo="h" etiqueta="Estudio" />
            <Metrica valor={horas(porTipo.repaso)} sufijo="h" etiqueta="Repaso" />
            <Metrica valor={horas(porTipo.cante)} sufijo="h" etiqueta="Cante" />
          </div>
        </Card>
      </div>

      <Card className="mb-4">
        <TituloSeccion>Últimos seis meses</TituloSeccion>
        <MapaCalor datos={serie} />
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[var(--border)]">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-subtle">
            Sesiones recientes
          </h2>
        </div>
        {recientes.length === 0 ? (
          <Vacio
            icono={<Timer className="size-5" />}
            titulo="Todavía no hay sesiones"
            texto="Arranca el cronómetro y empieza a acumular horas medidas de verdad."
          />
        ) : (
          recientes.map((s, i) => {
            const t = temas.find((x) => x.id === s.temaId);
            return (
              <div
                key={s.id}
                className={cx(
                  "flex items-center gap-4 px-5 py-3",
                  i > 0 && "border-t border-[var(--border)]",
                )}
              >
                <span
                  className="text-[10px] uppercase tracking-[0.1em] w-14 shrink-0"
                  style={{
                    color:
                      s.tipo === "cante"
                        ? "var(--lacre-bright)"
                        : s.tipo === "repaso"
                          ? "var(--info)"
                          : "var(--fg-subtle)",
                  }}
                >
                  {s.tipo}
                </span>
                <span className="text-[13px] flex-1 truncate">
                  {t ? `T${t.numero} · ${t.titulo}` : "Sin tema"}
                </span>
                <span className="text-[11.5px] text-subtle shrink-0 hidden sm:block">
                  {fechaHora(s.inicio)}
                </span>
                <span className="numeric text-[13px] font-medium shrink-0 w-16 text-right">
                  {horasMin(s.segundos)}
                </span>
              </div>
            );
          })
        )}
      </Card>
    </>
  );
}

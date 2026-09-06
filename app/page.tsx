"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  Flame,
  Mic,
  Play,
  Sparkles,
  TriangleAlert,
  LayoutGrid,
} from "lucide-react";
import { useProgresos, useStore } from "@/lib/store/store";
import { Cabecera } from "@/components/Shell";
import {
  Badge,
  Barra,
  Boton,
  Card,
  Metrica,
  Punto,
  TituloSeccion,
  Vacio,
} from "@/components/ui";
import { Anillo, MapaCalor, Barras } from "@/components/graficos";
import {
  colaDeRepaso,
  detectarLagunas,
  estadoEfectivo,
  predecirFinalizacion,
  resumenGlobal,
  serieDiaria,
} from "@/lib/data/srs";
import { ESTADOS } from "@/lib/data/types";
import { fecha, haceTexto, horas, horasMin, inicioSemana } from "@/lib/utils/time";
import { plural } from "@/lib/utils/texto";

export default function Panel() {
  const { perfil, temas, sesiones, cantes, materias } = useStore();
  const progresos = useProgresos();
  const iniciarCrono = useStore((s) => s.iniciarCrono);
  const crono = useStore((s) => s.crono);

  const resumen = React.useMemo(
    () => resumenGlobal(temas, progresos, sesiones, cantes, perfil.diasOxido),
    [temas, progresos, sesiones, cantes, perfil.diasOxido],
  );

  const cola = React.useMemo(
    () => colaDeRepaso(temas, progresos, 6),
    [temas, progresos],
  );

  const lagunas = React.useMemo(
    () => detectarLagunas(temas, progresos, cantes, 3),
    [temas, progresos, cantes],
  );

  const prediccion = React.useMemo(
    () => predecirFinalizacion(temas, progresos, cantes, perfil.fechaExamen),
    [temas, progresos, cantes, perfil.fechaExamen],
  );

  const serie = React.useMemo(() => serieDiaria(sesiones, 364), [sesiones]);

  const semana = React.useMemo(() => {
    const dias = ["L", "M", "X", "J", "V", "S", "D"];
    const inicio = inicioSemana();
    return dias.map((d, i) => {
      const desde = inicio + i * 86_400_000;
      const hasta = desde + 86_400_000;
      const segundos = sesiones
        .filter((s) => s.inicio >= desde && s.inicio < hasta)
        .reduce((a, s) => a + s.segundos, 0);
      return { etiqueta: d, valor: segundos };
    });
  }, [sesiones]);

  const ultimosCantes = React.useMemo(
    () => [...cantes].sort((a, b) => b.fecha - a.fecha).slice(0, 4),
    [cantes],
  );

  const tituloTema = (id: string) => {
    const t = temas.find((x) => x.id === id);
    return t ? `T${t.numero} · ${t.titulo}` : "Tema eliminado";
  };

  /* ------------------------------ Sin datos ------------------------------ */

  if (!temas.length) {
    return (
      <>
        <Cabecera
          titulo="Tu expediente está vacío"
          descripcion="Lo primero es meter tu programa. Puedes pegarlo entero de una vez: la app lo trocea en temas."
        />
        <Card className="p-0 overflow-hidden">
          <Vacio
            icono={<LayoutGrid className="size-5" />}
            titulo="Empieza por dar de alta tus temas"
            texto="Pega la lista del programa oficial (una línea por tema) y en un minuto tendrás el mural completo. A partir de ahí ya puedes cronometrar, cantar y medir."
            accion={
              <Link href="/programa">
                <Boton variante="primario" tam="lg">
                  Añadir mis temas
                  <ArrowRight className="size-4" />
                </Boton>
              </Link>
            }
          />
        </Card>

        <div className="grid sm:grid-cols-3 gap-4 mt-5">
          {[
            {
              t: "1. Monta el programa",
              d: "Materias y temas. Importación masiva pegando el texto del BOE o de tu preparador.",
            },
            {
              t: "2. Estudia y canta",
              d: "Cronos con horas efectivas y modo cante con tiempo por epígrafe y marcado de fallos en vivo.",
            },
            {
              t: "3. Deja que analice",
              d: "La IA compara tus cantes, te dice dónde hincar el codo y responde en el chat con tus datos.",
            },
          ].map((x) => (
            <Card key={x.t} className="p-5">
              <p className="text-[13px] font-semibold">{x.t}</p>
              <p className="text-[12.5px] text-muted mt-2 leading-relaxed">{x.d}</p>
            </Card>
          ))}
        </div>
      </>
    );
  }

  /* ------------------------------ Con datos ------------------------------ */

  const objetivoSemanaSeg = perfil.objetivoHorasSemana * 3600;
  const pctSemana = (resumen.segundosSemana / Math.max(1, objetivoSemanaSeg)) * 100;

  return (
    <>
      <Cabecera
        titulo={perfil.nombre ? `Buenas, ${perfil.nombre}` : "Panel"}
        descripcion={`${plural(resumen.totalTemas, "tema")} de alta · ${horas(resumen.segundosTotales)} h acumuladas desde ${fecha(perfil.fechaInicio)}`}
        acciones={
          !crono && (
            <>
              <Boton onClick={() => iniciarCrono("estudio")}>
                <Play className="size-4" />
                Empezar a estudiar
              </Boton>
              <Link href="/cante">
                <Boton variante="primario">
                  <Mic className="size-4" />
                  Cantar
                </Boton>
              </Link>
            </>
          )
        }
      />

      {/* ------------------------------ Métricas ----------------------------- */}
      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr_1fr]">
        <Card className="flex items-center gap-6">
          <Anillo
            valor={resumen.avance}
            centro={`${Math.round(resumen.avance)}%`}
            sub="programa"
            color="var(--lacre-bright)"
          />
          <div className="min-w-0 flex-1 space-y-2.5">
            {ESTADOS.map((e) => {
              const n = resumen.porEstado[e.id];
              if (!n) return null;
              return (
                <div key={e.id} className="flex items-center gap-2.5 text-[12.5px]">
                  <Punto color={e.color} />
                  <span className="text-muted flex-1 truncate">{e.label}</span>
                  <span className="numeric font-medium">{n}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <Metrica
            valor={horas(resumen.segundosSemana)}
            sufijo={`/ ${perfil.objetivoHorasSemana} h`}
            etiqueta="Esta semana"
            color={pctSemana >= 100 ? "var(--ok)" : undefined}
          />
          <div className="mt-4">
            <Barra
              valor={pctSemana}
              color={pctSemana >= 100 ? "var(--ok)" : "var(--laton)"}
            />
          </div>
          <div className="mt-5">
            <Barras datos={semana} alto={62} objetivo={objetivoSemanaSeg / 7} />
          </div>
        </Card>

        <div className="grid grid-rows-2 gap-4">
          <Card className="flex items-center justify-between">
            <Metrica
              valor={resumen.racha}
              sufijo="días"
              etiqueta="Racha"
              color={resumen.racha >= 7 ? "var(--laton)" : undefined}
            />
            <Flame
              className="size-8"
              style={{
                color: resumen.racha >= 7 ? "var(--laton)" : "var(--fg-subtle)",
                opacity: resumen.racha ? 1 : 0.35,
              }}
            />
          </Card>
          <Card>
            <Metrica
              valor={resumen.notaMedia ?? "—"}
              sufijo={resumen.notaMedia != null ? "/ 10" : undefined}
              etiqueta="Nota media de cante"
              sub={`${plural(resumen.cantesTotales, "cante")} registrado${resumen.cantesTotales === 1 ? "" : "s"}`}
            />
          </Card>
        </div>
      </div>

      {/* ---------------------------- Proyección ---------------------------- */}
      {prediccion.temasPorSemana > 0 && (
        <Card className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <CalendarClock className="size-5 text-[var(--laton)] shrink-0" />
          <div className="flex-1 min-w-[240px]">
            <p className="text-[13.5px]">
              A tu ritmo actual de{" "}
              <span className="numeric font-semibold">{prediccion.temasPorSemana}</span>{" "}
              temas dominados por semana, cierras el programa en{" "}
              <span className="numeric font-semibold">{prediccion.semanasRestantes}</span>{" "}
              semanas
              {prediccion.fechaEstimada && (
                <> — hacia el {fecha(prediccion.fechaEstimada)}</>
              )}
              .
            </p>
            {prediccion.vasJusto === true && (
              <p className="text-[12.5px] text-[var(--danger)] mt-1.5">
                Con la fecha de examen que tienes fijada, a este ritmo no llegas.
              </p>
            )}
            {prediccion.vasJusto === false && (
              <p className="text-[12.5px] text-[var(--ok)] mt-1.5">
                Llegas con margen a la fecha de examen que has fijado.
              </p>
            )}
          </div>
          <Link href="/chat" className="shrink-0">
            <Boton variante="secundario" tam="sm">
              <Sparkles className="size-3.5" />
              Pedir plan a la IA
            </Boton>
          </Link>
        </Card>
      )}

      {/* ------------------------------ Actividad --------------------------- */}
      <Card className="mt-4">
        <TituloSeccion
          accion={
            <span className="text-[11px] text-subtle">
              {horas(resumen.segundosTotales)} h en total
            </span>
          }
        >
          Último año
        </TituloSeccion>
        <MapaCalor datos={serie} />
      </Card>

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        {/* ---------------------------- Cola repaso -------------------------- */}
        <Card>
          <TituloSeccion
            accion={
              <Link
                href="/repaso"
                className="text-[11px] text-muted hover:text-fg transition-colors"
              >
                Ver todo
              </Link>
            }
          >
            Urge repasar
          </TituloSeccion>

          {cola.length === 0 ? (
            <p className="text-[13px] text-muted py-6 text-center">
              Nada pasado de fecha. Vas al día con los repasos.
            </p>
          ) : (
            <div className="space-y-1">
              {cola.map((c) => {
                const estado = estadoEfectivo(c.progreso, perfil.diasOxido);
                const meta = ESTADOS.find((e) => e.id === estado)!;
                return (
                  <Link
                    key={c.tema.id}
                    href={`/tema/${c.tema.id}`}
                    className="flex items-center gap-3 px-2.5 py-2.5 -mx-2.5 rounded-lg hover:bg-[var(--surface-2)] transition-colors group"
                  >
                    <Punto color={meta.color} />
                    <span className="text-[13px] truncate flex-1">
                      <span className="text-subtle numeric mr-1.5">
                        T{c.tema.numero}
                      </span>
                      {c.tema.titulo}
                    </span>
                    <span className="text-[11.5px] text-subtle shrink-0 numeric">
                      {c.diasSinTocar}d
                    </span>
                    <ArrowRight className="size-3.5 text-subtle opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        {/* ------------------------- Lagunas / cantes ------------------------ */}
        <Card>
          <TituloSeccion>
            {lagunas.length ? "Aviso: método, no horas" : "Últimos cantes"}
          </TituloSeccion>

          {lagunas.length > 0 ? (
            <div className="space-y-3">
              {lagunas.map((l) => (
                <Link
                  key={l.tema.id}
                  href={`/tema/${l.tema.id}`}
                  className="flex gap-3 p-3 -mx-1 rounded-lg border border-[color-mix(in_srgb,var(--warn)_28%,transparent)] bg-[color-mix(in_srgb,var(--warn)_7%,transparent)] hover:bg-[color-mix(in_srgb,var(--warn)_11%,transparent)] transition-colors"
                >
                  <TriangleAlert className="size-4 text-[var(--warn)] shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium truncate">
                      T{l.tema.numero} · {l.tema.titulo}
                    </p>
                    <p className="text-[12px] text-muted mt-1 leading-relaxed">
                      {horas(l.segundos)} h invertidas y nota media {l.notaMedia}. {l.motivo}.
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : ultimosCantes.length ? (
            <div className="space-y-1">
              {ultimosCantes.map((c) => (
                <Link
                  key={c.id}
                  href={`/tema/${c.temaId}`}
                  className="flex items-center gap-3 px-2.5 py-2.5 -mx-2.5 rounded-lg hover:bg-[var(--surface-2)] transition-colors"
                >
                  <span className="text-[13px] truncate flex-1">
                    {tituloTema(c.temaId)}
                  </span>
                  {c.conPreparador && (
                    <Badge color="var(--lacre-bright)">preparador</Badge>
                  )}
                  <span className="text-[11.5px] text-subtle shrink-0">
                    {haceTexto(c.fecha)}
                  </span>
                  {c.nota != null && (
                    <span
                      className="numeric text-[13px] font-semibold shrink-0 w-7 text-right"
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
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-muted py-6 text-center">
              Aún no has registrado ningún cante.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}

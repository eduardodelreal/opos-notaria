"use client";

import * as React from "react";
import Link from "next/link";
import { BarChart3, TriangleAlert } from "lucide-react";
import { useStore } from "@/lib/store/store";
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
import { Anillo, Linea, MapaCalor, Radar, Barras } from "@/components/graficos";
import {
  detectarLagunas,
  epigrafesProblematicos,
  predecirFinalizacion,
  resumenGlobal,
  serieDiaria,
  statsPorMateria,
} from "@/lib/data/srs";
import { ESTADOS } from "@/lib/data/types";
import { fecha, horas, horasMin, inicioSemana } from "@/lib/utils/time";

export default function Estadisticas() {
  const { temas, materias, progresos, sesiones, cantes, perfil } = useStore();

  const resumen = React.useMemo(
    () => resumenGlobal(temas, progresos, sesiones, cantes, perfil.diasOxido),
    [temas, progresos, sesiones, cantes, perfil.diasOxido],
  );
  const porMateria = React.useMemo(
    () => statsPorMateria(temas, progresos, cantes, perfil.diasOxido),
    [temas, progresos, cantes, perfil.diasOxido],
  );
  const lagunas = React.useMemo(
    () => detectarLagunas(temas, progresos, cantes, 6),
    [temas, progresos, cantes],
  );
  const problematicos = React.useMemo(
    () => epigrafesProblematicos(cantes, 8),
    [cantes],
  );
  const prediccion = React.useMemo(
    () => predecirFinalizacion(temas, progresos, cantes, perfil.fechaExamen),
    [temas, progresos, cantes, perfil.fechaExamen],
  );
  const serie = React.useMemo(() => serieDiaria(sesiones, 364), [sesiones]);

  const semanas = React.useMemo(() => {
    const salida: { etiqueta: string; valor: number }[] = [];
    const base = inicioSemana();
    for (let i = 11; i >= 0; i--) {
      const desde = base - i * 7 * 86_400_000;
      const hasta = desde + 7 * 86_400_000;
      salida.push({
        etiqueta: i === 0 ? "hoy" : `-${i}`,
        valor: sesiones
          .filter((s) => s.inicio >= desde && s.inicio < hasta)
          .reduce((a, s) => a + s.segundos, 0),
      });
    }
    return salida;
  }, [sesiones]);

  const notasEnTiempo = React.useMemo(
    () =>
      cantes
        .filter((c) => c.nota != null)
        .map((c) => ({ ts: c.fecha, valor: c.nota! }))
        .sort((a, b) => a.ts - b.ts),
    [cantes],
  );

  if (!temas.length) {
    return (
      <>
        <Cabecera titulo="Estadísticas" />
        <Card className="p-0">
          <Vacio
            icono={<BarChart3 className="size-5" />}
            titulo="Todavía no hay nada que medir"
            texto="En cuanto des de alta tus temas y empieces a cronometrar, aquí verás el reparto de esfuerzo, tus lagunas y la proyección de fin de programa."
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

  const nombreTema = (id: string) => {
    const t = temas.find((x) => x.id === id);
    return t ? `T${t.numero}` : "?";
  };

  return (
    <>
      <Cabecera
        titulo="Estadísticas"
        descripcion="Lo que los números dicen de tu preparación, incluido lo que no te va a gustar."
      />

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Card>
          <Metrica
            valor={horas(resumen.segundosTotales)}
            sufijo="h"
            etiqueta="Horas totales"
            sub={`desde ${fecha(perfil.fechaInicio)}`}
          />
        </Card>
        <Card>
          <Metrica
            valor={`${Math.round(resumen.avance)}%`}
            etiqueta="Avance del programa"
            sub={`${resumen.porEstado.dominado} temas dominados`}
          />
        </Card>
        <Card>
          <Metrica
            valor={resumen.notaMedia ?? "—"}
            sufijo={resumen.notaMedia != null ? "/10" : undefined}
            etiqueta="Nota media de cante"
            sub={`${resumen.cantesTotales} cantes`}
          />
        </Card>
        <Card>
          <Metrica
            valor={prediccion.temasPorSemana || "—"}
            etiqueta="Temas dominados / semana"
            sub={
              prediccion.semanasRestantes != null
                ? `${prediccion.semanasRestantes} semanas para cerrar`
                : "ritmo insuficiente para proyectar"
            }
            color={prediccion.vasJusto === true ? "var(--danger)" : undefined}
          />
        </Card>
      </div>

      <div className="grid lg:grid-cols-[1fr_1.4fr] gap-4 mb-4">
        <Card className="flex flex-col items-center justify-center">
          <TituloSeccion>Esfuerzo por materia</TituloSeccion>
          <Radar
            ejes={porMateria.map((m) => ({
              etiqueta: materias.find((x) => x.id === m.materiaId)?.abrev ?? "?",
              valor: m.avance,
              color: materias.find((x) => x.id === m.materiaId)?.color,
            }))}
          />
          <p className="text-[12px] text-subtle text-center mt-3 leading-relaxed max-w-xs">
            Un radar deformado es la señal clásica: se sobreestudia lo que gusta y se
            abandona lo que da pereza.
          </p>
        </Card>

        <Card>
          <TituloSeccion>Detalle por materia</TituloSeccion>
          <div className="space-y-4">
            {porMateria
              .sort((a, b) => b.avance - a.avance)
              .map((m) => {
                const materia = materias.find((x) => x.id === m.materiaId);
                return (
                  <div key={m.materiaId}>
                    <div className="flex items-baseline justify-between gap-3 mb-2">
                      <span className="text-[13.5px] flex items-center gap-2">
                        <Punto color={materia?.color ?? "var(--laton)"} />
                        {materia?.nombre ?? m.materiaId}
                      </span>
                      <span className="text-[12px] text-muted numeric">
                        {m.dominados}/{m.temas} · {horas(m.segundos)} h
                        {m.notaMedia != null && ` · nota ${m.notaMedia}`}
                      </span>
                    </div>
                    <Barra
                      valor={m.avance}
                      color={materia?.color ?? "var(--laton)"}
                      alto={7}
                    />
                  </div>
                );
              })}
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Card>
          <TituloSeccion>Horas por semana (últimas 12)</TituloSeccion>
          <Barras
            datos={semanas}
            alto={150}
            objetivo={perfil.objetivoHorasSemana * 3600}
          />
        </Card>

        <Card>
          <TituloSeccion>Evolución de la nota de cante</TituloSeccion>
          <Linea
            puntos={notasEnTiempo}
            min={0}
            max={10}
            formato={(v) => String(Math.round(v))}
          />
        </Card>
      </div>

      <Card className="mb-4">
        <TituloSeccion>Constancia — último año</TituloSeccion>
        <MapaCalor datos={serie} />
        <div className="flex items-center gap-4 mt-4 text-[11.5px] text-subtle">
          <span>Racha actual: {resumen.racha} días</span>
          <span>·</span>
          <span>
            {serie.filter((d) => d.segundos > 0).length} días con actividad en 365
          </span>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <TituloSeccion>Temas donde el problema es el método</TituloSeccion>
          {lagunas.length === 0 ? (
            <p className="text-[13px] text-muted py-6 text-center leading-relaxed">
              Ninguno detectado. Se marcan los temas con horas por encima de tu media
              cuya nota de cante no sube — y hacen falta al menos dos cantes con nota
              para poder decirlo.
            </p>
          ) : (
            <div className="space-y-2.5">
              {lagunas.map((l) => (
                <Link
                  key={l.tema.id}
                  href={`/tema/${l.tema.id}`}
                  className="flex gap-3 p-3.5 rounded-[10px] border transition-colors"
                  style={{
                    borderColor: "color-mix(in srgb, var(--warn) 28%, transparent)",
                    background: "color-mix(in srgb, var(--warn) 6%, transparent)",
                  }}
                >
                  <TriangleAlert className="size-4 text-[var(--warn)] shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium truncate">
                      T{l.tema.numero} · {l.tema.titulo}
                    </p>
                    <p className="text-[12px] text-muted mt-1">
                      {horasMin(l.segundos)} · nota media {l.notaMedia}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <TituloSeccion>Epígrafes que fallas una y otra vez</TituloSeccion>
          {problematicos.length === 0 ? (
            <p className="text-[13px] text-muted py-6 text-center leading-relaxed">
              Sin datos aún. Marca los fallos durante el cante (teclas 1 a 4) y aquí
              saldrán agregados los epígrafes que más se te caen.
            </p>
          ) : (
            <div className="space-y-2.5">
              {problematicos.map((p, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="numeric text-[11px] text-subtle w-6 shrink-0">
                    {nombreTema(p.temaId)}
                  </span>
                  <span className="text-[13px] flex-1 truncate">{p.titulo}</span>
                  <Badge color="var(--danger)">
                    {(p.fallos / p.veces).toFixed(1)} fallos/cante
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

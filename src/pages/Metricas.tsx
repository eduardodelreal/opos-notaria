import { useMemo, useState } from 'react'
import { useApp } from '@/store/AppStore'
import { bloqueDe, mapaBloques, ordenarBloques } from '@/lib/bloques'
import { CALIFICACIONES, dentroDeTiempo, ESTADOS, progresoVacio } from '@/lib/srs'
import { addDays, diffDays, fmtDuracion, fmtFecha, fmtHoras, hoy, startOfWeek } from '@/lib/dates'
import { cn, colorNota, media, pct, suma } from '@/lib/utils'
import { Card, Chip, Info, SectionTitle, Tabs, Vacio } from '@/components/ui'
import { Barras, BarraSegmentos, Heatmap, Linea, Progreso, Ring } from '@/components/charts'
import { LOGROS, nivel } from '@/lib/logros'

type Rango = '7' | '30' | '90' | 'todo'

export function Metricas() {
  const { data } = useApp()
  const { temas, progreso, cantes, sesiones, ajustes, simulacros, diasCumplidos } = data
  const h = hoy()
  const [rango, setRango] = useState<Rango>('30')

  const desde = rango === 'todo' ? '0000-01-01' : addDays(h, -Number(rango) + 1)
  const mapaTemas = useMemo(() => new Map(temas.map((t) => [t.id, t])), [temas])
  const activos = useMemo(() => temas.filter((t) => !t.excluido), [temas])
  const mapaB = useMemo(() => mapaBloques(data.bloques), [data.bloques])

  const cantesR = useMemo(
    () => cantes.filter((c) => c.fecha.slice(0, 10) >= desde),
    [cantes, desde],
  )
  const sesionesR = useMemo(
    () => sesiones.filter((s) => s.fecha.slice(0, 10) >= desde),
    [sesiones, desde],
  )

  /* --------------------------------------------------------------- KPIs -- */

  const kpi = useMemo(() => {
    const minutosCante = suma(cantesR.map((c) => c.duracionSegundos)) / 60
    const minutosEstudio = suma(sesionesR.map((s) => s.minutos))
    const notas = cantesR.map((c) => c.nota)
    const enTiempo = cantesR.filter((c) => dentroDeTiempo(c.duracionSegundos, c.objetivoSegundos)).length
    const dias = rango === 'todo' ? Math.max(1, diffDays(ajustes.fechaInicio, h) + 1) : Number(rango)
    return {
      cantes: cantesR.length,
      cantesDia: cantesR.length / dias,
      minutosCante,
      minutosEstudio,
      horasDia: (minutosEstudio + minutosCante) / 60 / dias,
      notaMedia: notas.length ? media(notas) : null,
      ratioEnTiempo: cantesR.length ? pct(enTiempo, cantesR.length) : null,
      duracionMedia: cantesR.length ? media(cantesR.map((c) => c.duracionSegundos)) : null,
      antePreparador: cantesR.filter((c) => c.antePreparador).length,
      lagunasMedia: cantesR.length ? media(cantesR.map((c) => c.lagunas)) : 0,
    }
  }, [cantesR, sesionesR, rango, ajustes.fechaInicio, h])

  /* ---------------------------------------------------- series temporales */

  const serieNotas = useMemo(() => {
    // Media móvil de 5 cantes: sin ella el gráfico es ruido puro.
    const ord = [...cantesR].reverse()
    const out: { etiqueta: string; valor: number }[] = []
    for (let i = 0; i < ord.length; i++) {
      const v = ord.slice(Math.max(0, i - 4), i + 1).map((c) => c.nota)
      out.push({ etiqueta: fmtFecha(ord[i].fecha.slice(0, 10), { corta: true }), valor: media(v) })
    }
    return out
  }, [cantesR])

  const serieDuracion = useMemo(() => {
    const ord = [...cantesR].reverse()
    const out: { etiqueta: string; valor: number }[] = []
    for (let i = 0; i < ord.length; i++) {
      const v = ord.slice(Math.max(0, i - 4), i + 1).map((c) => c.duracionSegundos / 60)
      out.push({ etiqueta: fmtFecha(ord[i].fecha.slice(0, 10), { corta: true }), valor: media(v) })
    }
    return out
  }, [cantesR])

  const horasPorDia = useMemo(() => {
    const n = rango === 'todo' ? 30 : Math.min(Number(rango), 30)
    return Array.from({ length: n }, (_, i) => {
      const f = addDays(h, -(n - 1 - i))
      const m =
        suma(sesiones.filter((s) => s.fecha.slice(0, 10) === f).map((s) => s.minutos)) +
        suma(cantes.filter((c) => c.fecha.slice(0, 10) === f).map((c) => c.duracionSegundos)) / 60
      return { etiqueta: f.slice(8), valor: Math.round((m / 60) * 10) / 10 }
    })
  }, [rango, sesiones, cantes, h])

  const cantesPorSemana = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => {
      const ini = startOfWeek(addDays(h, -(7 - i) * 7))
      const fin = addDays(ini, 6)
      const n = cantes.filter((c) => {
        const f = c.fecha.slice(0, 10)
        return f >= ini && f <= fin
      }).length
      return { etiqueta: i === 7 ? 'esta' : fmtFecha(ini, { corta: true }).split(' ')[0], valor: n }
    })
  }, [cantes, h])

  /* ------------------------------------------------------- por bloque --- */

  const porBloque = useMemo(
    () =>
      ordenarBloques(data.bloques).map((b) => {
        const ts = activos.filter((t) => t.bloque === b.id)
        const cs = cantesR.filter((c) => mapaTemas.get(c.temaId)?.bloque === b.id)
        const ps = ts.map((t) => progreso[t.id] ?? progresoVacio(t.id))
        const notas = ps.map((p) => p.notaMedia).filter((n): n is number => n != null)
        const minutos =
          suma(
            sesionesR
              .filter((s) => s.temaId && mapaTemas.get(s.temaId)?.bloque === b.id)
              .map((s) => s.minutos),
          ) + suma(cs.map((c) => c.duracionSegundos)) / 60
        return {
          bloque: b,
          total: ts.length,
          dominados: ps.filter((p) => p.estado === 'dominado').length,
          tocados: ps.filter((p) => p.estado !== 'no_tocado').length,
          vueltasMedia: ts.length ? media(ps.map((p) => p.vueltas)) : 0,
          notaMedia: notas.length ? media(notas) : null,
          cantes: cs.length,
          minutos,
          duracionMedia: cs.length ? media(cs.map((c) => c.duracionSegundos)) : null,
        }
      }),
    [activos, cantesR, sesionesR, mapaTemas, progreso, data.bloques],
  )

  const distribCalif = useMemo(
    () =>
      CALIFICACIONES.map((c) => ({
        etiqueta: c.etiqueta,
        valor: cantesR.filter((x) => x.calificacion === c.valor).length,
        color: c.color,
      })),
    [cantesR],
  )

  /* ------------------------------------------------ preparación estimada */

  const preparacion = useMemo(() => {
    // Índice de preparación: pondera estado + nota + frescura de cada tema.
    let puntos = 0
    for (const t of activos) {
      const p = progreso[t.id] ?? progresoVacio(t.id)
      if (p.estado === 'no_tocado') continue
      const base =
        p.estado === 'dominado' ? 1 : p.estado === 'en_arrastre' ? 0.65 : p.estado === 'oxidado' ? 0.45 : 0.3
      const calidad = p.notaMedia == null ? 0.6 : Math.min(1, p.notaMedia / 8.5)
      puntos += base * (0.55 + calidad * 0.45)
    }
    const indice = activos.length ? puntos / activos.length : 0

    // Ritmo: temas nuevos tocados por semana en los últimos 28 días.
    const hace28 = addDays(h, -28)
    const nuevosRecientes = Object.values(progreso).filter(
      (p) => p.ultimoCante && p.ultimoCante >= hace28 && p.vueltas <= 1,
    ).length
    const sinTocar = activos.filter(
      (t) => (progreso[t.id]?.estado ?? 'no_tocado') === 'no_tocado',
    ).length
    const ritmoSemanal = nuevosRecientes / 4
    const semanasParaCerrar = ritmoSemanal > 0 ? Math.ceil(sinTocar / ritmoSemanal) : null

    return { indice, sinTocar, ritmoSemanal, semanasParaCerrar }
  }, [activos, progreso, h])

  const constancia = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of cantes) {
      const f = c.fecha.slice(0, 10)
      m[f] = (m[f] ?? 0) + 1
    }
    return m
  }, [cantes])

  const nv = nivel(data)
  const logrosGanados = LOGROS.filter((l) => data.logros.includes(l.id))

  if (cantes.length === 0 && sesiones.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="font-serif text-[30px] leading-tight">Métricas</h1>
        <Card>
          <Vacio
            icono="◔"
            titulo="Todavía no hay datos que medir"
            texto="Canta tu primer tema o registra una sesión de estudio y esta pantalla se llenará: nota media, ritmo de vueltas, tiempo por bloque y previsión de examen."
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-[30px] leading-tight">Métricas</h1>
          <p className="mt-1 text-[13.5px] text-ink-500">
            Los números que de verdad predicen si apruebas.
          </p>
        </div>
        <Tabs
          valor={rango}
          onChange={(v) => setRango(v)}
          items={[
            { valor: '7' as const, etiqueta: '7 días' },
            { valor: '30' as const, etiqueta: '30 días' },
            { valor: '90' as const, etiqueta: '90 días' },
            { valor: 'todo' as const, etiqueta: 'Todo' },
          ]}
        />
      </header>

      {/* --------------------------------------------------------- KPIs -- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Dato
          label="Cantes"
          valor={`${kpi.cantes}`}
          sub={`${kpi.cantesDia.toFixed(1)} al día de media`}
        />
        <Dato
          label="Nota media"
          valor={kpi.notaMedia == null ? '—' : kpi.notaMedia.toFixed(1)}
          sub="sobre 10, tiempo incluido"
          color={colorNota(kpi.notaMedia)}
        />
        <Dato
          label="Ratio en tiempo"
          valor={kpi.ratioEnTiempo == null ? '—' : `${kpi.ratioEnTiempo}%`}
          sub={
            kpi.duracionMedia == null
              ? 'sin cantes'
              : `media ${fmtDuracion(kpi.duracionMedia)} / ${fmtDuracion(ajustes.objetivoCanteSegundos)}`
          }
          color={
            kpi.ratioEnTiempo == null
              ? undefined
              : kpi.ratioEnTiempo >= 70
                ? '#3E6349'
                : kpi.ratioEnTiempo >= 40
                  ? '#C6A03A'
                  : '#B45F42'
          }
        />
        <Dato
          label="Tiempo total"
          valor={fmtHoras(kpi.minutosEstudio + kpi.minutosCante)}
          sub={`${kpi.horasDia.toFixed(1)} h/día · ${Math.round(kpi.minutosCante)} min cantando`}
        />
      </div>

      {/* ------------------------------------------------- preparación --- */}
      <Card>
        <div className="grid gap-6 md:grid-cols-[auto_1fr]">
          <div className="flex items-center gap-5">
            <Ring
              valor={preparacion.indice * 100}
              size={132}
              grosor={11}
              color={
                preparacion.indice > 0.7 ? '#3E6349' : preparacion.indice > 0.4 ? '#C6A03A' : '#CC7C60'
              }
            >
              <span className="num text-[27px] font-bold leading-none text-ink-900">
                {Math.round(preparacion.indice * 100)}
              </span>
              <span className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-ink-400">
                preparación
              </span>
            </Ring>
          </div>
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="font-serif text-[21px] leading-tight">Índice de preparación</h2>
              <Info>
                Pondera cada tema por su estado, su nota media y su frescura. No es una nota de
                examen: es cuánto del programa tienes realmente disponible en la boca hoy.
              </Info>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="label">Temas sin tocar</p>
                <p className="num mt-1 text-[21px] font-bold text-ink-900">{preparacion.sinTocar}</p>
              </div>
              <div>
                <p className="label">Ritmo de temas nuevos</p>
                <p className="num mt-1 text-[21px] font-bold text-ink-900">
                  {preparacion.ritmoSemanal.toFixed(1)}
                  <span className="text-[12px] font-medium text-ink-400"> /sem</span>
                </p>
              </div>
              <div>
                <p className="label">Primera vuelta cerrada en</p>
                <p className="num mt-1 text-[21px] font-bold text-ink-900">
                  {preparacion.semanasParaCerrar == null
                    ? '—'
                    : preparacion.semanasParaCerrar > 260
                      ? '>5 años'
                      : `${preparacion.semanasParaCerrar} sem`}
                </p>
              </div>
            </div>
            {ajustes.fechaExamen && (
              <div className="mt-4 rounded-xl bg-canvas px-3.5 py-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-[12.5px] text-ink-500">
                    Faltan{' '}
                    <span className="num font-bold text-ink-900">
                      {Math.max(0, diffDays(h, ajustes.fechaExamen))}
                    </span>{' '}
                    días para la convocatoria
                  </span>
                  {preparacion.semanasParaCerrar != null && (
                    <Chip
                      color={
                        preparacion.semanasParaCerrar * 7 <= diffDays(h, ajustes.fechaExamen)
                          ? '#324F3B'
                          : '#934A32'
                      }
                      bg={
                        preparacion.semanasParaCerrar * 7 <= diffDays(h, ajustes.fechaExamen)
                          ? '#DFE8E1'
                          : '#F6E2D9'
                      }
                    >
                      {preparacion.semanasParaCerrar * 7 <= diffDays(h, ajustes.fechaExamen)
                        ? 'Vas a tiempo'
                        : 'Ritmo insuficiente'}
                    </Chip>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* ---------------------------------------------------- gráficos --- */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle sub="Media móvil de 5 cantes">Evolución de la nota</SectionTitle>
          {serieNotas.length < 2 ? (
            <p className="py-8 text-center text-[12.5px] text-ink-400">
              Necesitas al menos 2 cantes en este rango.
            </p>
          ) : (
            <div className="pb-5">
              <Linea
                datos={serieNotas}
                minY={0}
                maxY={10}
                color="#517C5E"
                formatoValor={(v) => v.toFixed(1)}
              />
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle
            sub={`Objetivo: ${Math.round(ajustes.objetivoCanteSegundos / 60)} min por tema`}
          >
            Duración media del cante
          </SectionTitle>
          {serieDuracion.length < 2 ? (
            <p className="py-8 text-center text-[12.5px] text-ink-400">
              Necesitas al menos 2 cantes en este rango.
            </p>
          ) : (
            <div className="pb-5">
              <Linea
                datos={serieDuracion}
                color="#B45F42"
                formatoValor={(v) => `${v.toFixed(1)} min`}
              />
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle sub="Cante + estudio registrado">Horas por día</SectionTitle>
          <Barras
            datos={horasPorDia}
            alto={140}
            color="#98B7A0"
            objetivo={ajustes.metaHorasDia}
            formatoValor={(v) => `${v} h`}
          />
        </Card>

        <Card>
          <SectionTitle sub="Últimas 8 semanas">Cantes por semana</SectionTitle>
          <Barras
            datos={cantesPorSemana}
            alto={140}
            color="#556296"
            objetivo={ajustes.metaCantesSemana}
            formatoValor={(v) => `${v} cantes`}
          />
        </Card>
      </div>

      {/* ---------------------------------------------------- por bloque - */}
      <Card padding={false}>
        <div className="px-5 py-4">
          <SectionTitle sub="Dónde estás fuerte y dónde te la juegas">
            Rendimiento por bloque
          </SectionTitle>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-y border-ink-100 bg-canvas/50">
                {['Bloque', 'Tocados', 'Dominados', 'Vueltas', 'Nota', 'Duración', 'Tiempo'].map(
                  (h2) => (
                    <th key={h2} className="label px-4 py-2.5 font-semibold">
                      {h2}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {porBloque.map((r) => (
                <tr key={r.bloque.id} className="hover:bg-canvas/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: r.bloque.color }}
                      />
                      <span className="text-[13px] font-semibold text-ink-900">
                        {r.bloque.nombre}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="num text-[12.5px] text-ink-700">
                        {r.tocados}/{r.total}
                      </span>
                      <Progreso
                        valor={r.tocados}
                        max={r.total}
                        alto={4}
                        color={r.bloque.color}
                        className="w-14"
                      />
                    </div>
                  </td>
                  <td className="num px-4 py-3 text-[12.5px] text-ink-700">{r.dominados}</td>
                  <td className="num px-4 py-3 text-[12.5px] text-ink-700">
                    {r.vueltasMedia.toFixed(1)}
                  </td>
                  <td className="px-4 py-3">
                    {r.notaMedia == null ? (
                      <span className="text-[12.5px] text-ink-300">—</span>
                    ) : (
                      <span
                        className="num text-[13px] font-bold"
                        style={{ color: colorNota(r.notaMedia) }}
                      >
                        {r.notaMedia.toFixed(1)}
                      </span>
                    )}
                  </td>
                  <td className="num px-4 py-3 text-[12.5px] text-ink-700">
                    {r.duracionMedia == null ? (
                      <span className="text-ink-300">—</span>
                    ) : (
                      <span
                        className={cn(
                          r.duracionMedia > ajustes.objetivoCanteSegundos * 1.05 && 'text-clay-500',
                        )}
                      >
                        {fmtDuracion(r.duracionMedia)}
                      </span>
                    )}
                  </td>
                  <td className="num px-4 py-3 text-[12.5px] text-ink-700">
                    {fmtHoras(r.minutos)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle sub="Cómo te autocalificas">Distribución de cantes</SectionTitle>
          {suma(distribCalif.map((d) => d.valor)) === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-ink-400">Sin cantes en este rango.</p>
          ) : (
            <>
              <BarraSegmentos datos={distribCalif} altura={14} />
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-ink-100 pt-4">
                <div>
                  <p className="label">Lagunas por cante</p>
                  <p className="num mt-1 text-[19px] font-bold text-ink-900">
                    {kpi.lagunasMedia.toFixed(1)}
                  </p>
                </div>
                <div>
                  <p className="label">Cantes ante preparador</p>
                  <p className="num mt-1 text-[19px] font-bold text-ink-900">
                    {kpi.antePreparador}
                  </p>
                </div>
              </div>
            </>
          )}
        </Card>

        <Card>
          <SectionTitle sub={`Nivel ${nv.nivel} · ${nv.nombre}`}>Hitos</SectionTitle>
          <Progreso valor={nv.progreso} color="#A6832B" alto={5} />
          <div className="mt-4 flex flex-wrap gap-1.5">
            {LOGROS.map((l) => {
              const ganado = data.logros.includes(l.id)
              return (
                <span
                  key={l.id}
                  title={l.desc}
                  className={cn(
                    'chip gap-1.5',
                    ganado ? 'bg-gold-100 text-gold-500' : 'bg-ink-100 text-ink-300',
                  )}
                >
                  <span className="num text-[10px] font-bold">{l.icono}</span>
                  {l.nombre}
                </span>
              )
            })}
          </div>
          <p className="mt-3 text-[11.5px] text-ink-400">
            {logrosGanados.length} de {LOGROS.length} conseguidos · racha máxima registrada:{' '}
            {diasCumplidos.length} días cumplidos en total.
          </p>
        </Card>
      </div>

      {/* -------------------------------------------------- simulacros --- */}
      {simulacros.length > 0 && (
        <Card padding={false}>
          <div className="px-5 py-4">
            <SectionTitle sub="Ejercicios completos sacados del bombo">Simulacros</SectionTitle>
          </div>
          <ul className="divide-y divide-ink-100">
            {simulacros.slice(0, 8).map((s) => (
              <li key={s.id} className="flex items-center gap-3.5 px-5 py-3.5">
                <span
                  className="num flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold text-white"
                  style={{ background: colorNota(s.notaMedia) }}
                >
                  {s.notaMedia.toFixed(1)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-ink-900 first-letter:uppercase">
                    {fmtFecha(s.fecha.slice(0, 10), { conDia: true })}
                  </p>
                  <p className="num text-[11.5px] text-ink-400">
                    {s.temaIds.length} temas · {fmtDuracion(s.duracionTotal)} en total
                  </p>
                </div>
                <div className="hidden gap-1 sm:flex">
                  {s.temaIds.map((id) => {
                    const t = mapaTemas.get(id)
                    if (!t) return null
                    const b = bloqueDe(mapaB, t.bloque)
                    return (
                      <span
                        key={id}
                        title={t.titulo}
                        className="num rounded-lg px-2 py-1 text-[11px] font-bold"
                        style={{ background: b.colorSoft, color: b.colorText }}
                      >
                        {b.nombre.slice(0, 3)} {t.numero}
                      </span>
                    )
                  })}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <SectionTitle sub="Un cuadro por día, más oscuro cuantos más cantes">
          Mapa de cantes
        </SectionTitle>
        <Heatmap datos={constancia} hasta={h} semanas={34} />
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-ink-100 pt-4">
          {(Object.keys(ESTADOS) as (keyof typeof ESTADOS)[]).map((e) => {
            const n = activos.filter((t) => (progreso[t.id]?.estado ?? 'no_tocado') === e).length
            return (
              <div key={e} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: ESTADOS[e].color }}
                />
                <span className="text-[12px] text-ink-500">{ESTADOS[e].etiqueta}</span>
                <span className="num text-[12px] font-bold text-ink-800">{n}</span>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

function Dato({
  label,
  valor,
  sub,
  color,
}: {
  label: string
  valor: string
  sub?: string
  color?: string
}) {
  return (
    <Card className="card-hover">
      <p className="label">{label}</p>
      <p className="num mt-2 text-[26px] font-bold leading-none" style={{ color: color ?? '#1C1B18' }}>
        {valor}
      </p>
      {sub && <p className="mt-1.5 text-[11.5px] leading-snug text-ink-400">{sub}</p>}
    </Card>
  )
}

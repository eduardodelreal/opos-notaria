import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '@/store/AppStore'
import { bloqueDe, mapaBloques, ordenarBloques } from '@/lib/bloques'
import {
  colaDelDia,
  dentroDeTiempo,
  ESTADOS,
  previsionCarga,
  progresoVacio,
  riesgo,
  estaVencido,
} from '@/lib/srs'
import { estaCompletada, estaSaltada, tareasDe } from '@/lib/recurrence'
import { addDays, diffDays, fmtHoras, fmtRelativo, hoy, parseIso, startOfWeek } from '@/lib/dates'
import { cn, colorNota, pct, suma } from '@/lib/utils'
import { Card, Chip, Info, SectionTitle, Vacio } from '@/components/ui'
import { Barras, BarraSegmentos, Heatmap, Progreso, Ring, Sparkline } from '@/components/charts'

export function Dashboard() {
  const { data, alternarOcurrencia } = useApp()
  const nav = useNavigate()
  const h = hoy()
  const { ajustes, temas, progreso, cantes, sesiones, tareas, diasCumplidos } = data

  const activos = useMemo(() => temas.filter((t) => !t.excluido), [temas])
  const mapaB = useMemo(() => mapaBloques(data.bloques), [data.bloques])
  const mapaTemas = useMemo(() => new Map(temas.map((t) => [t.id, t])), [temas])

  /* -------------------------------------------------------------- KPIs -- */

  const kpis = useMemo(() => {
    const cantesHoy = cantes.filter((c) => c.fecha.slice(0, 10) === h)
    const segCanteHoy = suma(cantesHoy.map((c) => c.duracionSegundos))
    const enTiempo = cantesHoy.filter((c) => dentroDeTiempo(c.duracionSegundos, c.objetivoSegundos)).length
    const minutosHoy = suma(sesiones.filter((s) => s.fecha.slice(0, 10) === h).map((s) => s.minutos))
    // "Arrastrados": cantes de hoy sobre temas que ya iban por 2ª vuelta o más.
    const arrastrados = cantesHoy.filter((c) => (progreso[c.temaId]?.vueltas ?? 0) > 1).length

    const iniSemana = startOfWeek(h)
    const cantesSemana = cantes.filter((c) => c.fecha.slice(0, 10) >= iniSemana)
    const minutosSemana = suma(
      sesiones.filter((s) => s.fecha.slice(0, 10) >= iniSemana).map((s) => s.minutos),
    )

    let racha = 0
    const set = new Set(diasCumplidos)
    for (let i = 0; i < 3650; i++) {
      const f = addDays(h, -i)
      if (!set.has(f)) {
        // El día de hoy aún puede cumplirse: no rompe la racha.
        if (i === 0) continue
        break
      }
      racha++
    }

    const vencidos = activos.filter((t) => {
      const p = progreso[t.id]
      return p && (estaVencido(p, h) || p.estado === 'oxidado')
    })

    return {
      cantesHoy: cantesHoy.length,
      segCanteHoy,
      enTiempo,
      ratioEnTiempo: cantesHoy.length ? pct(enTiempo, cantesHoy.length) : null,
      minutosHoy,
      arrastrados,
      cantesSemana: cantesSemana.length,
      minutosSemana,
      racha,
      vencidos,
    }
  }, [cantes, sesiones, progreso, activos, diasCumplidos, h])

  /* --------------------------------------------------------- lo de hoy -- */

  const cola = useMemo(
    () => colaDelDia(temas, progreso, ajustes, h),
    [temas, progreso, ajustes, h],
  )

  const tareasHoy = useMemo(() => tareasDe(tareas, h), [tareas, h])
  const tareasPendientes = tareasHoy.filter((t) => !estaCompletada(t, h) && !estaSaltada(t, h))

  /* ------------------------------------------------------- distribución - */

  const porEstado = useMemo(() => {
    const conteo: Record<string, number> = {}
    for (const t of activos) {
      const e = progreso[t.id]?.estado ?? 'no_tocado'
      conteo[e] = (conteo[e] ?? 0) + 1
    }
    return (['dominado', 'en_arrastre', 'oxidado', 'primera_vuelta', 'no_tocado'] as const).map(
      (e) => ({ etiqueta: ESTADOS[e].etiqueta, valor: conteo[e] ?? 0, color: ESTADOS[e].color }),
    )
  }, [activos, progreso])

  const horasPorBloque = useMemo(() => {
    const ini = startOfWeek(h)
    const conteo = new Map<string, number>()
    for (const s of sesiones) {
      if (s.fecha.slice(0, 10) < ini || !s.temaId) continue
      const b = mapaTemas.get(s.temaId)?.bloque
      if (b) conteo.set(b, (conteo.get(b) ?? 0) + s.minutos)
    }
    for (const c of cantes) {
      if (c.fecha.slice(0, 10) < ini) continue
      const b = mapaTemas.get(c.temaId)?.bloque
      if (b) conteo.set(b, (conteo.get(b) ?? 0) + c.duracionSegundos / 60)
    }
    return ordenarBloques(data.bloques)
      .filter((b) => Math.round(conteo.get(b.id) ?? 0) >= 1)
      .map((b) => ({
        etiqueta: b.nombre,
        valor: Math.round(conteo.get(b.id) ?? 0),
        color: b.color,
      }))
  }, [sesiones, cantes, mapaTemas, data.bloques, h])

  /* ---------------------------------------------------------- previsión - */

  const prevision = useMemo(() => {
    const bruto = previsionCarga(progreso, 42, h)
    // Agrupamos por semana para que el gráfico sea legible.
    const semanas: { etiqueta: string; valor: number }[] = []
    for (let i = 0; i < 6; i++) {
      const trozo = bruto.slice(i * 7, i * 7 + 7)
      semanas.push({
        etiqueta: i === 0 ? 'esta' : `+${i}`,
        valor: suma(trozo.map((t) => t.cantidad)),
      })
    }
    return semanas
  }, [progreso, h])

  const ultimasNotas = useMemo(
    () =>
      [...cantes]
        .slice(0, 12)
        .reverse()
        .map((c) => c.nota),
    [cantes],
  )

  const constancia = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of cantes) {
      const f = c.fecha.slice(0, 10)
      m[f] = (m[f] ?? 0) + 1
    }
    for (const s of sesiones) {
      const f = s.fecha.slice(0, 10)
      m[f] = (m[f] ?? 0) + Math.max(1, Math.round(s.minutos / 90))
    }
    return m
  }, [cantes, sesiones])

  const diasExamen = ajustes.fechaExamen ? diffDays(h, ajustes.fechaExamen) : null
  const esDiaPreparador = ajustes.diaPreparador === parseIso(h).getDay()

  /* Programa vacío: primeros pasos en vez de un panel lleno de ceros. */
  if (activos.length === 0) return <PrimerosPasos nombre={ajustes.nombre} />

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------- cabecera */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">
            {new Intl.DateTimeFormat('es-ES', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            }).format(new Date())}
          </p>
          <h1 className="mt-1 font-serif text-[30px] leading-tight text-ink-900">
            {saludo()}, {(ajustes.nombre || 'opositor').split(' ')[0]}.
          </h1>
          <p className="mt-1 text-[13.5px] text-ink-500">
            {cola.length === 0 && tareasPendientes.length === 0
              ? 'No tienes arrastre pendiente. Buen día para adelantar temario.'
              : `${cola.length} ${cola.length === 1 ? 'tema' : 'temas'} en la cola y ${tareasPendientes.length} ${tareasPendientes.length === 1 ? 'tarea' : 'tareas'} por cerrar.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {esDiaPreparador && (
            <Chip color="#7A5F1C" bg="#F5EACB">
              Hoy toca preparador
            </Chip>
          )}
          {diasExamen != null && diasExamen >= 0 && (
            <Chip color="#934A32" bg="#F6E2D9">
              <span className="num font-bold">{diasExamen}</span> días para la convocatoria
            </Chip>
          )}
          <button onClick={() => nav('/cante')} className="btn-primary">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor" className="h-4 w-4">
              <path d="M8 5.5v13l11-6.5-11-6.5Z" strokeLinejoin="round" />
            </svg>
            Empezar a cantar
          </button>
        </div>
      </header>

      {/* ----------------------------------------------------------- KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCante
          segundos={kpis.segCanteHoy}
          cantes={kpis.cantesHoy}
          metaCantes={ajustes.metaCantesDia}
        />
        <Kpi
          label="Horas de estudio"
          valor={fmtHoras(kpis.minutosHoy)}
          sub={`objetivo ${ajustes.metaHorasDia} h`}
          progreso={{ valor: kpis.minutosHoy, max: ajustes.metaHorasDia * 60 }}
          info="Suma de las sesiones registradas hoy. El cante se cuenta aparte para que no infle las horas de estudio efectivo."
        />
        <Kpi
          label="Ratio en tiempo"
          valor={kpis.ratioEnTiempo == null ? '—' : `${kpis.ratioEnTiempo}%`}
          sub={
            kpis.cantesHoy === 0
              ? 'sin cantes hoy'
              : `${kpis.enTiempo} de ${kpis.cantesHoy} dentro del límite`
          }
          tono={
            kpis.ratioEnTiempo == null
              ? 'neutro'
              : kpis.ratioEnTiempo >= 70
                ? 'ok'
                : kpis.ratioEnTiempo >= 40
                  ? 'aviso'
                  : 'mal'
          }
          info={`Porcentaje de cantes de hoy que han entrado en el tiempo tasado (${Math.round(ajustes.objetivoCanteSegundos / 60)} min + 5% de margen).`}
        />
        <Kpi
          label="Racha"
          valor={`${kpis.racha} ${kpis.racha === 1 ? 'día' : 'días'}`}
          sub={
            diasCumplidos.includes(h)
              ? 'hoy ya cumplido'
              : `cierra el día con ${ajustes.metaCantesDia} cantes`
          }
          tono={kpis.racha >= 7 ? 'ok' : 'neutro'}
          info="Días consecutivos cumpliendo el mínimo: los cantes del día o el 85% de las horas objetivo."
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ------------------------------------------------ cola del día */}
        <div className="space-y-6 lg:col-span-2">
          <Card padding={false}>
            <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
              <div>
                <h2 className="font-serif text-[20px] leading-tight text-ink-900">
                  Lo que toca hoy
                </h2>
                <p className="mt-0.5 text-[12.5px] text-ink-500">
                  Ordenado por riesgo de examen, no por número de tema.
                </p>
              </div>
              <Info>
                El riesgo combina cuánto llevas de retraso sobre la fecha prevista, tu nota media en
                ese tema y las vueltas que le has dado. Cantar primero lo de arriba es lo que más te
                sube la nota esperada.
              </Info>
            </div>

            {cola.length === 0 ? (
              <Vacio
                icono="✓"
                titulo="Arrastre a cero"
                texto="No hay temas vencidos. Puedes adelantar temario nuevo o hacer un simulacro con el bombo."
                accion={
                  <div className="flex gap-2">
                    <Link to="/temario" className="btn-secondary btn-sm">
                      Ver temario
                    </Link>
                    <Link to="/bombo" className="btn-primary btn-sm">
                      Simulacro
                    </Link>
                  </div>
                }
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {cola.map((item) => {
                  const tema = mapaTemas.get(item.temaId)
                  if (!tema) return null
                  const p = progreso[item.temaId] ?? progresoVacio(item.temaId)
                  const bloque = bloqueDe(mapaB, tema.bloque)
                  const r = item.motivo === 'nuevo' ? 100 : riesgo(p, h)
                  return (
                    <li key={item.temaId} className="group flex items-center gap-3.5 px-5 py-3.5">
                      <div
                        className="num flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[12px] font-bold"
                        style={{ background: bloque.colorSoft, color: bloque.colorText }}
                      >
                        {tema.numero}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-[10.5px] font-bold uppercase tracking-wide"
                            style={{ color: bloque.color }}
                          >
                            {bloque.nombre}
                          </span>
                          {item.motivo === 'nuevo' && (
                            <Chip color="#8E8A82" bg="#EFECE5">
                              tema nuevo
                            </Chip>
                          )}
                          {item.motivo === 'oxidado' && (
                            <Chip color={ESTADOS.oxidado.color} bg={ESTADOS.oxidado.bg}>
                              oxidado
                            </Chip>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[13.5px] font-medium text-ink-900">
                          {tema.titulo}
                        </p>
                        <p className="mt-0.5 text-[11.5px] text-ink-400">
                          {p.vueltas > 0
                            ? `${p.vueltas} ${p.vueltas === 1 ? 'vuelta' : 'vueltas'} · previsto ${fmtRelativo(p.proximaRevision ?? h, h)}`
                            : 'sin cantar nunca'}
                          {p.notaMedia != null && (
                            <>
                              {' · media '}
                              <span className="num font-semibold" style={{ color: colorNota(p.notaMedia) }}>
                                {p.notaMedia.toFixed(1)}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                      <div className="hidden w-16 shrink-0 sm:block">
                        <p className="num mb-1 text-right text-[11px] font-bold text-ink-400">
                          {r}
                        </p>
                        <Progreso
                          valor={r}
                          alto={4}
                          color={r > 70 ? '#B45F42' : r > 45 ? '#C6A03A' : '#6F9A7B'}
                        />
                      </div>
                      <button
                        onClick={() => nav(`/cante?tema=${item.temaId}`)}
                        className="btn-secondary btn-sm shrink-0 group-hover:border-sage-300 group-hover:text-sage-700"
                      >
                        Cantar
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          {/* ---------------------------------------------------- tareas */}
          <Card padding={false}>
            <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
              <h2 className="font-serif text-[20px] leading-tight">Tareas de hoy</h2>
              <Link to="/calendario" className="btn-ghost btn-sm">
                Calendario →
              </Link>
            </div>
            {tareasHoy.length === 0 ? (
              <Vacio
                icono="○"
                titulo="Sin tareas para hoy"
                texto="Crea tareas repetitivas (cante diario, dictamen semanal, día de preparador) desde el calendario."
                accion={
                  <Link to="/calendario" className="btn-primary btn-sm">
                    Crear tarea
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {tareasHoy.map((t) => {
                  const hecha = estaCompletada(t, h)
                  const saltada = estaSaltada(t, h)
                  return (
                    <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                      <button
                        onClick={() => void alternarOcurrencia(t.id, h)}
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-all',
                          hecha
                            ? 'border-sage-600 bg-sage-600 text-white'
                            : 'border-ink-200 hover:border-sage-400',
                        )}
                        aria-label={hecha ? 'Desmarcar' : 'Marcar como hecha'}
                      >
                        {hecha && (
                          <svg viewBox="0 0 24 24" fill="none" strokeWidth="3.5" stroke="currentColor" className="h-3 w-3">
                            <path d="m5 12.5 4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            'truncate text-[13.5px] font-medium',
                            hecha || saltada ? 'text-ink-300 line-through' : 'text-ink-900',
                          )}
                        >
                          {t.titulo}
                        </p>
                        <p className="text-[11.5px] text-ink-400">
                          {t.hora && <span className="num">{t.hora} · </span>}
                          {CAT_LABEL[t.categoria]}
                          {t.duracionEstim ? ` · ${t.duracionEstim} min` : ''}
                        </p>
                      </div>
                      {t.temaId && (
                        <button
                          onClick={() => nav(`/cante?tema=${t.temaId}`)}
                          className="btn-ghost btn-sm shrink-0"
                        >
                          Cantar
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>

        {/* ------------------------------------------------------ columna 2 */}
        <div className="space-y-6">
          <Card>
            <SectionTitle sub="De los temas en programa">Estado del programa</SectionTitle>
            <div className="mb-5 flex items-center gap-5">
              <Ring
                valor={porEstado[0].valor}
                max={activos.length}
                size={104}
                grosor={9}
                color="#3E6349"
              >
                <span className="num text-[21px] font-bold leading-none text-ink-900">
                  {pct(porEstado[0].valor, activos.length)}%
                </span>
                <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                  dominado
                </span>
              </Ring>
              <div className="min-w-0 flex-1 space-y-1.5">
                {porEstado.map((e) => (
                  <div key={e.etiqueta} className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: e.color }} />
                    <span className="flex-1 truncate text-[12px] text-ink-500">{e.etiqueta}</span>
                    <span className="num text-[12px] font-bold text-ink-700">{e.valor}</span>
                  </div>
                ))}
              </div>
            </div>
            <BarraSegmentos datos={porEstado} leyenda={false} />
            <Link
              to="/temario"
              className="mt-4 block text-center text-[12.5px] font-semibold text-sage-700 hover:underline"
            >
              Ver los {activos.length} temas →
            </Link>
          </Card>

          <Card>
            <SectionTitle sub="Repasos que caen por semana">Previsión de carga</SectionTitle>
            <Barras
              datos={prevision}
              alto={110}
              color="#98B7A0"
              objetivo={ajustes.metaCantesSemana}
              formatoValor={(v) => `${v} repasos`}
            />
            <p className="mt-3 text-[11.5px] leading-snug text-ink-400">
              Si una barra se dispara, adelanta repasos ahora. Un muro de 60 temas la semana antes
              del examen no se arregla estudiando más.
            </p>
          </Card>

          <Card>
            <SectionTitle
              sub={`${kpis.cantesSemana} cantes · ${fmtHoras(kpis.minutosSemana)} esta semana`}
            >
              Carga por bloque
            </SectionTitle>
            {horasPorBloque.length === 0 ? (
              <p className="py-4 text-center text-[12.5px] text-ink-400">
                Aún no hay tiempo registrado esta semana.
              </p>
            ) : (
              <BarraSegmentos datos={horasPorBloque} altura={14} />
            )}
          </Card>

          {ultimasNotas.length >= 2 && (
            <Card>
              <div className="mb-2 flex items-end justify-between">
                <div>
                  <p className="label">Últimos cantes</p>
                  <p className="num mt-1 text-[24px] font-bold leading-none text-ink-900">
                    {(suma(ultimasNotas) / ultimasNotas.length).toFixed(1)}
                    <span className="text-[13px] font-medium text-ink-400">/10</span>
                  </p>
                </div>
                <span className="text-[11.5px] text-ink-400">{ultimasNotas.length} cantes</span>
              </div>
              <Sparkline valores={ultimasNotas} alto={38} />
            </Card>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------- constancia */}
      <Card>
        <SectionTitle sub="Cada cuadro es un día. Más oscuro, más trabajo registrado.">
          Constancia
        </SectionTitle>
        <Heatmap datos={constancia} hasta={h} semanas={26} />
      </Card>
    </div>
  )
}

const CAT_LABEL: Record<string, string> = {
  cante: 'Cante',
  estudio: 'Estudio',
  dictamen: 'Dictamen',
  repaso: 'Repaso',
  preparador: 'Preparador',
  personal: 'Personal',
}

function saludo(): string {
  const hora = new Date().getHours()
  if (hora < 6) return 'De madrugada'
  if (hora < 13) return 'Buenos días'
  if (hora < 20) return 'Buenas tardes'
  return 'Buenas noches'
}

function Kpi({
  label,
  valor,
  sub,
  progreso,
  tono = 'neutro',
  info,
}: {
  label: string
  valor: string
  sub?: string
  progreso?: { valor: number; max: number }
  tono?: 'ok' | 'aviso' | 'mal' | 'neutro'
  info?: string
}) {
  const color =
    tono === 'ok' ? '#3E6349' : tono === 'aviso' ? '#C6A03A' : tono === 'mal' ? '#B45F42' : '#1C1B18'
  return (
    <Card className="card-hover">
      <div className="flex items-start justify-between">
        <p className="label">{label}</p>
        {info && <Info>{info}</Info>}
      </div>
      <p className="num mt-2 text-[26px] font-bold leading-none" style={{ color }}>
        {valor}
      </p>
      {sub && <p className="mt-1.5 text-[11.5px] text-ink-400">{sub}</p>}
      {progreso && (
        <Progreso
          valor={progreso.valor}
          max={progreso.max}
          alto={4}
          className="mt-3"
          color={progreso.valor >= progreso.max ? '#3E6349' : '#98B7A0'}
        />
      )}
    </Card>
  )
}

function KpiCante({
  segundos,
  cantes,
  metaCantes,
}: {
  segundos: number
  cantes: number
  metaCantes: number
}) {
  const min = Math.floor(segundos / 60)
  return (
    <Card className="card-hover relative overflow-hidden">
      <div className="flex items-start justify-between">
        <p className="label">Cante neto hoy</p>
        <Info>
          Minutos reales con el cronómetro en marcha. Es el único tiempo que se parece al examen:
          leer y hacer esquemas no entrena la boca.
        </Info>
      </div>
      <p className="num mt-2 text-[26px] font-bold leading-none text-sage-800">
        {min}
        <span className="text-[13px] font-medium text-ink-400"> min</span>
      </p>
      <p className="mt-1.5 text-[11.5px] text-ink-400">
        {cantes} de {metaCantes} cantes del día
      </p>
      <div className="mt-3 flex gap-1">
        {Array.from({ length: Math.max(metaCantes, cantes) }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              i < cantes ? 'bg-sage-600' : 'bg-ink-100',
            )}
          />
        ))}
      </div>
    </Card>
  )
}

/* ==================================================================== */

function PrimerosPasos({ nombre }: { nombre: string }) {
  const pasos = [
    {
      n: 1,
      titulo: 'Añade tus primeros temas',
      texto:
        'Los que te hayan dado esta semana en la academia. No hacen falta los 328: con tres ya puedes empezar a medir.',
      cta: 'Ir al temario',
      to: '/temario',
      principal: true,
    },
    {
      n: 2,
      titulo: 'Canta uno con el cronómetro',
      texto:
        'Se graba solo. Al terminar te pones nota de contenido y la app calcula la nota final con el tiempo.',
      cta: 'Cantar',
      to: '/cante',
    },
    {
      n: 3,
      titulo: 'Monta tu semana',
      texto:
        'Cante diario, día de preparador, dictamen del sábado. Tareas que se repiten sin que las vuelvas a escribir.',
      cta: 'Abrir calendario',
      to: '/calendario',
    },
  ]

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-4">
      <header>
        <p className="label">
          {new Intl.DateTimeFormat('es-ES', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          }).format(new Date())}
        </p>
        <h1 className="mt-1 font-serif text-[30px] leading-tight text-ink-900">
          {saludo()}
          {nombre ? `, ${nombre.split(' ')[0]}` : ''}.
        </h1>
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink-500">
          Aquí no hay nada todavía, y es lo normal: este panel se llena con lo que tú vayas
          metiendo. Tres pasos y empieza a tener sentido.
        </p>
      </header>

      <div className="space-y-3">
        {pasos.map((p) => (
          <Card key={p.n} className={cn('flex items-start gap-4', p.principal && 'border-sage-200')}>
            <span
              className={cn(
                'num flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold',
                p.principal ? 'bg-sage-600 text-white' : 'bg-ink-100 text-ink-400',
              )}
            >
              {p.n}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-semibold text-ink-900">{p.titulo}</p>
              <p className="mt-1 text-[12.5px] leading-snug text-ink-500">{p.texto}</p>
            </div>
            <Link
              to={p.to}
              className={cn('shrink-0', p.principal ? 'btn-primary btn-sm' : 'btn-secondary btn-sm')}
            >
              {p.cta}
            </Link>
          </Card>
        ))}
      </div>

      <Card className="bg-canvas/60">
        <p className="label mb-2">Qué verás aquí en cuanto haya datos</p>
        <ul className="grid gap-2 text-[12.5px] leading-snug text-ink-500 sm:grid-cols-2">
          <li className="flex gap-2">
            <span className="text-sage-500">·</span>
            Los temas que toca cantar hoy, ordenados por riesgo de examen
          </li>
          <li className="flex gap-2">
            <span className="text-sage-500">·</span>
            Minutos reales de cante frente a tu objetivo diario
          </li>
          <li className="flex gap-2">
            <span className="text-sage-500">·</span>
            Cuántos cantes entran en el tiempo tasado
          </li>
          <li className="flex gap-2">
            <span className="text-sage-500">·</span>
            La previsión de repasos de las próximas seis semanas
          </li>
        </ul>
      </Card>
    </div>
  )
}

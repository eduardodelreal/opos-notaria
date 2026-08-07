import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '@/store/AppStore'
import { BLOQUES, BLOQUE_MAP } from '@/data/programa'
import {
  cargaPlanificada,
  describirRecurrencia,
  estaCompletada,
  estaSaltada,
  proximasOcurrencias,
  tareasDe,
} from '@/lib/recurrence'
import { colaDelDia } from '@/lib/srs'
import {
  DIAS_CORTOS,
  MESES,
  addDays,
  fmtFecha,
  fmtHoras,
  hoy,
  iso,
  monthMatrix,
  parseIso,
  startOfMonth,
} from '@/lib/dates'
import { cn, uid } from '@/lib/utils'
import { Campo, Card, Chip, Modal, Select, Tabs, useConfirmar, Vacio } from '@/components/ui'
import type { BlockId, Recurrencia, Tarea } from '@/lib/types'

const CATEGORIAS: { valor: Tarea['categoria']; etiqueta: string; color: string; bg: string }[] = [
  { valor: 'cante', etiqueta: 'Cante', color: '#324F3B', bg: '#DFE8E1' },
  { valor: 'estudio', etiqueta: 'Estudio', color: '#434D77', bg: '#DFE3F1' },
  { valor: 'dictamen', etiqueta: 'Dictamen', color: '#934A32', bg: '#F6E2D9' },
  { valor: 'repaso', etiqueta: 'Repaso', color: '#7A5F1C', bg: '#F5EACB' },
  { valor: 'preparador', etiqueta: 'Preparador', color: '#544766', bg: '#E9E3F0' },
  { valor: 'personal', etiqueta: 'Personal', color: '#6B6862', bg: '#EFECE5' },
]
const CAT_MAP = Object.fromEntries(CATEGORIAS.map((c) => [c.valor, c])) as Record<
  Tarea['categoria'],
  (typeof CATEGORIAS)[number]
>

export function Calendario() {
  const { data, guardarTarea, borrarTarea, alternarOcurrencia, saltarOcurrencia, botonDePanico, mostrarAviso } =
    useApp()
  const nav = useNavigate()
  const h = hoy()

  const [mes, setMes] = useState(() => startOfMonth(h))
  const [seleccion, setSeleccion] = useState(h)
  const [vista, setVista] = useState<'mes' | 'semana' | 'agenda'>('mes')
  const [editor, setEditor] = useState<{ tarea: Tarea | null; fecha: string } | null>(null)
  const confirmar = useConfirmar()

  const d = parseIso(mes)
  const celdas = useMemo(() => monthMatrix(d.getFullYear(), d.getMonth()), [d])

  /* Mapa fecha → tareas, calculado una vez por rango visible. */
  const porDia = useMemo(() => {
    const m = new Map<string, Tarea[]>()
    for (const f of celdas) m.set(f, tareasDe(data.tareas, f))
    return m
  }, [celdas, data.tareas])

  /* Repasos que el SRS coloca en cada día (no son tareas, son consecuencia). */
  const repasosPorDia = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of Object.values(data.progreso)) {
      if (!p.proximaRevision) continue
      m.set(p.proximaRevision, (m.get(p.proximaRevision) ?? 0) + 1)
    }
    return m
  }, [data.progreso])

  const tareasSeleccion = useMemo(() => tareasDe(data.tareas, seleccion), [data.tareas, seleccion])
  const colaSeleccion = useMemo(
    () =>
      seleccion === h ? colaDelDia(data.temas, data.progreso, data.ajustes, h) : [],
    [seleccion, h, data.temas, data.progreso, data.ajustes],
  )
  const mapaTemas = useMemo(() => new Map(data.temas.map((t) => [t.id, t])), [data.temas])

  const cargaDia = cargaPlanificada(data.tareas, seleccion)
  const topeDia = data.ajustes.metaHorasDia * 60

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-[30px] leading-tight">Calendario</h1>
          <p className="mt-1 text-[13.5px] text-ink-500">
            Tareas repetibles, día de preparador y los repasos que coloca el sistema de vueltas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() =>
              confirmar.pedir(
                `Se repartirán las tareas pendientes de ${fmtFecha(seleccion)} entre los próximos días, sin pasar de ${data.ajustes.metaHorasDia} h diarias.`,
                async () => {
                  const n = await botonDePanico(seleccion)
                  mostrarAviso(
                    n === 0
                      ? 'No había tareas sueltas que reprogramar.'
                      : `${n} ${n === 1 ? 'tarea reprogramada' : 'tareas reprogramadas'}.`,
                    n === 0 ? 'info' : 'ok',
                  )
                },
              )
            }
            className="btn-secondary"
            title="Reparte lo pendiente del día entre los siguientes"
          >
            Botón de pánico
          </button>
          <button
            onClick={() => setEditor({ tarea: null, fecha: seleccion })}
            className="btn-primary"
          >
            + Nueva tarea
          </button>
        </div>
      </header>

      <Tabs
        valor={vista}
        onChange={(v) => setVista(v)}
        items={[
          { valor: 'mes' as const, etiqueta: 'Mes' },
          { valor: 'semana' as const, etiqueta: 'Semana' },
          { valor: 'agenda' as const, etiqueta: 'Series' },
        ]}
      />

      {vista === 'agenda' ? (
        <ListaSeries
          tareas={data.tareas}
          onEditar={(t) => setEditor({ tarea: t, fecha: t.fecha })}
          onBorrar={(id) =>
            confirmar.pedir('Se borrará la tarea y todas sus repeticiones.', () => void borrarTarea(id), true)
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          {/* ---------------------------------------------------- rejilla */}
          <Card padding={false}>
            <div className="flex items-center justify-between px-4 py-3.5">
              <button
                onClick={() => setMes(iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)))}
                className="btn-ghost btn-sm"
              >
                ‹
              </button>
              <div className="text-center">
                <p className="font-serif text-[18px] capitalize leading-none text-ink-900">
                  {MESES[d.getMonth()]} {d.getFullYear()}
                </p>
                {mes !== startOfMonth(h) && (
                  <button
                    onClick={() => {
                      setMes(startOfMonth(h))
                      setSeleccion(h)
                    }}
                    className="mt-1 text-[11.5px] font-semibold text-sage-700 hover:underline"
                  >
                    Volver a hoy
                  </button>
                )}
              </div>
              <button
                onClick={() => setMes(iso(new Date(d.getFullYear(), d.getMonth() + 1, 1)))}
                className="btn-ghost btn-sm"
              >
                ›
              </button>
            </div>

            <div className="grid grid-cols-7 border-y border-ink-100 bg-canvas/50">
              {[1, 2, 3, 4, 5, 6, 0].map((i) => (
                <div
                  key={i}
                  className="py-2 text-center text-[10.5px] font-bold uppercase tracking-wider text-ink-400"
                >
                  {DIAS_CORTOS[i]}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {(vista === 'semana'
                ? celdas.filter((f) => {
                    const ini = addDays(seleccion, -((parseIso(seleccion).getDay() + 6) % 7))
                    return f >= ini && f <= addDays(ini, 6)
                  })
                : celdas
              ).map((f) => {
                const fd = parseIso(f)
                const otroMes = fd.getMonth() !== d.getMonth()
                const esHoy = f === h
                const sel = f === seleccion
                const ts = porDia.get(f) ?? tareasDe(data.tareas, f)
                const pend = ts.filter((t) => !estaCompletada(t, f) && !estaSaltada(t, f))
                const repasos = repasosPorDia.get(f) ?? 0
                const esExamen = data.ajustes.fechaExamen === f
                return (
                  <button
                    key={f}
                    onClick={() => setSeleccion(f)}
                    className={cn(
                      'relative min-h-[76px] border-b border-r border-ink-100 p-1.5 text-left transition-colors last:border-r-0 hover:bg-sage-50/40',
                      otroMes && vista === 'mes' && 'bg-canvas/40',
                      sel && 'bg-sage-50 ring-2 ring-inset ring-sage-300',
                      vista === 'semana' && 'min-h-[160px]',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          'num flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold',
                          esHoy
                            ? 'bg-sage-700 text-white'
                            : otroMes
                              ? 'text-ink-300'
                              : 'text-ink-700',
                        )}
                      >
                        {fd.getDate()}
                      </span>
                      {repasos > 0 && (
                        <span
                          className="num text-[10px] font-bold text-gold-500"
                          title={`${repasos} repasos previstos`}
                        >
                          {repasos}↻
                        </span>
                      )}
                    </div>
                    {esExamen && (
                      <span className="mt-1 block rounded bg-clay-100 px-1 py-0.5 text-[9.5px] font-bold uppercase text-clay-600">
                        Examen
                      </span>
                    )}
                    <div className="mt-1 space-y-0.5">
                      {ts.slice(0, vista === 'semana' ? 6 : 3).map((t) => {
                        const cat = CAT_MAP[t.categoria]
                        const hecha = estaCompletada(t, f)
                        return (
                          <div
                            key={t.id}
                            className={cn(
                              'truncate rounded px-1 py-px text-[10px] font-medium leading-tight',
                              hecha && 'line-through opacity-45',
                            )}
                            style={{ background: cat.bg, color: cat.color }}
                          >
                            {t.titulo}
                          </div>
                        )
                      })}
                      {ts.length > (vista === 'semana' ? 6 : 3) && (
                        <div className="px-1 text-[9.5px] font-semibold text-ink-400">
                          +{ts.length - (vista === 'semana' ? 6 : 3)} más
                        </div>
                      )}
                    </div>
                    {pend.length > 0 && (
                      <span className="absolute bottom-1 right-1.5 h-1.5 w-1.5 rounded-full bg-clay-400" />
                    )}
                  </button>
                )
              })}
            </div>
          </Card>

          {/* ------------------------------------------------- panel día */}
          <div className="space-y-4">
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="label">{seleccion === h ? 'Hoy' : 'Día seleccionado'}</p>
                  <p className="mt-0.5 font-serif text-[19px] leading-tight first-letter:uppercase">
                    {fmtFecha(seleccion, { conDia: true })}
                  </p>
                </div>
                <button
                  onClick={() => setEditor({ tarea: null, fecha: seleccion })}
                  className="btn-secondary btn-sm shrink-0"
                >
                  + Tarea
                </button>
              </div>

              <div className="mt-3.5 rounded-xl bg-canvas px-3.5 py-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-[12px] text-ink-500">Carga planificada</span>
                  <span className="num text-[13px] font-bold text-ink-900">
                    {fmtHoras(cargaDia)}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (cargaDia / topeDia) * 100)}%`,
                      background: cargaDia > topeDia ? '#B45F42' : '#98B7A0',
                    }}
                  />
                </div>
                {cargaDia > topeDia && (
                  <p className="mt-1.5 text-[11.5px] font-medium text-clay-600">
                    Te has pasado {fmtHoras(cargaDia - topeDia)} del objetivo diario.
                  </p>
                )}
              </div>
            </Card>

            {/* Repasos del SRS */}
            {colaSeleccion.length > 0 && (
              <Card padding={false}>
                <p className="label border-b border-ink-100 px-4 py-3">
                  Repasos que toca cantar
                </p>
                <ul className="divide-y divide-ink-100">
                  {colaSeleccion.slice(0, 5).map((c) => {
                    const t = mapaTemas.get(c.temaId)
                    if (!t) return null
                    const b = BLOQUE_MAP[t.bloque]
                    return (
                      <li key={c.temaId} className="flex items-center gap-2.5 px-4 py-2.5">
                        <span
                          className="num flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold"
                          style={{ background: b.colorSoft, color: b.colorText }}
                        >
                          {t.numero}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-700">
                          {t.titulo}
                        </span>
                        <button
                          onClick={() => nav(`/cante?tema=${t.id}`)}
                          className="btn-ghost btn-sm shrink-0 text-sage-700"
                        >
                          Cantar
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </Card>
            )}

            {/* Tareas del día */}
            <Card padding={false}>
              <p className="label border-b border-ink-100 px-4 py-3">Tareas</p>
              {tareasSeleccion.length === 0 ? (
                <Vacio
                  icono="○"
                  titulo="Sin tareas"
                  texto="Crea una tarea puntual o una serie repetitiva."
                />
              ) : (
                <ul className="divide-y divide-ink-100">
                  {tareasSeleccion.map((t) => {
                    const cat = CAT_MAP[t.categoria]
                    const hecha = estaCompletada(t, seleccion)
                    const saltada = estaSaltada(t, seleccion)
                    return (
                      <li key={t.id} className="group px-4 py-3">
                        <div className="flex items-start gap-2.5">
                          <button
                            onClick={() => void alternarOcurrencia(t.id, seleccion)}
                            className={cn(
                              'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-all',
                              hecha
                                ? 'border-sage-600 bg-sage-600 text-white'
                                : 'border-ink-200 hover:border-sage-400',
                            )}
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
                                'text-[13.5px] font-medium',
                                hecha || saltada ? 'text-ink-300 line-through' : 'text-ink-900',
                              )}
                            >
                              {t.titulo}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <Chip color={cat.color} bg={cat.bg}>
                                {cat.etiqueta}
                              </Chip>
                              {t.hora && <span className="num text-[11px] text-ink-400">{t.hora}</span>}
                              {t.duracionEstim && (
                                <span className="num text-[11px] text-ink-400">
                                  {t.duracionEstim} min
                                </span>
                              )}
                              {t.recurrencia.tipo !== 'ninguna' && (
                                <span className="text-[11px] text-ink-400">
                                  ↻ {describirRecurrencia(t.recurrencia)}
                                </span>
                              )}
                            </div>
                            {t.notas && (
                              <p className="mt-1.5 text-[12px] leading-snug text-ink-500">{t.notas}</p>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              onClick={() => void saltarOcurrencia(t.id, seleccion)}
                              className="btn-ghost btn-sm px-2"
                              title="Saltar solo este día"
                            >
                              ⤼
                            </button>
                            <button
                              onClick={() => setEditor({ tarea: t, fecha: seleccion })}
                              className="btn-ghost btn-sm px-2"
                              title="Editar"
                            >
                              ✎
                            </button>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {editor && (
        <EditorTarea
          tarea={editor.tarea}
          fechaDefecto={editor.fecha}
          temas={data.temas}
          cerrar={() => setEditor(null)}
          onGuardar={(t) => {
            void guardarTarea(t)
            setEditor(null)
          }}
          onBorrar={(id) => {
            confirmar.pedir(
              'Se borrará la tarea y todas sus repeticiones.',
              () => {
                void borrarTarea(id)
                setEditor(null)
              },
              true,
            )
          }}
        />
      )}
      {confirmar.nodo}
    </div>
  )
}

/* ==================================================================== */

function ListaSeries({
  tareas,
  onEditar,
  onBorrar,
}: {
  tareas: Tarea[]
  onEditar(t: Tarea): void
  onBorrar(id: string): void
}) {
  const h = hoy()
  const series = tareas.filter((t) => t.recurrencia.tipo !== 'ninguna' && !t.archivada)
  const puntuales = tareas.filter((t) => t.recurrencia.tipo === 'ninguna' && !t.archivada)

  const bloque = (titulo: string, lista: Tarea[]) => (
    <Card padding={false}>
      <p className="label border-b border-ink-100 px-5 py-3">{titulo}</p>
      {lista.length === 0 ? (
        <Vacio icono="○" titulo="Nada por aquí" />
      ) : (
        <ul className="divide-y divide-ink-100">
          {lista.map((t) => {
            const cat = CAT_MAP[t.categoria]
            const prox = proximasOcurrencias(t, h, 3)
            return (
              <li key={t.id} className="flex items-start gap-3 px-5 py-3.5">
                <span
                  className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: cat.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-ink-900">{t.titulo}</p>
                  <p className="mt-0.5 text-[11.5px] text-ink-400">
                    {describirRecurrencia(t.recurrencia)}
                    {t.duracionEstim ? ` · ${t.duracionEstim} min` : ''}
                    {t.hasta ? ` · hasta ${fmtFecha(t.hasta)}` : ''}
                  </p>
                  {prox.length > 0 && (
                    <p className="mt-1 text-[11.5px] text-ink-500">
                      Próximas: {prox.map((f) => fmtFecha(f, { corta: true })).join(' · ')}
                    </p>
                  )}
                  <p className="num mt-1 text-[11px] text-sage-600">
                    {t.completadas.length} completadas
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => onEditar(t)} className="btn-ghost btn-sm px-2">
                    ✎
                  </button>
                  <button onClick={() => onBorrar(t.id)} className="btn-ghost btn-sm px-2 text-clay-500">
                    ✕
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {bloque(`Series repetitivas (${series.length})`, series)}
      {bloque(`Tareas puntuales (${puntuales.length})`, puntuales)}
    </div>
  )
}

/* ==================================================================== */

const PLANTILLAS: { titulo: string; cat: Tarea['categoria']; rec: Recurrencia; dur: number }[] = [
  {
    titulo: 'Cante diario de repaso',
    cat: 'cante',
    rec: { tipo: 'dias_laborables' },
    dur: 60,
  },
  {
    titulo: 'Cante ante el preparador',
    cat: 'preparador',
    rec: { tipo: 'semanal', cada: 1, dias: [2] },
    dur: 90,
  },
  {
    titulo: 'Dictamen semanal',
    cat: 'dictamen',
    rec: { tipo: 'semanal', cada: 1, dias: [6] },
    dur: 180,
  },
  {
    titulo: 'Repaso de fiscal',
    cat: 'repaso',
    rec: { tipo: 'semanal', cada: 2, dias: [5] },
    dur: 120,
  },
  {
    titulo: 'Simulacro de ejercicio',
    cat: 'cante',
    rec: { tipo: 'mensual', cada: 1, diaMes: 1 },
    dur: 90,
  },
]

function EditorTarea({
  tarea,
  fechaDefecto,
  temas,
  cerrar,
  onGuardar,
  onBorrar,
}: {
  tarea: Tarea | null
  fechaDefecto: string
  temas: import('@/lib/types').Tema[]
  cerrar(): void
  onGuardar(t: Tarea): void
  onBorrar(id: string): void
}) {
  const [titulo, setTitulo] = useState(tarea?.titulo ?? '')
  const [fecha, setFecha] = useState(tarea?.fecha ?? fechaDefecto)
  const [hora, setHora] = useState(tarea?.hora ?? '')
  const [duracion, setDuracion] = useState(tarea?.duracionEstim ?? 60)
  const [categoria, setCategoria] = useState<Tarea['categoria']>(tarea?.categoria ?? 'estudio')
  const [tipo, setTipo] = useState<Recurrencia['tipo']>(tarea?.recurrencia.tipo ?? 'ninguna')
  const [cada, setCada] = useState(
    tarea && 'cada' in tarea.recurrencia ? tarea.recurrencia.cada : 1,
  )
  const [dias, setDias] = useState<number[]>(
    tarea && tarea.recurrencia.tipo === 'semanal'
      ? tarea.recurrencia.dias
      : [parseIso(fechaDefecto).getDay()],
  )
  const [diaMes, setDiaMes] = useState(
    tarea && tarea.recurrencia.tipo === 'mensual'
      ? tarea.recurrencia.diaMes
      : parseIso(fechaDefecto).getDate(),
  )
  const [hasta, setHasta] = useState(tarea?.hasta ?? '')
  const [notas, setNotas] = useState(tarea?.notas ?? '')
  const [temaId, setTemaId] = useState(tarea?.temaId ?? '')
  const [bloqueId, setBloqueId] = useState<string>(tarea?.bloqueId ?? '')

  const recurrencia: Recurrencia = useMemo(() => {
    switch (tipo) {
      case 'diaria':
        return { tipo: 'diaria', cada: Math.max(1, cada) }
      case 'semanal':
        return { tipo: 'semanal', cada: Math.max(1, cada), dias }
      case 'mensual':
        return { tipo: 'mensual', cada: Math.max(1, cada), diaMes }
      case 'dias_laborables':
        return { tipo: 'dias_laborables' }
      default:
        return { tipo: 'ninguna' }
    }
  }, [tipo, cada, dias, diaMes])

  const temasFiltrados = useMemo(
    () => temas.filter((t) => !t.excluido && (!bloqueId || t.bloque === bloqueId)).slice(0, 400),
    [temas, bloqueId],
  )

  const previsualizacion = useMemo(() => {
    const t: Tarea = {
      id: 'preview',
      titulo,
      fecha,
      recurrencia,
      hasta: hasta || null,
      categoria,
      completadas: [],
      saltadas: [],
    }
    return proximasOcurrencias(t, fecha, 4)
  }, [titulo, fecha, recurrencia, hasta, categoria])

  const guardar = () => {
    if (!titulo.trim()) return
    onGuardar({
      id: tarea?.id ?? uid('tarea_'),
      titulo: titulo.trim(),
      fecha,
      hora: hora || null,
      duracionEstim: duracion || undefined,
      recurrencia,
      hasta: hasta || null,
      categoria,
      temaId: temaId || null,
      bloqueId: (bloqueId as BlockId) || null,
      notas: notas.trim() || undefined,
      completadas: tarea?.completadas ?? [],
      saltadas: tarea?.saltadas ?? [],
    })
  }

  return (
    <Modal
      abierto
      cerrar={cerrar}
      titulo={tarea ? 'Editar tarea' : 'Nueva tarea'}
      ancho="max-w-xl"
      pie={
        <>
          {tarea && (
            <button
              onClick={() => onBorrar(tarea.id)}
              className="btn-ghost btn-sm mr-auto text-clay-500"
            >
              Borrar
            </button>
          )}
          <button className="btn-secondary btn-sm" onClick={cerrar}>
            Cancelar
          </button>
          <button className="btn-primary btn-sm" onClick={guardar}>
            Guardar
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {!tarea && (
          <div>
            <p className="label mb-2">Plantillas rápidas</p>
            <div className="flex flex-wrap gap-1.5">
              {PLANTILLAS.map((p) => (
                <button
                  key={p.titulo}
                  onClick={() => {
                    setTitulo(p.titulo)
                    setCategoria(p.cat)
                    setTipo(p.rec.tipo)
                    if ('cada' in p.rec) setCada(p.rec.cada)
                    if (p.rec.tipo === 'semanal') setDias(p.rec.dias)
                    if (p.rec.tipo === 'mensual') setDiaMes(p.rec.diaMes)
                    setDuracion(p.dur)
                  }}
                  className="chip bg-ink-100 text-ink-600 hover:bg-sage-100 hover:text-sage-700"
                >
                  {p.titulo}
                </button>
              ))}
            </div>
          </div>
        )}

        <Campo label="Título">
          <input
            className="input"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="p. ej. Cantar 3 temas de Hipotecario"
            autoFocus
          />
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Primera fecha">
            <input
              className="input"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </Campo>
          <Campo label="Hora (opcional)">
            <input
              className="input"
              type="time"
              value={hora}
              onChange={(e) => setHora(e.target.value)}
            />
          </Campo>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Categoría">
            <Select
              value={categoria}
              onChange={(v) => setCategoria(v as Tarea['categoria'])}
              opciones={CATEGORIAS.map((c) => ({ valor: c.valor, etiqueta: c.etiqueta }))}
            />
          </Campo>
          <Campo label="Duración estimada" hint="Alimenta la carga del día.">
            <div className="flex items-center gap-2">
              <input
                className="input num"
                type="number"
                min={0}
                step={15}
                value={duracion}
                onChange={(e) => setDuracion(Number(e.target.value))}
              />
              <span className="text-[12.5px] text-ink-400">min</span>
            </div>
          </Campo>
        </div>

        {/* Recurrencia */}
        <div className="rounded-2xl border border-ink-100 bg-canvas/60 p-4">
          <p className="label mb-2.5">Repetición</p>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['ninguna', 'Una vez'],
                ['diaria', 'Diaria'],
                ['dias_laborables', 'L-V'],
                ['semanal', 'Semanal'],
                ['mensual', 'Mensual'],
              ] as [Recurrencia['tipo'], string][]
            ).map(([v, l]) => (
              <button
                key={v}
                onClick={() => setTipo(v)}
                className={cn(
                  'chip transition-all',
                  tipo === v ? 'bg-sage-600 text-white' : 'bg-surface text-ink-500 hover:bg-ink-100',
                )}
              >
                {l}
              </button>
            ))}
          </div>

          {(tipo === 'diaria' || tipo === 'semanal' || tipo === 'mensual') && (
            <div className="mt-3.5 flex items-center gap-2">
              <span className="text-[12.5px] text-ink-500">Cada</span>
              <input
                className="input num w-16 py-1.5 text-center"
                type="number"
                min={1}
                max={30}
                value={cada}
                onChange={(e) => setCada(Number(e.target.value))}
              />
              <span className="text-[12.5px] text-ink-500">
                {tipo === 'diaria' ? 'días' : tipo === 'semanal' ? 'semanas' : 'meses'}
              </span>
            </div>
          )}

          {tipo === 'semanal' && (
            <div className="mt-3">
              <p className="label mb-1.5">Días de la semana</p>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5, 6, 0].map((dd) => (
                  <button
                    key={dd}
                    onClick={() =>
                      setDias((prev) =>
                        prev.includes(dd) ? prev.filter((x) => x !== dd) : [...prev, dd],
                      )
                    }
                    className={cn(
                      'h-8 w-8 rounded-lg text-[12px] font-bold transition-all',
                      dias.includes(dd)
                        ? 'bg-sage-600 text-white'
                        : 'bg-surface text-ink-400 hover:bg-ink-100',
                    )}
                  >
                    {DIAS_CORTOS[dd]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tipo === 'mensual' && (
            <div className="mt-3">
              <Campo label="Día del mes">
                <input
                  className="input num w-24"
                  type="number"
                  min={1}
                  max={31}
                  value={diaMes}
                  onChange={(e) => setDiaMes(Number(e.target.value))}
                />
              </Campo>
            </div>
          )}

          {tipo !== 'ninguna' && (
            <div className="mt-3">
              <Campo label="Repetir hasta (opcional)">
                <input
                  className="input"
                  type="date"
                  value={hasta}
                  onChange={(e) => setHasta(e.target.value)}
                />
              </Campo>
            </div>
          )}

          {previsualizacion.length > 0 && (
            <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-[11.5px] text-ink-500">
              <span className="font-semibold text-ink-700">
                {describirRecurrencia(recurrencia)}.
              </span>{' '}
              Próximas: {previsualizacion.map((f) => fmtFecha(f, { corta: true })).join(' · ')}
            </p>
          )}
        </div>

        {/* Vínculo con tema */}
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Bloque (opcional)">
            <Select
              value={bloqueId}
              onChange={(v) => {
                setBloqueId(v)
                setTemaId('')
              }}
              opciones={[
                { valor: '', etiqueta: 'Sin bloque' },
                ...BLOQUES.map((b) => ({ valor: b.id, etiqueta: b.nombre })),
              ]}
            />
          </Campo>
          <Campo label="Tema concreto (opcional)" hint="Añade el botón de cantar directo.">
            <Select
              value={temaId}
              onChange={setTemaId}
              opciones={[
                { valor: '', etiqueta: 'Sin tema' },
                ...temasFiltrados.map((t) => ({
                  valor: t.id,
                  etiqueta: `${BLOQUE_MAP[t.bloque].nombre} ${t.numero} · ${t.titulo.slice(0, 40)}`,
                })),
              ]}
            />
          </Campo>
        </div>

        <Campo label="Notas (opcional)">
          <textarea
            className="input min-h-[60px] resize-y"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
          />
        </Campo>
      </div>
    </Modal>
  )
}

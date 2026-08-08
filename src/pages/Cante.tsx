import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '@/store/AppStore'
import { bloqueDe, mapaBloques, ordenarBloques } from '@/lib/bloques'
import {
  CALIFICACIONES,
  ESTADOS,
  evaluarTiempo,
  calcularNota,
  progresoVacio,
  riesgo,
} from '@/lib/srs'
import { fmtDuracion, fmtRelativo, hoy } from '@/lib/dates'
import { cn, colorNota, barajar } from '@/lib/utils'
import { iniciarGrabacion, mimeSoportado, type Grabadora } from '@/lib/audio'
import { Campo, Card, Chip, Modal, Select, Vacio } from '@/components/ui'
import type { Block, Calificacion, Tema } from '@/lib/types'
import { uid } from '@/lib/utils'

type Fase = 'seleccion' | 'cantando' | 'valoracion'

export function Cante() {
  const { data, registrarCante, guardarSimulacro, mostrarAviso } = useApp()
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const { ajustes, temas, progreso } = data

  const [fase, setFase] = useState<Fase>('seleccion')
  const [cola, setCola] = useState<string[]>([])
  const [indice, setIndice] = useState(0)
  const [simulacroId, setSimulacroId] = useState<string | null>(null)
  const [notasSimulacro, setNotasSimulacro] = useState<number[]>([])
  const [duracionesSim, setDuracionesSim] = useState<number[]>([])

  const mapaTemas = useMemo(() => new Map(temas.map((t) => [t.id, t])), [temas])
  const mapaB = useMemo(() => mapaBloques(data.bloques), [data.bloques])
  const temaActual = cola[indice] ? mapaTemas.get(cola[indice]) : undefined

  /**
   * Entradas directas desde otras pantallas:
   *   ?tema=CIVIL_005              → un tema
   *   ?temas=a,b,c&simulacro=1     → tanda o simulacro ya sorteado en el bombo
   */
  useEffect(() => {
    const uno = params.get('tema')
    const varios = params.get('temas')
    const ids = (varios ? varios.split(',') : uno ? [uno] : []).filter((id) => mapaTemas.has(id))
    if (ids.length) {
      setCola(ids)
      setIndice(0)
      setNotasSimulacro([])
      setDuracionesSim([])
      setSimulacroId(params.get('simulacro') === '1' ? uid('sim_') : null)
      setFase('cantando')
      setParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const empezar = useCallback((ids: string[], simulacro = false) => {
    if (!ids.length) return
    setCola(ids)
    setIndice(0)
    setNotasSimulacro([])
    setDuracionesSim([])
    setSimulacroId(simulacro ? uid('sim_') : null)
    setFase('cantando')
  }, [])

  const finalizarTema = useCallback(
    async (segundos: number, audio: Blob | null) => {
      setUltimaDuracion(segundos)
      setUltimoAudio(audio)
      setFase('valoracion')
    },
    [],
  )

  const [ultimaDuracion, setUltimaDuracion] = useState(0)
  const [ultimoAudio, setUltimoAudio] = useState<Blob | null>(null)

  const guardarValoracion = useCallback(
    async (calificacion: Calificacion, lagunas: number, comentarios: string, antePrep: boolean) => {
      if (!temaActual) return
      const res = await registrarCante({
        temaId: temaActual.id,
        duracionSegundos: ultimaDuracion,
        calificacion,
        lagunas,
        antePreparador: antePrep,
        comentarios: comentarios.trim() || undefined,
        audio: ultimoAudio,
        simulacroId: simulacroId ?? undefined,
      })

      const notas = [...notasSimulacro, res.nota]
      const duraciones = [...duracionesSim, ultimaDuracion]
      setNotasSimulacro(notas)
      setDuracionesSim(duraciones)

      const esUltimo = indice >= cola.length - 1
      if (esUltimo) {
        if (simulacroId) {
          await guardarSimulacro({
            id: simulacroId,
            fecha: new Date().toISOString(),
            temaIds: cola,
            duracionTotal: Math.round(duraciones.reduce((a, b) => a + b, 0)),
            notaMedia: Math.round((notas.reduce((a, b) => a + b, 0) / notas.length) * 10) / 10,
            completado: true,
          })
        }
        mostrarAviso(`Cante guardado · nota ${res.nota.toFixed(1)}`, 'ok')
        setFase('seleccion')
        setCola([])
        setSimulacroId(null)
      } else {
        setIndice((i) => i + 1)
        setFase('cantando')
      }
      setUltimoAudio(null)
    },
    [
      temaActual,
      ultimaDuracion,
      ultimoAudio,
      simulacroId,
      registrarCante,
      indice,
      cola,
      notasSimulacro,
      duracionesSim,
      guardarSimulacro,
      mostrarAviso,
    ],
  )

  if (fase === 'cantando' && temaActual) {
    return (
      <Cronometro
        tema={temaActual}
        bloque={bloqueDe(mapaB, temaActual.bloque)}
        objetivo={ajustes.objetivoCanteSegundos}
        grabar={ajustes.grabarAudio}
        avisoSonoro={ajustes.avisoSonoro}
        modoCiegoInicial={ajustes.modoCiegoPorDefecto}
        posicion={{ actual: indice + 1, total: cola.length }}
        esSimulacro={!!simulacroId}
        onTerminar={finalizarTema}
        onAbandonar={() => {
          setFase('seleccion')
          setCola([])
          setSimulacroId(null)
        }}
      />
    )
  }

  if (fase === 'valoracion' && temaActual) {
    return (
      <Valoracion
        tema={temaActual}
        bloque={bloqueDe(mapaB, temaActual.bloque)}
        duracion={ultimaDuracion}
        objetivo={ajustes.objetivoCanteSegundos}
        tieneAudio={!!ultimoAudio}
        esUltimo={indice >= cola.length - 1}
        onGuardar={guardarValoracion}
      />
    )
  }

  return (
    <Selector
      temas={temas}
      bloques={data.bloques}
      progreso={progreso}
      objetivoSegundos={ajustes.objetivoCanteSegundos}
      temasPorEjercicio={ajustes.temasPorEjercicio}
      onEmpezar={empezar}
      onIrABombo={() => nav('/bombo')}
    />
  )
}

/* ==================================================================== */
/*  Selector                                                            */
/* ==================================================================== */

function Selector({
  temas,
  bloques,
  progreso,
  objetivoSegundos,
  temasPorEjercicio,
  onEmpezar,
  onIrABombo,
}: {
  temas: Tema[]
  bloques: Block[]
  progreso: Record<string, ReturnType<typeof progresoVacio>>
  objetivoSegundos: number
  temasPorEjercicio: number
  onEmpezar(ids: string[], simulacro?: boolean): void
  onIrABombo(): void
}) {
  const [modo, setModo] = useState<'tema' | 'bloque' | 'simulacro'>('tema')
  const [bloque, setBloque] = useState<string>('todos')
  const [busca, setBusca] = useState('')
  const h = hoy()

  const activos = useMemo(() => temas.filter((t) => !t.excluido), [temas])
  const mapaB = useMemo(() => mapaBloques(bloques), [bloques])
  const bloquesOrd = useMemo(() => ordenarBloques(bloques), [bloques])

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return activos
      .filter((t) => (bloque === 'todos' ? true : t.bloque === bloque))
      .filter(
        (t) =>
          !q ||
          t.titulo.toLowerCase().includes(q) ||
          `${t.numero}` === q ||
          t.id.toLowerCase().includes(q),
      )
      .map((t) => {
        const p = progreso[t.id] ?? progresoVacio(t.id)
        return { tema: t, p, r: p.estado === 'no_tocado' ? 100 : riesgo(p, h) }
      })
      .sort((a, b) => b.r - a.r)
      .slice(0, 60)
  }, [activos, bloque, busca, progreso, h])

  if (activos.length === 0) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="font-serif text-[30px] leading-tight">Cantar</h1>
        </header>
        <Card>
          <Vacio
            icono="◗"
            titulo="Todavía no hay temas que cantar"
            texto="Añade los temas que te vayan dando en la academia y aparecerán aquí. Con uno solo ya puedes probar el cronómetro y la grabación."
            accion={
              <a href="/temario" className="btn-primary btn-sm">
                Añadir temas
              </a>
            }
          />
        </Card>
      </div>
    )
  }

  const lanzarSimulacro = () => {
    // Bombo rápido: temas ponderados por riesgo, como en el examen real donde
    // puede salir cualquiera. Aquí sesgamos hacia lo flojo para que entrene.
    const candidatos = barajar(activos)
      .map((t) => {
        const p = progreso[t.id] ?? progresoVacio(t.id)
        return { id: t.id, r: p.estado === 'no_tocado' ? 60 : riesgo(p, h) + Math.random() * 40 }
      })
      .sort((a, b) => b.r - a.r)
      .slice(0, temasPorEjercicio)
      .map((x) => x.id)
    onEmpezar(barajar(candidatos), true)
  }

  const lanzarBloque = () => {
    if (bloque === 'todos') return
    const ids = activos
      .filter((t) => t.bloque === bloque)
      .map((t) => {
        const p = progreso[t.id] ?? progresoVacio(t.id)
        return { id: t.id, r: p.estado === 'no_tocado' ? 100 : riesgo(p, h) }
      })
      .sort((a, b) => b.r - a.r)
      .slice(0, temasPorEjercicio)
      .map((x) => x.id)
    onEmpezar(ids)
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-[30px] leading-tight">Cantar</h1>
        <p className="mt-1 text-[13.5px] text-ink-500">
          Cronómetro de {Math.round(objetivoSegundos / 60)} min por tema, grabación automática y
          nota calculada al terminar.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <BotonModo
          activo={modo === 'tema'}
          onClick={() => setModo('tema')}
          titulo="Tema único"
          desc="Elige un tema concreto de la lista"
          icono="◗"
        />
        <BotonModo
          activo={modo === 'bloque'}
          onClick={() => setModo('bloque')}
          titulo="Tanda de bloque"
          desc={`${temasPorEjercicio} temas seguidos de una materia`}
          icono="■"
        />
        <BotonModo
          activo={modo === 'simulacro'}
          onClick={() => setModo('simulacro')}
          titulo="Simulacro"
          desc="Ejercicio completo, temas al azar"
          icono="◉"
        />
      </div>

      {modo === 'simulacro' ? (
        <Card className="text-center">
          <p className="mx-auto max-w-md text-[13.5px] leading-relaxed text-ink-600">
            Se sortean <strong>{temasPorEjercicio} temas</strong> del programa y los cantas
            seguidos, con el cronómetro corriendo entre uno y otro. Es lo más parecido al ejercicio
            real que puedes hacer solo en casa.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button onClick={lanzarSimulacro} className="btn-primary">
              Sortear y empezar
            </button>
            <button onClick={onIrABombo} className="btn-secondary">
              Ver el bombo con animación
            </button>
          </div>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2.5">
            <div className="min-w-[180px] flex-1">
              <input
                className="input"
                placeholder="Buscar tema por título o número…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <Select
              className="w-full sm:w-56"
              value={bloque}
              onChange={setBloque}
              opciones={[
                { valor: 'todos', etiqueta: 'Todas las materias' },
                ...bloquesOrd.map((b) => ({ valor: b.id, etiqueta: b.nombre })),
              ]}
            />
            {modo === 'bloque' && (
              <button
                onClick={lanzarBloque}
                disabled={bloque === 'todos'}
                className="btn-primary shrink-0"
              >
                Empezar tanda
              </button>
            )}
          </div>

          <Card padding={false}>
            {lista.length === 0 ? (
              <Vacio titulo="Ningún tema coincide" texto="Prueba con otro texto o cambia de bloque." />
            ) : (
              <ul className="divide-y divide-ink-100">
                {lista.map(({ tema, p, r }) => {
                  const b = bloqueDe(mapaB, tema.bloque)
                  const est = ESTADOS[p.estado]
                  return (
                    <li key={tema.id}>
                      <button
                        onClick={() => onEmpezar([tema.id])}
                        className="group flex w-full items-center gap-3.5 px-5 py-3.5 text-left transition-colors hover:bg-sage-50/50"
                      >
                        <div
                          className="num flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[12px] font-bold"
                          style={{ background: b.colorSoft, color: b.colorText }}
                        >
                          {tema.numero}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className="text-[10.5px] font-bold uppercase tracking-wide"
                              style={{ color: b.color }}
                            >
                              {b.nombre}
                            </span>
                            <Chip color={est.color} bg={est.bg}>
                              {est.etiqueta}
                            </Chip>
                            {p.vueltas > 0 && (
                              <span className="num text-[11px] text-ink-400">
                                {p.vueltas} {p.vueltas === 1 ? 'vuelta' : 'vueltas'}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-[13.5px] font-medium text-ink-900">
                            {tema.titulo}
                          </p>
                          <p className="mt-0.5 text-[11.5px] text-ink-400">
                            {p.ultimoCante
                              ? `último cante ${fmtRelativo(p.ultimoCante, h)}`
                              : 'nunca cantado'}
                            {p.notaMedia != null && (
                              <>
                                {' · '}
                                <span
                                  className="num font-semibold"
                                  style={{ color: colorNota(p.notaMedia) }}
                                >
                                  {p.notaMedia.toFixed(1)}
                                </span>
                              </>
                            )}
                          </p>
                        </div>
                        <span className="num hidden text-[11px] font-bold text-ink-300 sm:block">
                          {r}
                        </span>
                        <span className="btn-secondary btn-sm shrink-0 group-hover:border-sage-300 group-hover:text-sage-700">
                          Cantar
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function BotonModo({
  activo,
  onClick,
  titulo,
  desc,
  icono,
}: {
  activo: boolean
  onClick(): void
  titulo: string
  desc: string
  icono: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'card card-hover flex items-start gap-3 p-4 text-left transition-all',
        activo && 'border-sage-300 bg-sage-50/60 ring-4 ring-sage-100',
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[15px]',
          activo ? 'bg-sage-600 text-white' : 'bg-ink-100 text-ink-400',
        )}
      >
        {icono}
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-ink-900">{titulo}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-ink-500">{desc}</span>
      </span>
    </button>
  )
}

/* ==================================================================== */
/*  Cronómetro                                                          */
/* ==================================================================== */

function Cronometro({
  tema,
  bloque,
  objetivo,
  grabar,
  avisoSonoro,
  modoCiegoInicial,
  posicion,
  esSimulacro,
  onTerminar,
  onAbandonar,
}: {
  tema: Tema
  bloque: Block
  objetivo: number
  grabar: boolean
  avisoSonoro: boolean
  modoCiegoInicial: boolean
  posicion: { actual: number; total: number }
  esSimulacro: boolean
  onTerminar(segundos: number, audio: Blob | null): void
  onAbandonar(): void
}) {
  const [corriendo, setCorriendo] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const [modoCiego, setModoCiego] = useState(modoCiegoInicial)
  const [grabando, setGrabando] = useState(false)
  const [nivel, setNivel] = useState(0)
  const [errorAudio, setErrorAudio] = useState<string | null>(null)
  const [confirmarSalir, setConfirmarSalir] = useState(false)
  const grabadora = useRef<Grabadora | null>(null)
  const wakeLock = useRef<WakeLockSentinel | null>(null)
  const avisado = useRef<Set<number>>(new Set())


  /* Tick del cronómetro basado en timestamps: inmune a los throttles de pestaña. */
  useEffect(() => {
    if (!corriendo) return
    const t0 = performance.now() - segundos * 1000
    const id = window.setInterval(() => setSegundos((performance.now() - t0) / 1000), 200)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corriendo])

  /* Nivel de micro para el visualizador. */
  useEffect(() => {
    if (!grabando) return
    const id = window.setInterval(() => setNivel(grabadora.current?.nivel() ?? 0), 90)
    return () => window.clearInterval(id)
  }, [grabando])

  /* Avisos sonoros discretos al 80% y al 100% del tiempo. */
  useEffect(() => {
    if (!corriendo || !avisoSonoro) return
    const hitos = [objetivo * 0.8, objetivo]
    hitos.forEach((hito, i) => {
      if (segundos >= hito && !avisado.current.has(i)) {
        avisado.current.add(i)
        pitido(i === 0 ? 660 : 440, i === 0 ? 0.12 : 0.28)
      }
    })
  }, [segundos, corriendo, avisoSonoro, objetivo])

  /* Mantener la pantalla encendida mientras se canta (móvil en la mesa). */
  useEffect(() => {
    if (!corriendo) return
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<WakeLockSentinel> } }
    nav.wakeLock
      ?.request('screen')
      .then((s) => (wakeLock.current = s))
      .catch(() => {})
    return () => {
      void wakeLock.current?.release().catch(() => {})
      wakeLock.current = null
    }
  }, [corriendo])

  const arrancar = useCallback(async () => {
    if (grabar && mimeSoportado()) {
      try {
        grabadora.current = await iniciarGrabacion()
        setGrabando(true)
        setErrorAudio(null)
      } catch (e) {
        setErrorAudio(
          e instanceof Error && e.message.includes('Permission')
            ? 'No has dado permiso al micrófono. El cante se cronometra igual.'
            : 'No se pudo abrir el micrófono. El cante se cronometra igual.',
        )
      }
    }
    setCorriendo(true)
  }, [grabar])

  const parar = useCallback(async () => {
    setCorriendo(false)
    let audio: Blob | null = null
    if (grabadora.current) {
      const res = await grabadora.current.stop()
      audio = res?.blob ?? null
      grabadora.current = null
      setGrabando(false)
    }
    onTerminar(segundos, audio)
  }, [segundos, onTerminar])

  const abandonar = useCallback(() => {
    grabadora.current?.cancel()
    grabadora.current = null
    onAbandonar()
  }, [onAbandonar])

  /* Barra espaciadora: arranca y para. Sin quitar el dedo del teclado. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest('input,textarea')) {
        e.preventDefault()
        if (corriendo) void parar()
        else void arrancar()
      }
      if (e.key === 'b' || e.key === 'B') setModoCiego((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [corriendo, parar, arrancar])

  const ratio = segundos / objetivo
  const zona = ratio < 0.8 ? 'verde' : ratio < 1 ? 'ambar' : 'rojo'
  const fondo =
    zona === 'verde'
      ? 'linear-gradient(170deg,#F4F8F5 0%,#E7F0E9 100%)'
      : zona === 'ambar'
        ? 'linear-gradient(170deg,#FDF8EA 0%,#F8EFD2 100%)'
        : 'linear-gradient(170deg,#FCF1EC 0%,#F6DFD5 100%)'
  const colorZona = zona === 'verde' ? '#324F3B' : zona === 'ambar' ? '#8A6A16' : '#934A32'

  const restante = objetivo - segundos

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col transition-[background] duration-1000"
      style={{ background: fondo }}
    >
      {/* Modo ciego: capa que bloquea toques accidentales. */}
      {modoCiego && (
        <button
          onClick={() => setModoCiego(false)}
          className="absolute inset-0 z-50 flex cursor-default flex-col items-center justify-center bg-ink-900/[0.93] text-center backdrop-blur-sm"
        >
          <p className="label text-ink-400">Modo ciego · pantalla bloqueada</p>
          <p className="num mt-6 text-[76px] font-bold leading-none text-ink-100 sm:text-[110px]">
            {fmtDuracion(segundos)}
          </p>
          <div className="mt-8 h-1.5 w-56 overflow-hidden rounded-full bg-ink-700">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, ratio * 100)}%`,
                background: zona === 'verde' ? '#6F9A7B' : zona === 'ambar' ? '#DCBD63' : '#CC7C60',
              }}
            />
          </div>
          <p className="mt-10 text-[12.5px] text-ink-400">Toca en cualquier parte para desbloquear</p>
        </button>
      )}

      {/* Cabecera */}
      <header className="flex items-start justify-between gap-4 px-5 py-4 sm:px-8">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="text-[10.5px] font-bold uppercase tracking-[0.1em]"
              style={{ color: bloque.color }}
            >
              {bloque.nombre} · tema {tema.numero}
            </span>
            {posicion.total > 1 && (
              <Chip color={colorZona} bg="rgba(255,255,255,0.7)">
                {esSimulacro ? 'Simulacro' : 'Tanda'} {posicion.actual}/{posicion.total}
              </Chip>
            )}
          </div>
          <h1 className="mt-1 max-w-3xl font-serif text-[19px] leading-snug text-ink-900 sm:text-[23px]">
            {tema.titulo}
          </h1>
        </div>
        <button
          onClick={() => (segundos > 20 ? setConfirmarSalir(true) : abandonar())}
          className="btn-ghost btn-sm shrink-0"
        >
          Salir
        </button>
      </header>

      {/* Cronómetro */}
      <div className="flex flex-1 flex-col items-center justify-center px-5">
        <p
          className="num text-[19vw] font-bold leading-[0.95] tracking-tight sm:text-[130px]"
          style={{ color: colorZona }}
        >
          {fmtDuracion(segundos)}
        </p>

        <div className="mt-1 flex items-center gap-2.5">
          <p className="text-[13px] font-semibold" style={{ color: colorZona }}>
            {restante >= 0
              ? `quedan ${fmtDuracion(restante)} de ${Math.round(objetivo / 60)} min`
              : `te has pasado ${fmtDuracion(-restante)}`}
          </p>
          {grabando && (
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-clay-500">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-clay-400" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-clay-500" />
              </span>
              grabando
            </span>
          )}
        </div>

        {/* Barra de tiempo */}
        <div className="mt-7 w-full max-w-xl">
          <div className="relative h-2 overflow-hidden rounded-full bg-white/70">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.min(100, ratio * 100)}%`,
                background:
                  zona === 'verde' ? '#6F9A7B' : zona === 'ambar' ? '#DCBD63' : '#CC7C60',
              }}
            />
            <div className="absolute left-[80%] top-0 h-full w-px bg-ink-300/60" />
          </div>
          <div className="mt-1.5 flex justify-between text-[10.5px] font-medium text-ink-400">
            <span>0</span>
            <span className="num">{Math.round((objetivo * 0.8) / 60)} min</span>
            <span className="num">{Math.round(objetivo / 60)} min</span>
          </div>
        </div>

        {/* Visualizador de voz */}
        {grabando && (
          <div className="mt-8 flex h-10 items-end gap-1">
            {Array.from({ length: 28 }, (_, i) => {
              const centro = Math.abs(i - 13.5) / 13.5
              const alto = Math.max(3, nivel * 40 * (1 - centro * 0.65) * (0.6 + Math.random() * 0.7))
              return (
                <span
                  key={i}
                  className="w-1 rounded-full bg-clay-300/80 transition-all duration-100"
                  style={{ height: alto }}
                />
              )
            })}
          </div>
        )}

        {errorAudio && (
          <p className="mt-6 max-w-sm rounded-xl bg-white/70 px-3.5 py-2.5 text-center text-[12.5px] text-clay-600">
            {errorAudio}
          </p>
        )}
      </div>

      {/* Controles */}
      <footer className="safe-b px-5 pb-8 sm:px-8">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-3">
          {!corriendo && segundos === 0 ? (
            <button onClick={() => void arrancar()} className="btn-primary w-full py-4 text-[15px]">
              Empezar el cante
              <span className="ml-1 rounded bg-sage-800/40 px-1.5 py-0.5 text-[10px] font-bold">
                espacio
              </span>
            </button>
          ) : (
            <button onClick={() => void parar()} className="btn-primary w-full py-4 text-[15px]">
              Terminar y valorar
              <span className="ml-1 rounded bg-sage-800/40 px-1.5 py-0.5 text-[10px] font-bold">
                espacio
              </span>
            </button>
          )}
          <div className="flex gap-2">
            <button onClick={() => setModoCiego(true)} className="btn-ghost btn-sm">
              Modo ciego (B)
            </button>
            {corriendo && (
              <button
                onClick={() => {
                  setCorriendo(false)
                }}
                className="btn-ghost btn-sm"
              >
                Pausar
              </button>
            )}
            {!corriendo && segundos > 0 && (
              <button onClick={() => setCorriendo(true)} className="btn-ghost btn-sm">
                Reanudar
              </button>
            )}
          </div>
        </div>
      </footer>

      <Modal
        abierto={confirmarSalir}
        cerrar={() => setConfirmarSalir(false)}
        titulo="¿Abandonar el cante?"
        ancho="max-w-sm"
        pie={
          <>
            <button className="btn-secondary btn-sm" onClick={() => setConfirmarSalir(false)}>
              Seguir cantando
            </button>
            <button className="btn-danger btn-sm" onClick={abandonar}>
              Abandonar
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-700">
          Llevas <span className="num font-semibold">{fmtDuracion(segundos)}</span>. Si sales ahora
          no se guarda ni el tiempo ni la grabación.
        </p>
      </Modal>
    </div>
  )
}

function pitido(hz: number, dur: number) {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = hz
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + dur + 0.05)
    osc.onended = () => void ctx.close().catch(() => {})
  } catch {
    /* silencio si el navegador no lo permite */
  }
}

/* ==================================================================== */
/*  Valoración                                                          */
/* ==================================================================== */

function Valoracion({
  tema,
  bloque,
  duracion,
  objetivo,
  tieneAudio,
  esUltimo,
  onGuardar,
}: {
  tema: Tema
  bloque: Block
  duracion: number
  objetivo: number
  tieneAudio: boolean
  esUltimo: boolean
  onGuardar(
    calificacion: Calificacion,
    lagunas: number,
    comentarios: string,
    antePrep: boolean,
  ): Promise<void>
}) {
  const [calificacion, setCalificacion] = useState<Calificacion | null>(null)
  const [lagunas, setLagunas] = useState(0)
  const [comentarios, setComentarios] = useState('')
  const [antePrep, setAntePrep] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const tiempo = evaluarTiempo(duracion, objetivo)
  const notaPrevista =
    calificacion == null ? null : calcularNota(calificacion, duracion, objetivo, lagunas)

  return (
    <div className="mx-auto max-w-xl space-y-5 animate-slide-up">
      <header className="text-center">
        <p className="label" style={{ color: bloque.color }}>
          {bloque.nombre} · tema {tema.numero}
        </p>
        <h1 className="mt-1.5 font-serif text-[23px] leading-snug text-ink-900">{tema.titulo}</h1>
      </header>

      {/* Resumen del tiempo */}
      <Card className="text-center">
        <p className="label">Tiempo empleado</p>
        <p className="num mt-1.5 text-[46px] font-bold leading-none text-ink-900">
          {fmtDuracion(duracion)}
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <Chip
            color={tiempo.tono === 'ok' ? '#324F3B' : tiempo.tono === 'aviso' ? '#8A6A16' : '#934A32'}
            bg={tiempo.tono === 'ok' ? '#DFE8E1' : tiempo.tono === 'aviso' ? '#F5EACB' : '#F6E2D9'}
          >
            {tiempo.etiqueta} · {Math.round(tiempo.ratio * 100)}% del objetivo
          </Chip>
          {tieneAudio && (
            <Chip color="#434D77" bg="#DFE3F1">
              audio guardado
            </Chip>
          )}
        </div>
      </Card>

      {/* Autocalificación */}
      <Card>
        <p className="label mb-3">¿Cómo ha salido el contenido?</p>
        <div className="space-y-2">
          {CALIFICACIONES.map((c) => (
            <button
              key={c.valor}
              onClick={() => setCalificacion(c.valor)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all',
                calificacion === c.valor
                  ? 'border-transparent ring-4'
                  : 'border-ink-200 hover:border-ink-300',
              )}
              style={
                calificacion === c.valor
                  ? { background: `${c.color}12`, boxShadow: `0 0 0 4px ${c.color}1F` }
                  : undefined
              }
            >
              <span
                className="num flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold text-white"
                style={{ background: c.color }}
              >
                {c.valor}
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-ink-900">{c.etiqueta}</span>
                <span className="block text-[12px] text-ink-500">{c.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card className="space-y-4">
        <Campo
          label="Veces que te has quedado en blanco"
          hint="Cada laguna resta hasta 1,5 puntos. Sé honesto: el dato solo sirve si es real."
        >
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLagunas((n) => Math.max(0, n - 1))}
              className="btn-secondary btn-sm w-10"
            >
              −
            </button>
            <span className="num w-12 text-center text-[19px] font-bold">{lagunas}</span>
            <button
              onClick={() => setLagunas((n) => Math.min(20, n + 1))}
              className="btn-secondary btn-sm w-10"
            >
              +
            </button>
          </div>
        </Campo>

        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={antePrep}
            onChange={(e) => setAntePrep(e.target.checked)}
            className="h-4 w-4 rounded border-ink-300 accent-sage-600"
          />
          <span className="text-[13.5px] text-ink-700">Cantado ante el preparador</span>
        </label>

        <Campo label="Notas y correcciones" hint="Lo que te ha dicho el preparador o lo que has fallado.">
          <textarea
            className="input min-h-[80px] resize-y"
            value={comentarios}
            onChange={(e) => setComentarios(e.target.value)}
            placeholder="p. ej. me he saltado el epígrafe de la naturaleza jurídica; la STS de 2019 no la tenía…"
          />
        </Campo>
      </Card>

      {notaPrevista != null && (
        <Card className="flex items-center gap-4">
          <div
            className="num flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-[19px] font-bold text-white"
            style={{ background: colorNota(notaPrevista) }}
          >
            {notaPrevista.toFixed(1)}
          </div>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-ink-900">
              Nota de este cante: {notaPrevista.toFixed(1)}/10
            </p>
            <p className="mt-0.5 text-[12px] leading-snug text-ink-500">
              Combina el contenido que has marcado con el tiempo que has tardado. El sistema de
              vueltas usará esta nota para decidir cuándo te vuelve a salir el tema.
            </p>
          </div>
        </Card>
      )}

      <div className="sticky bottom-20 -mx-1 rounded-2xl bg-canvas/80 p-1 backdrop-blur-md lg:bottom-4">
        <button
          disabled={calificacion == null || guardando}
          onClick={async () => {
            if (calificacion == null) return
            setGuardando(true)
            try {
              await onGuardar(calificacion, lagunas, comentarios, antePrep)
            } finally {
              setGuardando(false)
            }
          }}
          className="btn-primary w-full py-4 text-[15px] shadow-lift"
        >
          {guardando
            ? 'Guardando…'
            : esUltimo
              ? 'Guardar cante'
              : 'Guardar y pasar al siguiente tema'}
        </button>
      </div>
    </div>
  )
}

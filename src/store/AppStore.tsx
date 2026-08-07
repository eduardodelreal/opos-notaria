import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, hasSupabase } from '@/lib/supabase'
import { LocalRepo, SupabaseRepo, type Repo } from '@/lib/repo'
import { datosVacios } from '@/lib/defaults'
import { aplicarCante, aplicarOxidacion, calcularNota, progresoVacio } from '@/lib/srs'
import { evaluarLogros } from '@/lib/logros'
import { reprogramarDia } from '@/lib/recurrence'
import { hoy, iso } from '@/lib/dates'
import { uid } from '@/lib/utils'
import type {
  Ajustes,
  AppData,
  Calificacion,
  Cante,
  ProgresoTema,
  SesionEstudio,
  Simulacro,
  Tarea,
  Tema,
} from '@/lib/types'
import { subirAudio, borrarAudio } from '@/lib/audio'

export interface RegistroCante {
  temaId: string
  duracionSegundos: number
  calificacion: Calificacion
  lagunas: number
  antePreparador: boolean
  comentarios?: string
  audio?: Blob | null
  simulacroId?: string
}

interface AppStore {
  /* estado */
  cargando: boolean
  data: AppData
  session: Session | null
  userId: string | null
  modoLocal: boolean
  /** El usuario ha elegido explícitamente trabajar sin cuenta. */
  modoDemo: boolean
  sincronizando: boolean
  aviso: { texto: string; tono: 'ok' | 'error' | 'info' } | null
  logrosNuevos: string[]

  /* auth */
  entrar(email: string, password: string): Promise<{ error?: string }>
  registrar(email: string, password: string, nombre: string): Promise<{ error?: string }>
  salir(): Promise<void>
  recuperar(email: string): Promise<{ error?: string }>
  entrarComoDemo(): void

  /* mutaciones */
  guardarAjustes(parcial: Partial<Ajustes>): Promise<void>
  registrarCante(input: RegistroCante): Promise<{ nota: number; explicacion: string }>
  borrarCante(id: string): Promise<void>
  editarCante(id: string, parcial: Partial<Cante>): Promise<void>
  registrarSesion(s: Omit<SesionEstudio, 'id'>): Promise<void>
  borrarSesion(id: string): Promise<void>
  guardarProgreso(temaId: string, parcial: Partial<ProgresoTema>): Promise<void>
  guardarTarea(t: Tarea): Promise<void>
  borrarTarea(id: string): Promise<void>
  alternarOcurrencia(tareaId: string, fecha: string): Promise<void>
  saltarOcurrencia(tareaId: string, fecha: string): Promise<void>
  guardarTema(t: Tema): Promise<void>
  borrarTema(id: string): Promise<void>
  guardarSimulacro(s: Simulacro): Promise<void>
  botonDePanico(fecha: string): Promise<number>
  marcarDiaCumplido(fecha?: string): Promise<void>
  exportar(): string
  importar(json: string): Promise<{ error?: string }>
  resetear(): Promise<void>
  descartarLogros(): void
  mostrarAviso(texto: string, tono?: 'ok' | 'error' | 'info'): void
}

const Ctx = createContext<AppStore | null>(null)

export function useApp(): AppStore {
  const c = useContext(Ctx)
  if (!c) throw new Error('useApp fuera de AppProvider')
  return c
}

const DEMO_FLAG = 'opos-notaria:demo'

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [authListo, setAuthListo] = useState(!hasSupabase)
  const [demo, setDemo] = useState(() => localStorage.getItem(DEMO_FLAG) === '1')
  const [data, setData] = useState<AppData>(() => datosVacios())
  const [cargando, setCargando] = useState(true)
  const [sincronizando, setSincronizando] = useState(false)
  const [aviso, setAviso] = useState<AppStore['aviso']>(null)
  const [logrosNuevos, setLogrosNuevos] = useState<string[]>([])
  const repoRef = useRef<Repo>(new LocalRepo())

  const userId = session?.user.id ?? null
  const modoLocal = !hasSupabase || (!session && demo)

  const mostrarAviso = useCallback((texto: string, tono: 'ok' | 'error' | 'info' = 'info') => {
    setAviso({ texto, tono })
    window.setTimeout(() => setAviso(null), 4200)
  }, [])

  /* ------------------------------------------------------------- auth --- */

  useEffect(() => {
    if (!supabase) return
    let vivo = true
    supabase.auth.getSession().then(({ data: d }) => {
      if (!vivo) return
      setSession(d.session)
      setAuthListo(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      setAuthListo(true)
    })
    return () => {
      vivo = false
      sub.subscription.unsubscribe()
    }
  }, [])

  /* -------------------------------------------------------- carga datos - */

  useEffect(() => {
    if (!authListo) return
    let vivo = true
    const repo: Repo = session ? new SupabaseRepo(session.user.id) : new LocalRepo()
    repoRef.current = repo
    setCargando(true)
    repo
      .load()
      .then((d) => {
        if (!vivo) return
        // La oxidación se recalcula en cada arranque: refleja el paso del tiempo real.
        const progreso: Record<string, ProgresoTema> = {}
        for (const [k, p] of Object.entries(d.progreso)) {
          progreso[k] = aplicarOxidacion(p, d.ajustes)
        }
        setData({ ...d, progreso })
      })
      .catch((e) => {
        console.error('[store] error al cargar', e)
        if (vivo) {
          mostrarAviso('No se pudieron cargar tus datos del servidor.', 'error')
          setData(datosVacios())
        }
      })
      .finally(() => vivo && setCargando(false))
    return () => {
      vivo = false
    }
  }, [authListo, session, mostrarAviso])

  /* -------------------------------------------------------- helpers ----- */

  /** Aplica el cambio en memoria y lanza la persistencia sin bloquear la UI. */
  const persistir = useCallback(
    async (fn: (r: Repo) => Promise<void>) => {
      setSincronizando(true)
      try {
        await fn(repoRef.current)
      } catch (e) {
        console.error('[store] fallo al guardar', e)
        mostrarAviso('No se pudo guardar el cambio en el servidor.', 'error')
      } finally {
        setSincronizando(false)
      }
    },
    [mostrarAviso],
  )

  const revisarLogros = useCallback(
    (d: AppData) => {
      const nuevos = evaluarLogros(d)
      if (!nuevos.length) return d
      const actualizado = { ...d, logros: [...d.logros, ...nuevos] }
      setLogrosNuevos((prev) => [...prev, ...nuevos])
      void persistir((r) =>
        r.saveMeta({ diasCumplidos: actualizado.diasCumplidos, logros: actualizado.logros }),
      )
      return actualizado
    },
    [persistir],
  )

  /* ------------------------------------------------------- acciones auth  */

  const entrar: AppStore['entrar'] = useCallback(async (email, password) => {
    if (!supabase) return { error: 'Supabase no está configurado en este despliegue.' }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: traducirAuth(error.message) }
    localStorage.removeItem(DEMO_FLAG)
    setDemo(false)
    return {}
  }, [])

  const registrar: AppStore['registrar'] = useCallback(async (email, password, nombre) => {
    if (!supabase) return { error: 'Supabase no está configurado en este despliegue.' }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { nombre } },
    })
    if (error) return { error: traducirAuth(error.message) }
    return {}
  }, [])

  const recuperar: AppStore['recuperar'] = useCallback(async (email) => {
    if (!supabase) return { error: 'Supabase no está configurado en este despliegue.' }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/ajustes`,
    })
    return error ? { error: traducirAuth(error.message) } : {}
  }, [])

  const salir = useCallback(async () => {
    localStorage.removeItem(DEMO_FLAG)
    setDemo(false)
    if (supabase) await supabase.auth.signOut()
    setSession(null)
    setData(datosVacios())
  }, [])

  const entrarComoDemo = useCallback(() => {
    localStorage.setItem(DEMO_FLAG, '1')
    setDemo(true)
  }, [])

  /* ---------------------------------------------------- acciones datos -- */

  const guardarAjustes: AppStore['guardarAjustes'] = useCallback(
    async (parcial) => {
      let siguiente!: Ajustes
      setData((d) => {
        siguiente = { ...d.ajustes, ...parcial }
        return { ...d, ajustes: siguiente }
      })
      await persistir((r) => r.saveAjustes(siguiente))
    },
    [persistir],
  )

  const registrarCante: AppStore['registrarCante'] = useCallback(
    async (input) => {
      const ajustes = data.ajustes
      const objetivo = ajustes.objetivoCanteSegundos
      const nota = calcularNota(
        input.calificacion,
        input.duracionSegundos,
        objetivo,
        input.lagunas,
      )
      const previo = data.progreso[input.temaId] ?? progresoVacio(input.temaId)
      const res = aplicarCante(previo, {
        calificacion: input.calificacion,
        nota,
        ajustes,
      })

      const canteId = uid('cante_')
      let audioPath: string | null = null
      if (input.audio && input.audio.size > 0) {
        try {
          audioPath = await subirAudio(canteId, input.audio, userId)
        } catch (e) {
          console.warn('[store] no se pudo guardar el audio', e)
          mostrarAviso('El cante se guardó, pero el audio no pudo subirse.', 'error')
        }
      }

      const cante: Cante = {
        id: canteId,
        temaId: input.temaId,
        fecha: new Date().toISOString(),
        duracionSegundos: Math.round(input.duracionSegundos),
        objetivoSegundos: objetivo,
        calificacion: input.calificacion,
        nota,
        lagunas: input.lagunas,
        antePreparador: input.antePreparador,
        comentarios: input.comentarios,
        audioPath,
        simulacroId: input.simulacroId,
      }

      setData((d) => {
        const siguiente: AppData = {
          ...d,
          cantes: [cante, ...d.cantes],
          progreso: { ...d.progreso, [input.temaId]: res.progreso },
        }
        return revisarLogros(siguiente)
      })

      await persistir(async (r) => {
        await r.insertCante(cante)
        await r.upsertProgreso(res.progreso)
      })

      return { nota, explicacion: res.explicacion }
    },
    [data.ajustes, data.progreso, userId, persistir, revisarLogros, mostrarAviso],
  )

  const borrarCante: AppStore['borrarCante'] = useCallback(
    async (id) => {
      const cante = data.cantes.find((c) => c.id === id)
      setData((d) => ({ ...d, cantes: d.cantes.filter((c) => c.id !== id) }))
      if (cante?.audioPath) void borrarAudio(cante.audioPath)
      await persistir((r) => r.deleteCante(id))
    },
    [data.cantes, persistir],
  )

  const editarCante: AppStore['editarCante'] = useCallback(
    async (id, parcial) => {
      let actualizado: Cante | undefined
      setData((d) => ({
        ...d,
        cantes: d.cantes.map((c) => {
          if (c.id !== id) return c
          actualizado = { ...c, ...parcial }
          return actualizado
        }),
      }))
      if (actualizado) await persistir((r) => r.updateCante(actualizado!))
    },
    [persistir],
  )

  const registrarSesion: AppStore['registrarSesion'] = useCallback(
    async (s) => {
      const sesion: SesionEstudio = { ...s, id: uid('ses_') }
      let progresoAct: ProgresoTema | null = null
      setData((d) => {
        const progreso = { ...d.progreso }
        if (sesion.temaId) {
          const previo = progreso[sesion.temaId] ?? progresoVacio(sesion.temaId)
          progresoAct = {
            ...previo,
            minutosEstudio: previo.minutosEstudio + sesion.minutos,
            estado: previo.estado === 'no_tocado' ? 'primera_vuelta' : previo.estado,
          }
          progreso[sesion.temaId] = progresoAct
        }
        return revisarLogros({ ...d, sesiones: [sesion, ...d.sesiones], progreso })
      })
      await persistir(async (r) => {
        await r.insertSesion(sesion)
        if (progresoAct) await r.upsertProgreso(progresoAct)
      })
    },
    [persistir, revisarLogros],
  )

  const borrarSesion: AppStore['borrarSesion'] = useCallback(
    async (id) => {
      setData((d) => ({ ...d, sesiones: d.sesiones.filter((s) => s.id !== id) }))
      await persistir((r) => r.deleteSesion(id))
    },
    [persistir],
  )

  const guardarProgreso: AppStore['guardarProgreso'] = useCallback(
    async (temaId, parcial) => {
      let siguiente!: ProgresoTema
      setData((d) => {
        const previo = d.progreso[temaId] ?? progresoVacio(temaId)
        siguiente = { ...previo, ...parcial }
        return { ...d, progreso: { ...d.progreso, [temaId]: siguiente } }
      })
      await persistir((r) => r.upsertProgreso(siguiente))
    },
    [persistir],
  )

  const guardarTarea: AppStore['guardarTarea'] = useCallback(
    async (t) => {
      setData((d) => {
        const i = d.tareas.findIndex((x) => x.id === t.id)
        const tareas = i >= 0 ? d.tareas.map((x) => (x.id === t.id ? t : x)) : [...d.tareas, t]
        return { ...d, tareas }
      })
      await persistir((r) => r.upsertTarea(t))
    },
    [persistir],
  )

  const borrarTarea: AppStore['borrarTarea'] = useCallback(
    async (id) => {
      setData((d) => ({ ...d, tareas: d.tareas.filter((t) => t.id !== id) }))
      await persistir((r) => r.deleteTarea(id))
    },
    [persistir],
  )

  const alternarOcurrencia: AppStore['alternarOcurrencia'] = useCallback(
    async (tareaId, fecha) => {
      let actualizada: Tarea | undefined
      setData((d) => ({
        ...d,
        tareas: d.tareas.map((t) => {
          if (t.id !== tareaId) return t
          const yaEsta = t.completadas.includes(fecha)
          actualizada = {
            ...t,
            completadas: yaEsta
              ? t.completadas.filter((f) => f !== fecha)
              : [...t.completadas, fecha],
            saltadas: t.saltadas.filter((f) => f !== fecha),
          }
          return actualizada
        }),
      }))
      if (actualizada) await persistir((r) => r.upsertTarea(actualizada!))
    },
    [persistir],
  )

  const saltarOcurrencia: AppStore['saltarOcurrencia'] = useCallback(
    async (tareaId, fecha) => {
      let actualizada: Tarea | undefined
      setData((d) => ({
        ...d,
        tareas: d.tareas.map((t) => {
          if (t.id !== tareaId) return t
          const yaEsta = t.saltadas.includes(fecha)
          actualizada = {
            ...t,
            saltadas: yaEsta ? t.saltadas.filter((f) => f !== fecha) : [...t.saltadas, fecha],
            completadas: t.completadas.filter((f) => f !== fecha),
          }
          return actualizada
        }),
      }))
      if (actualizada) await persistir((r) => r.upsertTarea(actualizada!))
    },
    [persistir],
  )

  const guardarTema: AppStore['guardarTema'] = useCallback(
    async (t) => {
      setData((d) => {
        const i = d.temas.findIndex((x) => x.id === t.id)
        const temas = i >= 0 ? d.temas.map((x) => (x.id === t.id ? t : x)) : [...d.temas, t]
        return { ...d, temas }
      })
      await persistir((r) => r.upsertTema(t))
    },
    [persistir],
  )

  const borrarTema: AppStore['borrarTema'] = useCallback(
    async (id) => {
      setData((d) => {
        const progreso = { ...d.progreso }
        delete progreso[id]
        return { ...d, temas: d.temas.filter((t) => t.id !== id), progreso }
      })
      await persistir((r) => r.deleteTema(id))
    },
    [persistir],
  )

  const guardarSimulacro: AppStore['guardarSimulacro'] = useCallback(
    async (s) => {
      setData((d) => revisarLogros({ ...d, simulacros: [s, ...d.simulacros] }))
      await persistir((r) => r.insertSimulacro(s))
    },
    [persistir, revisarLogros],
  )

  const botonDePanico: AppStore['botonDePanico'] = useCallback(
    async (fecha) => {
      const tope = Math.round(data.ajustes.metaHorasDia * 60)
      const { cambios } = reprogramarDia(data.tareas, fecha, { topeMinutosDia: tope })
      if (!cambios.length) return 0
      const mapa = new Map(cambios.map((c) => [c.id, c.nuevaFecha]))
      const actualizadas: Tarea[] = []
      setData((d) => ({
        ...d,
        tareas: d.tareas.map((t) => {
          const nueva = mapa.get(t.id)
          if (!nueva) return t
          const upd = { ...t, fecha: nueva }
          actualizadas.push(upd)
          return upd
        }),
      }))
      await persistir(async (r) => {
        for (const t of actualizadas) await r.upsertTarea(t)
      })
      return cambios.length
    },
    [data.tareas, data.ajustes.metaHorasDia, persistir],
  )

  const marcarDiaCumplido: AppStore['marcarDiaCumplido'] = useCallback(
    async (fecha) => {
      const f = fecha ?? hoy()
      let meta!: { diasCumplidos: string[]; logros: string[] }
      setData((d) => {
        if (d.diasCumplidos.includes(f)) {
          meta = { diasCumplidos: d.diasCumplidos, logros: d.logros }
          return d
        }
        const siguiente = { ...d, diasCumplidos: [...d.diasCumplidos, f].sort() }
        meta = { diasCumplidos: siguiente.diasCumplidos, logros: siguiente.logros }
        return revisarLogros(siguiente)
      })
      await persistir((r) => r.saveMeta(meta))
    },
    [persistir, revisarLogros],
  )

  const exportar = useCallback(() => JSON.stringify(data, null, 2), [data])

  const importar: AppStore['importar'] = useCallback(
    async (json) => {
      try {
        const parsed = JSON.parse(json) as AppData
        if (!parsed || typeof parsed !== 'object' || !parsed.ajustes) {
          return { error: 'El archivo no tiene el formato esperado.' }
        }
        const limpio: AppData = { ...datosVacios(), ...parsed }
        setData(limpio)
        await persistir((r) => r.replaceAll(limpio))
        return {}
      } catch {
        return { error: 'No se pudo leer el JSON.' }
      }
    },
    [persistir],
  )

  const resetear = useCallback(async () => {
    const vacio = datosVacios()
    setData(vacio)
    await persistir((r) => r.replaceAll(vacio))
  }, [persistir])

  const descartarLogros = useCallback(() => setLogrosNuevos([]), [])

  /* Auto-marca el día como cumplido cuando se alcanzan los objetivos mínimos. */
  useEffect(() => {
    if (cargando) return
    const h = hoy()
    if (data.diasCumplidos.includes(h)) return
    const cantesHoy = data.cantes.filter((c) => c.fecha.slice(0, 10) === h).length
    const minutosHoy = data.sesiones
      .filter((s) => s.fecha.slice(0, 10) === h)
      .reduce((a, s) => a + s.minutos, 0)
    const cumple =
      cantesHoy >= data.ajustes.metaCantesDia ||
      minutosHoy >= data.ajustes.metaHorasDia * 60 * 0.85
    if (cumple) void marcarDiaCumplido(h)
  }, [
    cargando,
    data.cantes,
    data.sesiones,
    data.diasCumplidos,
    data.ajustes.metaCantesDia,
    data.ajustes.metaHorasDia,
    marcarDiaCumplido,
  ])

  const value = useMemo<AppStore>(
    () => ({
      cargando: cargando || !authListo,
      data,
      session,
      userId,
      modoLocal,
      modoDemo: demo,
      sincronizando,
      aviso,
      logrosNuevos,
      entrar,
      registrar,
      salir,
      recuperar,
      entrarComoDemo,
      guardarAjustes,
      registrarCante,
      borrarCante,
      editarCante,
      registrarSesion,
      borrarSesion,
      guardarProgreso,
      guardarTarea,
      borrarTarea,
      alternarOcurrencia,
      saltarOcurrencia,
      guardarTema,
      borrarTema,
      guardarSimulacro,
      botonDePanico,
      marcarDiaCumplido,
      exportar,
      importar,
      resetear,
      descartarLogros,
      mostrarAviso,
    }),
    [
      cargando,
      authListo,
      demo,
      data,
      session,
      userId,
      modoLocal,
      sincronizando,
      aviso,
      logrosNuevos,
      entrar,
      registrar,
      salir,
      recuperar,
      entrarComoDemo,
      guardarAjustes,
      registrarCante,
      borrarCante,
      editarCante,
      registrarSesion,
      borrarSesion,
      guardarProgreso,
      guardarTarea,
      borrarTarea,
      alternarOcurrencia,
      saltarOcurrencia,
      guardarTema,
      borrarTema,
      guardarSimulacro,
      botonDePanico,
      marcarDiaCumplido,
      exportar,
      importar,
      resetear,
      descartarLogros,
      mostrarAviso,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function traducirAuth(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('invalid login')) return 'Email o contraseña incorrectos.'
  if (m.includes('email not confirmed')) return 'Tienes que confirmar el email antes de entrar.'
  if (m.includes('already registered')) return 'Ese email ya está registrado.'
  if (m.includes('password should be')) return 'La contraseña debe tener al menos 6 caracteres.'
  if (m.includes('rate limit')) return 'Demasiados intentos. Espera un momento.'
  return msg
}

/** Exportado para tests manuales desde la consola del navegador. */
export const _debug = { iso }

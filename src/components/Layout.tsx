import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useApp } from '@/store/AppStore'
import { cn, iniciales, pct } from '@/lib/utils'
import { hoy } from '@/lib/dates'
import { colaDelDia } from '@/lib/srs'
import { tareasDe, estaCompletada, estaSaltada } from '@/lib/recurrence'
import { LOGROS, nivel } from '@/lib/logros'
import { Progreso } from './charts'
import { Modal } from './ui'

interface Nav {
  to: string
  label: string
  icono: ReactNode
  badge?: number
}

const IconoInicio = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" stroke="currentColor" className="h-[18px] w-[18px]">
    <path d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const IconoCante = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" stroke="currentColor" className="h-[18px] w-[18px]">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" strokeLinecap="round" />
  </svg>
)
const IconoTemario = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" stroke="currentColor" className="h-[18px] w-[18px]">
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13ZM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5A1.5 1.5 0 0 0 20 18.5v-13Z" strokeLinejoin="round" />
  </svg>
)
const IconoCalendario = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" stroke="currentColor" className="h-[18px] w-[18px]">
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" strokeLinecap="round" />
  </svg>
)
const IconoMetricas = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" stroke="currentColor" className="h-[18px] w-[18px]">
    <path d="M4 19.5V15M10 19.5V8M16 19.5v-6M22 19.5h-20" strokeLinecap="round" />
  </svg>
)
const IconoBombo = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" stroke="currentColor" className="h-[18px] w-[18px]">
    <circle cx="12" cy="11" r="7.5" />
    <circle cx="9.5" cy="9" r="1.6" />
    <circle cx="14" cy="13" r="1.6" />
  </svg>
)
const IconoAjustes = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.7" stroke="currentColor" className="h-[18px] w-[18px]">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M4.2 7l2.6 1.5M17.2 15.5l2.6 1.5M4.2 17l2.6-1.5M17.2 8.5 19.8 7" strokeLinecap="round" />
  </svg>
)

export function Layout({ children }: { children: ReactNode }) {
  const { data, salir, modoLocal, sincronizando, aviso, logrosNuevos, descartarLogros } = useApp()
  const [menuAbierto, setMenuAbierto] = useState(false)
  const loc = useLocation()

  useEffect(() => setMenuAbierto(false), [loc.pathname])

  const h = hoy()
  const pendientesHoy = useMemo(() => {
    const cola = colaDelDia(data.temas, data.progreso, data.ajustes, h).length
    const tareas = tareasDe(data.tareas, h).filter(
      (t) => !estaCompletada(t, h) && !estaSaltada(t, h),
    ).length
    return cola + tareas
  }, [data.temas, data.progreso, data.ajustes, data.tareas, h])

  const navs: Nav[] = [
    { to: '/', label: 'Hoy', icono: IconoInicio, badge: pendientesHoy },
    { to: '/cante', label: 'Cantar', icono: IconoCante },
    { to: '/temario', label: 'Temario', icono: IconoTemario },
    { to: '/calendario', label: 'Calendario', icono: IconoCalendario },
    { to: '/metricas', label: 'Métricas', icono: IconoMetricas },
    { to: '/bombo', label: 'Bombo', icono: IconoBombo },
    { to: '/ajustes', label: 'Ajustes', icono: IconoAjustes },
  ]

  const nv = nivel(data)
  const activos = data.temas.filter((t) => !t.excluido)
  const tocados = activos.filter(
    (t) => (data.progreso[t.id]?.estado ?? 'no_tocado') !== 'no_tocado',
  ).length

  return (
    <div className="min-h-screen lg:flex">
      {/* ---------------------------------------------------------- sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-[248px] shrink-0 border-r border-ink-100 bg-surface/80 backdrop-blur-xl transition-transform duration-300 lg:static lg:translate-x-0',
          menuAbierto ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-full flex-col">
          <div className="px-5 pb-4 pt-6">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sage-700">
                <svg viewBox="0 0 32 32" className="h-5 w-5">
                  <path
                    d="M10 22V10.5c0-.3.35-.46.58-.27L21.4 19.6c.24.2.6.03.6-.28V10"
                    fill="none"
                    stroke="#DFE8E1"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <div>
                <p className="font-serif text-[17px] leading-none text-ink-900">Cante</p>
                <p className="mt-0.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-ink-400">
                  Notarías
                </p>
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-0.5 px-3">
            {navs.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-all',
                    isActive
                      ? 'bg-sage-50 text-sage-800'
                      : 'text-ink-500 hover:bg-ink-100/60 hover:text-ink-900',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={isActive ? 'text-sage-600' : 'text-ink-400'}>{n.icono}</span>
                    <span className="flex-1">{n.label}</span>
                    {n.badge != null && n.badge > 0 && (
                      <span className="num rounded-full bg-clay-100 px-1.5 py-px text-[10.5px] font-bold text-clay-600">
                        {n.badge}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          {/* Progreso global del programa: el dato que el opositor mira siempre. */}
          <div className="mx-3 mb-3 rounded-2xl border border-ink-100 bg-canvas/70 p-3.5">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="label">Programa</span>
              <span className="num text-[13px] font-bold text-sage-700">
                {pct(tocados, activos.length)}%
              </span>
            </div>
            <Progreso valor={tocados} max={activos.length} alto={5} />
            <p className="mt-2 text-[11.5px] text-ink-400">
              {tocados} de {activos.length} temas tocados
            </p>
            <div className="mt-3 border-t border-ink-100 pt-2.5">
              <p className="text-[11.5px] font-semibold text-ink-700">
                Nv. {nv.nivel} · {nv.nombre}
              </p>
              <Progreso valor={nv.progreso} color="#A6832B" alto={3} className="mt-1.5" />
            </div>
          </div>

          <div className="border-t border-ink-100 px-3 py-3">
            <div className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigoish-100 text-[11px] font-bold text-indigoish-600">
                {iniciales(data.ajustes.nombre || 'Op')}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-ink-900">
                  {data.ajustes.nombre || 'Opositor'}
                </p>
                <p className="text-[10.5px] text-ink-400">
                  {modoLocal ? 'Modo local' : 'Sincronizado'}
                  {sincronizando && ' · guardando…'}
                </p>
              </div>
              <button
                onClick={() => void salir()}
                title="Salir"
                className="btn-ghost -mr-1 px-2 py-1.5 text-ink-400"
              >
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" className="h-4 w-4">
                  <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M11 8l-4 4 4 4M7 12h10" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {menuAbierto && (
        <div
          className="fixed inset-0 z-30 bg-ink-900/20 backdrop-blur-sm lg:hidden"
          onClick={() => setMenuAbierto(false)}
        />
      )}

      {/* ------------------------------------------------------------- main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-ink-100 bg-canvas/85 px-4 py-3 backdrop-blur-xl lg:hidden">
          <button onClick={() => setMenuAbierto(true)} className="btn-ghost px-2 py-2">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" className="h-5 w-5">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </button>
          <span className="font-serif text-[17px]">Cante</span>
          {pendientesHoy > 0 && (
            <span className="num ml-auto rounded-full bg-clay-100 px-2 py-0.5 text-[11px] font-bold text-clay-600">
              {pendientesHoy} pendientes
            </span>
          )}
        </header>

        <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 pb-24 pt-5 sm:px-6 lg:pb-10 lg:pt-8">
          {children}
        </main>

        {/* Barra inferior móvil: los 4 destinos que se usan a diario. */}
        <nav className="safe-b fixed bottom-0 inset-x-0 z-20 flex border-t border-ink-100 bg-surface/95 backdrop-blur-xl lg:hidden">
          {navs.slice(0, 5).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                cn(
                  'relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10.5px] font-semibold transition-colors',
                  isActive ? 'text-sage-700' : 'text-ink-400',
                )
              }
            >
              {n.icono}
              {n.label}
              {n.badge != null && n.badge > 0 && (
                <span className="absolute right-[22%] top-1.5 h-1.5 w-1.5 rounded-full bg-clay-500" />
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Avisos */}
      {aviso && (
        <div
          className={cn(
            'fixed bottom-24 left-1/2 z-50 -translate-x-1/2 animate-slide-up rounded-xl px-4 py-2.5 text-[13px] font-semibold shadow-lift lg:bottom-6',
            aviso.tono === 'error'
              ? 'bg-clay-500 text-white'
              : aviso.tono === 'ok'
                ? 'bg-sage-700 text-white'
                : 'bg-ink-900 text-white',
          )}
        >
          {aviso.texto}
        </div>
      )}

      {/* Logros */}
      <Modal
        abierto={logrosNuevos.length > 0}
        cerrar={descartarLogros}
        titulo={logrosNuevos.length > 1 ? 'Hitos desbloqueados' : 'Hito desbloqueado'}
        ancho="max-w-sm"
        pie={
          <button className="btn-primary btn-sm" onClick={descartarLogros}>
            Seguir
          </button>
        }
      >
        <div className="space-y-3">
          {logrosNuevos.map((id) => {
            const l = LOGROS.find((x) => x.id === id)
            if (!l) return null
            return (
              <div key={id} className="flex items-center gap-3.5 rounded-2xl bg-gold-50 p-4">
                <div className="num flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold-100 text-[13px] font-bold text-gold-500">
                  {l.icono}
                </div>
                <div>
                  <p className="font-serif text-[16px] text-ink-900">{l.nombre}</p>
                  <p className="text-[12.5px] text-ink-500">{l.desc}</p>
                </div>
              </div>
            )
          })}
        </div>
      </Modal>
    </div>
  )
}

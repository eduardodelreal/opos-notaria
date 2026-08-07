import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ Card */

export function Card({
  children,
  className,
  padding = true,
}: {
  children: ReactNode
  className?: string
  padding?: boolean
}) {
  return <div className={cn('card', padding && 'p-5', className)}>{children}</div>
}

export function SectionTitle({
  children,
  accion,
  sub,
}: {
  children: ReactNode
  accion?: ReactNode
  sub?: string
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="font-serif text-[22px] leading-tight text-ink-900">{children}</h2>
        {sub && <p className="mt-0.5 text-[13px] text-ink-500">{sub}</p>}
      </div>
      {accion}
    </div>
  )
}

/* ----------------------------------------------------------------- Chip */

export function Chip({
  children,
  color,
  bg,
  className,
}: {
  children: ReactNode
  color?: string
  bg?: string
  className?: string
}) {
  return (
    <span
      className={cn('chip', className)}
      style={{ color: color ?? '#3C3A34', background: bg ?? '#EFECE5' }}
    >
      {children}
    </span>
  )
}

/* ---------------------------------------------------------------- Modal */

export function Modal({
  abierto,
  cerrar,
  titulo,
  children,
  ancho = 'max-w-lg',
  pie,
}: {
  abierto: boolean
  cerrar(): void
  titulo: string
  children: ReactNode
  ancho?: string
  pie?: ReactNode
}) {
  useEffect(() => {
    if (!abierto) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cerrar()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [abierto, cerrar])

  if (!abierto) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-ink-900/25 backdrop-blur-[2px] animate-fade-in"
        onClick={cerrar}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className={cn(
          'relative w-full animate-slide-up overflow-hidden rounded-t-3xl bg-surface shadow-lift sm:rounded-3xl',
          ancho,
        )}
      >
        <header className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <h3 className="font-serif text-[19px] text-ink-900">{titulo}</h3>
          <button onClick={cerrar} className="btn-ghost btn-sm -mr-2" aria-label="Cerrar">
            ✕
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-5">{children}</div>
        {pie && (
          <footer className="flex justify-end gap-2 border-t border-ink-100 bg-canvas/60 px-5 py-4">
            {pie}
          </footer>
        )}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- Form */

export function Campo({
  label,
  children,
  hint,
  className,
}: {
  label: string
  children: ReactNode
  hint?: string
  className?: string
}) {
  return (
    <label className={cn('block', className)}>
      <span className="label mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ink-400">{hint}</span>}
    </label>
  )
}

export function Select({
  value,
  onChange,
  opciones,
  className,
}: {
  value: string
  onChange(v: string): void
  opciones: { valor: string; etiqueta: string }[]
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <select
        value={value}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
        className="input appearance-none pr-9"
      >
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-400">
        ⌄
      </span>
    </div>
  )
}

export function Toggle({
  activo,
  onChange,
  label,
  desc,
}: {
  activo: boolean
  onChange(v: boolean): void
  label: string
  desc?: string
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-ink-900">
          {label}
        </label>
        {desc && <p className="mt-0.5 text-[12.5px] leading-snug text-ink-500">{desc}</p>}
      </div>
      <button
        id={id}
        role="switch"
        aria-checked={activo}
        onClick={() => onChange(!activo)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
          activo ? 'bg-sage-600' : 'bg-ink-200',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200',
            activo ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  )
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  formato,
}: {
  value: number
  onChange(v: number): void
  min: number
  max: number
  step?: number
  formato?(v: number): string
}) {
  const pctVal = ((value - min) / (max - min)) * 100
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="num text-sm font-semibold text-sage-700">
          {formato ? formato(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none
          [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white
          [&::-webkit-slider-thumb]:bg-sage-600 [&::-webkit-slider-thumb]:shadow"
        style={{
          background: `linear-gradient(to right, #517C5E 0%, #517C5E ${pctVal}%, #DDD9D0 ${pctVal}%, #DDD9D0 100%)`,
        }}
      />
    </div>
  )
}

/* ----------------------------------------------------------------- Tabs */

export function Tabs<T extends string>({
  valor,
  onChange,
  items,
}: {
  valor: T
  onChange(v: T): void
  items: { valor: T; etiqueta: string; badge?: number }[]
}) {
  return (
    <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl bg-ink-100/70 p-1">
      {items.map((i) => (
        <button
          key={i.valor}
          onClick={() => onChange(i.valor)}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-all',
            valor === i.valor
              ? 'bg-surface text-ink-900 shadow-sm'
              : 'text-ink-500 hover:text-ink-700',
          )}
        >
          {i.etiqueta}
          {i.badge != null && i.badge > 0 && (
            <span className="num rounded-full bg-sage-100 px-1.5 text-[11px] text-sage-700">
              {i.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/* ---------------------------------------------------------------- Empty */

export function Vacio({
  icono = '◌',
  titulo,
  texto,
  accion,
}: {
  icono?: string
  titulo: string
  texto?: string
  accion?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100 text-xl text-ink-400">
        {icono}
      </div>
      <p className="font-serif text-[18px] text-ink-900">{titulo}</p>
      {texto && <p className="mt-1 max-w-sm text-[13.5px] leading-relaxed text-ink-500">{texto}</p>}
      {accion && <div className="mt-4">{accion}</div>}
    </div>
  )
}

/* ------------------------------------------------------------- Tooltip  */

export function Info({ children }: { children: string }) {
  const [ver, setVer] = useState(false)
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onMouseEnter={() => setVer(true)}
        onMouseLeave={() => setVer(false)}
        onClick={() => setVer((v) => !v)}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-ink-200 text-[9px] font-bold text-ink-400 hover:border-ink-300 hover:text-ink-600"
        aria-label="Más información"
      >
        i
      </button>
      {ver && (
        <span className="absolute bottom-full left-1/2 z-30 mb-2 w-56 -translate-x-1/2 animate-fade-in rounded-xl bg-ink-900 px-3 py-2 text-[12px] font-normal leading-snug text-ink-100 shadow-lift">
          {children}
        </span>
      )}
    </span>
  )
}

/* -------------------------------------------------------------- Confirm */

export function useConfirmar() {
  const [estado, setEstado] = useState<{
    texto: string
    onOk(): void
    peligro?: boolean
  } | null>(null)

  const nodo = (
    <Modal
      abierto={!!estado}
      cerrar={() => setEstado(null)}
      titulo="¿Seguro?"
      ancho="max-w-sm"
      pie={
        <>
          <button className="btn-secondary btn-sm" onClick={() => setEstado(null)}>
            Cancelar
          </button>
          <button
            className={estado?.peligro ? 'btn-danger btn-sm' : 'btn-primary btn-sm'}
            onClick={() => {
              estado?.onOk()
              setEstado(null)
            }}
          >
            Confirmar
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-700">{estado?.texto}</p>
    </Modal>
  )

  return {
    nodo,
    pedir: (texto: string, onOk: () => void, peligro = false) =>
      setEstado({ texto, onOk, peligro }),
  }
}

/* ------------------------------------------------------------ Autofocus */

export function useAutoFocus<T extends HTMLElement>(activo = true) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (activo) ref.current?.focus()
  }, [activo])
  return ref
}

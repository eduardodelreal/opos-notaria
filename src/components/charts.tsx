import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { DIAS_CORTOS, fmtFecha, parseIso } from '@/lib/dates'

/**
 * Gráficos hechos a mano en SVG. Sin librerías: mantiene el bundle pequeño y
 * permite que todos compartan la misma paleta clara y el mismo grosor de trazo.
 */

/* ------------------------------------------------------------------- Ring */

export function Ring({
  valor,
  max = 100,
  size = 116,
  grosor = 10,
  color = '#517C5E',
  pista = '#EFECE5',
  children,
}: {
  valor: number
  max?: number
  size?: number
  grosor?: number
  color?: string
  pista?: string
  children?: React.ReactNode
}) {
  const r = (size - grosor) / 2
  const c = 2 * Math.PI * r
  const ratio = max > 0 ? Math.min(1, Math.max(0, valor / max)) : 0
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={pista} strokeWidth={grosor} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={grosor}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
          style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  )
}

/* --------------------------------------------------------------- Segmentos */

/** Barra horizontal segmentada. Sustituye al típico pie chart: se lee mejor. */
export function BarraSegmentos({
  datos,
  altura = 12,
  leyenda = true,
}: {
  datos: { etiqueta: string; valor: number; color: string }[]
  altura?: number
  leyenda?: boolean
}) {
  const total = datos.reduce((a, d) => a + d.valor, 0)
  return (
    <div>
      <div
        className="flex w-full overflow-hidden rounded-full bg-ink-100"
        style={{ height: altura }}
      >
        {total > 0 &&
          datos.map((d, i) =>
            d.valor > 0 ? (
              <div
                key={i}
                title={`${d.etiqueta}: ${d.valor}`}
                style={{
                  width: `${(d.valor / total) * 100}%`,
                  background: d.color,
                  transition: 'width 600ms cubic-bezier(0.16,1,0.3,1)',
                }}
              />
            ) : null,
          )}
      </div>
      {leyenda && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {datos.map((d, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
              <span className="text-[12px] text-ink-500">{d.etiqueta}</span>
              <span className="num text-[12px] font-semibold text-ink-700">{d.valor}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Barras */

export function Barras({
  datos,
  alto = 130,
  color = '#517C5E',
  objetivo,
  formatoValor,
}: {
  datos: { etiqueta: string; valor: number; color?: string }[]
  alto?: number
  color?: string
  objetivo?: number
  formatoValor?(v: number): string
}) {
  const max = Math.max(objetivo ?? 0, ...datos.map((d) => d.valor), 1)
  const [hover, setHover] = useState<number | null>(null)
  return (
    <div>
      <div className="relative flex items-end gap-1.5" style={{ height: alto }}>
        {objetivo != null && objetivo > 0 && (
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-sage-300"
            style={{ bottom: `${(objetivo / max) * 100}%` }}
          >
            <span className="absolute -top-4 right-0 text-[10px] font-semibold text-sage-500">
              objetivo
            </span>
          </div>
        )}
        {datos.map((d, i) => (
          <div
            key={i}
            className="group relative flex flex-1 flex-col justify-end"
            style={{ height: '100%' }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            {hover === i && (
              <div className="absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-ink-900 px-2 py-1 text-[11px] font-semibold text-white">
                {formatoValor ? formatoValor(d.valor) : d.valor}
              </div>
            )}
            <div
              className="w-full rounded-t-md transition-all duration-500"
              style={{
                height: `${Math.max(d.valor > 0 ? 3 : 0, (d.valor / max) * 100)}%`,
                background: d.color ?? color,
                opacity: hover == null || hover === i ? 1 : 0.55,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {datos.map((d, i) => (
          <div key={i} className="flex-1 text-center text-[10.5px] font-medium text-ink-400">
            {d.etiqueta}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Línea */

export function Linea({
  datos,
  alto = 140,
  color = '#517C5E',
  relleno = true,
  minY,
  maxY,
  formatoValor,
}: {
  datos: { etiqueta: string; valor: number }[]
  alto?: number
  color?: string
  relleno?: boolean
  minY?: number
  maxY?: number
  formatoValor?(v: number): string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 100
  const H = 100
  const { path, area, puntos, lo, hi } = useMemo(() => {
    if (datos.length === 0) return { path: '', area: '', puntos: [], lo: 0, hi: 1 }
    const vs = datos.map((d) => d.valor)
    const lo = minY ?? Math.min(...vs)
    const hiRaw = maxY ?? Math.max(...vs)
    const hi = hiRaw === lo ? lo + 1 : hiRaw
    const puntos = datos.map((d, i) => ({
      x: datos.length === 1 ? W / 2 : (i / (datos.length - 1)) * W,
      y: H - ((d.valor - lo) / (hi - lo)) * H,
    }))
    // Curva suave con Catmull-Rom → Bézier.
    let path = `M ${puntos[0].x} ${puntos[0].y}`
    for (let i = 0; i < puntos.length - 1; i++) {
      const p0 = puntos[i - 1] ?? puntos[i]
      const p1 = puntos[i]
      const p2 = puntos[i + 1]
      const p3 = puntos[i + 2] ?? p2
      const c1x = p1.x + (p2.x - p0.x) / 6
      const c1y = p1.y + (p2.y - p0.y) / 6
      const c2x = p2.x - (p3.x - p1.x) / 6
      const c2y = p2.y - (p3.y - p1.y) / 6
      path += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`
    }
    const area = `${path} L ${puntos[puntos.length - 1].x} ${H} L ${puntos[0].x} ${H} Z`
    return { path, area, puntos, lo, hi }
  }, [datos, minY, maxY])

  if (!datos.length) return <div className="h-[140px]" />
  const gid = `g-${color.replace('#', '')}`

  return (
    <div className="relative" style={{ height: alto }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-full w-full overflow-visible"
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {relleno && <path d={area} fill={`url(#${gid})`} />}
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
        />
        {puntos.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={hover === i ? 3.5 : 0}
            fill="white"
            stroke={color}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {/* Zonas de hover independientes del viewBox deformado. */}
      <div className="absolute inset-0 flex">
        {datos.map((d, i) => (
          <div
            key={i}
            className="relative flex-1"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            {hover === i && (
              <div className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-ink-900 px-2 py-1 text-[11px] font-semibold text-white">
                {d.etiqueta} · {formatoValor ? formatoValor(d.valor) : d.valor}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute -bottom-5 inset-x-0 flex justify-between text-[10.5px] text-ink-400">
        <span>{datos[0]?.etiqueta}</span>
        <span>{datos[datos.length - 1]?.etiqueta}</span>
      </div>
      <div className="pointer-events-none absolute -left-1 -top-1 text-[10px] text-ink-300">
        {Math.round(hi)}
      </div>
      <div className="pointer-events-none absolute -bottom-1 -left-1 text-[10px] text-ink-300">
        {Math.round(lo)}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- Heatmap */

/** Mapa de constancia estilo GitHub, en la paleta salvia. */
export function Heatmap({
  datos,
  semanas = 26,
  hasta,
  onClickDia,
}: {
  datos: Record<string, number>
  semanas?: number
  hasta: string
  onClickDia?(fecha: string): void
}) {
  const columnas = useMemo(() => {
    const fin = parseIso(hasta)
    const dow = (fin.getDay() + 6) % 7
    fin.setDate(fin.getDate() + (6 - dow)) // completar la semana en curso
    const cols: string[][] = []
    for (let w = semanas - 1; w >= 0; w--) {
      const col: string[] = []
      for (let d = 0; d < 7; d++) {
        const f = new Date(fin)
        f.setDate(fin.getDate() - w * 7 - (6 - d))
        const y = f.getFullYear()
        const m = String(f.getMonth() + 1).padStart(2, '0')
        const day = String(f.getDate()).padStart(2, '0')
        col.push(`${y}-${m}-${day}`)
      }
      cols.push(col)
    }
    return cols
  }, [hasta, semanas])

  const max = Math.max(1, ...Object.values(datos))
  const tono = (v: number) => {
    if (!v) return '#EFECE5'
    const t = v / max
    if (t > 0.75) return '#324F3B'
    if (t > 0.5) return '#517C5E'
    if (t > 0.25) return '#98B7A0'
    return '#DFE8E1'
  }

  return (
    <div className="flex gap-1.5">
      <div className="flex flex-col gap-[3px] pr-1 pt-[1px]">
        {[1, 2, 3, 4, 5, 6, 0].map((d, i) => (
          <div key={d} className="flex h-3 items-center text-[9px] leading-none text-ink-300">
            {i % 2 === 0 ? DIAS_CORTOS[d] : ''}
          </div>
        ))}
      </div>
      <div className="no-scrollbar flex gap-[3px] overflow-x-auto">
        {columnas.map((col, i) => (
          <div key={i} className="flex flex-col gap-[3px]">
            {col.map((f) => (
              <button
                key={f}
                onClick={() => onClickDia?.(f)}
                title={`${fmtFecha(f)} · ${datos[f] ?? 0}`}
                className={cn(
                  'h-3 w-3 rounded-[3px] transition-transform',
                  onClickDia && 'hover:scale-125',
                )}
                style={{ background: tono(datos[f] ?? 0) }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- Sparkline */

export function Sparkline({
  valores,
  color = '#517C5E',
  alto = 30,
}: {
  valores: number[]
  color?: string
  alto?: number
}) {
  if (valores.length < 2) return <div style={{ height: alto }} />
  const lo = Math.min(...valores)
  const hi = Math.max(...valores)
  const span = hi === lo ? 1 : hi - lo
  const d = valores
    .map((v, i) => {
      const x = (i / (valores.length - 1)) * 100
      const y = 100 - ((v - lo) / span) * 100
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height: alto }} className="w-full">
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
      />
    </svg>
  )
}

/* ------------------------------------------------------------ Barra simple */

export function Progreso({
  valor,
  max = 100,
  color = '#517C5E',
  alto = 6,
  className,
}: {
  valor: number
  max?: number
  color?: string
  alto?: number
  className?: string
}) {
  const r = max > 0 ? Math.min(100, (valor / max) * 100) : 0
  return (
    <div
      className={cn('w-full overflow-hidden rounded-full bg-ink-100', className)}
      style={{ height: alto }}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${r}%`,
          background: color,
          transition: 'width 600ms cubic-bezier(0.16,1,0.3,1)',
        }}
      />
    </div>
  )
}

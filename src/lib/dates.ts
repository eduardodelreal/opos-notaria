/** Utilidades de fecha en local-time. Todo el dominio usa claves ISO "YYYY-MM-DD". */

export const DIAS_CORTOS = ['D', 'L', 'M', 'X', 'J', 'V', 'S']
export const DIAS_LARGOS = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
]
export const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

export function iso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function hoy(): string {
  return iso(new Date())
}

/** Parsea "YYYY-MM-DD" como fecha local (evita el desfase UTC de new Date(str)). */
export function parseIso(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function addDays(s: string, n: number): string {
  const d = parseIso(s)
  d.setDate(d.getDate() + n)
  return iso(d)
}

export function addMonths(s: string, n: number): string {
  const d = parseIso(s)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, ultimo))
  return iso(d)
}

export function diffDays(a: string, b: string): number {
  const ms = parseIso(b).getTime() - parseIso(a).getTime()
  return Math.round(ms / 86_400_000)
}

export function startOfWeek(s: string): string {
  const d = parseIso(s)
  const dow = (d.getDay() + 6) % 7 // lunes = 0
  return addDays(s, -dow)
}

export function endOfWeek(s: string): string {
  return addDays(startOfWeek(s), 6)
}

export function startOfMonth(s: string): string {
  const d = parseIso(s)
  return iso(new Date(d.getFullYear(), d.getMonth(), 1))
}

export function monthMatrix(year: number, month: number): string[] {
  // month 0-indexado. Devuelve 42 días (6 semanas) empezando en lunes.
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7
  const start = addDays(iso(first), -offset)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

export function fmtFecha(s: string, opts?: { corta?: boolean; conDia?: boolean }): string {
  const d = parseIso(s)
  const mes = opts?.corta ? MESES[d.getMonth()].slice(0, 3) : MESES[d.getMonth()]
  const base = opts?.corta ? `${d.getDate()} ${mes}` : `${d.getDate()} de ${mes}`
  return opts?.conDia ? `${DIAS_LARGOS[d.getDay()]}, ${base}` : base
}

/** "hoy" / "ayer" / "en 3 días" / "hace 12 días" */
export function fmtRelativo(s: string, ref = hoy()): string {
  const n = diffDays(ref, s)
  if (n === 0) return 'hoy'
  if (n === 1) return 'mañana'
  if (n === -1) return 'ayer'
  if (n > 0) return `en ${n} d`
  return `hace ${-n} d`
}

export function fmtDuracion(segundos: number): string {
  const s = Math.max(0, Math.round(segundos))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

export function fmtHoras(minutos: number): string {
  if (minutos < 60) return `${Math.round(minutos)} min`
  const h = Math.floor(minutos / 60)
  const m = Math.round(minutos % 60)
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

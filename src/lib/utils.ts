export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function uid(prefix = ''): string {
  const rnd = Math.random().toString(36).slice(2, 10)
  return `${prefix}${Date.now().toString(36)}${rnd}`
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function media(xs: number[]): number {
  if (!xs.length) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

export function suma(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0)
}

export function agrupar<T, K extends string | number>(
  xs: T[],
  key: (x: T) => K,
): Record<K, T[]> {
  const out = {} as Record<K, T[]>
  for (const x of xs) {
    const k = key(x)
    ;(out[k] ??= []).push(x)
  }
  return out
}

/** Baraja con Fisher-Yates. Usada por el bombo. */
export function barajar<T>(xs: T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function pct(parte: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((parte / total) * 100)
}

/** Color de nota 0-10 en la paleta de la app. */
export function colorNota(nota: number | null): string {
  if (nota == null) return '#B5B1A8'
  if (nota >= 8.5) return '#3E6349'
  if (nota >= 7) return '#6F9A7B'
  if (nota >= 5) return '#C6A03A'
  if (nota >= 3.5) return '#CC7C60'
  return '#B45F42'
}

export function iniciales(nombre: string): string {
  return nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

export async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}

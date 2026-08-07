import type { AppData } from './types'
import { hoy, startOfWeek } from './dates'
import { dentroDeTiempo } from './srs'

/**
 * Gamificación con criterio: nada de mascotas ni confeti infantil.
 * Los hitos son los que un opositor adulto contaría a su preparador,
 * y todos miden trabajo real (volumen, constancia, calidad), no clicks.
 */
export interface Logro {
  id: string
  nombre: string
  desc: string
  icono: string
  test: (d: AppData) => boolean
}

const cantesTotales = (d: AppData) => d.cantes.length
const notaAlta = (d: AppData) => d.cantes.filter((c) => c.nota >= 9).length
const enTiempo = (d: AppData) =>
  d.cantes.filter((c) => dentroDeTiempo(c.duracionSegundos, c.objetivoSegundos)).length

function rachaActual(dias: string[]): number {
  const set = new Set(dias)
  let n = 0
  const d = new Date()
  for (;;) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    if (!set.has(`${y}-${m}-${day}`)) break
    n++
    d.setDate(d.getDate() - 1)
  }
  return n
}

export const LOGROS: Logro[] = [
  {
    id: 'primer_cante',
    nombre: 'Primer cante',
    desc: 'Has cantado tu primer tema con cronómetro',
    icono: '◗',
    test: (d) => cantesTotales(d) >= 1,
  },
  {
    id: 'cantes_50',
    nombre: '50 cantes',
    desc: 'Cincuenta temas cantados y registrados',
    icono: 'L',
    test: (d) => cantesTotales(d) >= 50,
  },
  {
    id: 'cantes_250',
    nombre: '250 cantes',
    desc: 'Volumen de opositor veterano',
    icono: 'CCL',
    test: (d) => cantesTotales(d) >= 250,
  },
  {
    id: 'cantes_1000',
    nombre: 'Mil cantes',
    desc: 'Ya no cuentas los cantes, cuentas las vueltas',
    icono: 'M',
    test: (d) => cantesTotales(d) >= 1000,
  },
  {
    id: 'primera_vuelta',
    nombre: 'Primera vuelta cerrada',
    desc: 'Todos los temas del programa tocados al menos una vez',
    icono: '①',
    test: (d) => {
      const activos = d.temas.filter((t) => !t.excluido)
      return (
        activos.length > 0 &&
        activos.every((t) => (d.progreso[t.id]?.estado ?? 'no_tocado') !== 'no_tocado')
      )
    },
  },
  {
    id: 'bloque_dominado',
    nombre: 'Bloque dominado',
    desc: 'Un bloque entero en estado Dominado',
    icono: '■',
    test: (d) => {
      const bloques = new Set(d.temas.map((t) => t.bloque))
      for (const b of bloques) {
        const ts = d.temas.filter((t) => t.bloque === b && !t.excluido)
        if (ts.length >= 10 && ts.every((t) => d.progreso[t.id]?.estado === 'dominado')) return true
      }
      return false
    },
  },
  {
    id: 'racha_7',
    nombre: 'Semana limpia',
    desc: '7 días seguidos cumpliendo el objetivo',
    icono: 'VII',
    test: (d) => rachaActual(d.diasCumplidos) >= 7,
  },
  {
    id: 'racha_30',
    nombre: 'Mes sin fallar',
    desc: '30 días seguidos cumpliendo el objetivo',
    icono: 'XXX',
    test: (d) => rachaActual(d.diasCumplidos) >= 30,
  },
  {
    id: 'racha_100',
    nombre: 'Cien días',
    desc: 'Cien días consecutivos. Esto ya es oficio',
    icono: 'C',
    test: (d) => rachaActual(d.diasCumplidos) >= 100,
  },
  {
    id: 'sobresaliente_10',
    nombre: 'Diez cantes de tribunal',
    desc: '10 cantes con nota ≥ 9',
    icono: '★',
    test: (d) => notaAlta(d) >= 10,
  },
  {
    id: 'reloj_suizo',
    nombre: 'Reloj suizo',
    desc: '25 cantes dentro del tiempo tasado',
    icono: '◷',
    test: (d) => enTiempo(d) >= 25,
  },
  {
    id: 'simulacro',
    nombre: 'Simulacro completo',
    desc: 'Un ejercicio entero sacado del bombo, de una sentada',
    icono: '◉',
    test: (d) => d.simulacros.some((s) => s.completado),
  },
  {
    id: 'sin_arrastre',
    nombre: 'Arrastre a cero',
    desc: 'Ni un solo tema vencido al cerrar el día',
    icono: '∅',
    test: (d) => {
      const h = hoy()
      const vencidos = Object.values(d.progreso).filter(
        (p) => p.proximaRevision && p.proximaRevision <= h,
      )
      return d.cantes.length > 20 && vencidos.length === 0
    },
  },
  {
    id: 'semana_dura',
    nombre: 'Semana de 60 horas',
    desc: '60 horas de estudio registradas en una semana',
    icono: 'LX',
    test: (d) => {
      const ini = startOfWeek(hoy())
      const min = d.sesiones
        .filter((s) => s.fecha.slice(0, 10) >= ini)
        .reduce((a, s) => a + s.minutos, 0)
      return min >= 60 * 60
    },
  },
]

/** Devuelve los ids de logros nuevos desbloqueados. */
export function evaluarLogros(d: AppData): string[] {
  const ya = new Set(d.logros)
  return LOGROS.filter((l) => !ya.has(l.id) && l.test(d)).map((l) => l.id)
}

/**
 * "Nivel" del opositor. Deliberadamente NO son XP por abrir la app: es una
 * función del programa realmente dominado, que es lo único que aprueba.
 */
export function nivel(d: AppData): { nivel: number; nombre: string; progreso: number } {
  const activos = d.temas.filter((t) => !t.excluido)
  const puntos = activos.reduce((acc, t) => {
    const e = d.progreso[t.id]?.estado ?? 'no_tocado'
    if (e === 'dominado') return acc + 3
    if (e === 'oxidado') return acc + 2
    if (e === 'en_arrastre') return acc + 2
    if (e === 'primera_vuelta') return acc + 1
    return acc
  }, 0)
  const max = Math.max(1, activos.length * 3)
  const ratio = puntos / max
  const nombres = [
    'Recién llegado',
    'Primera vuelta',
    'Rodando el programa',
    'En arrastre',
    'Cantando de seguido',
    'Nivel de tribunal',
  ]
  const idx = Math.min(nombres.length - 1, Math.floor(ratio * nombres.length))
  const tramo = 1 / nombres.length
  return {
    nivel: idx + 1,
    nombre: nombres[idx],
    progreso: Math.round(((ratio - idx * tramo) / tramo) * 100),
  }
}

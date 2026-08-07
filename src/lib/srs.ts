import type { Ajustes, Calificacion, EstadoTema, ProgresoTema, Tema } from './types'
import { addDays, diffDays, hoy } from './dates'

/**
 * SRS de "vueltas", no de flashcards.
 *
 * Diferencias frente a Anki, deliberadas:
 *  1. La unidad es el TEMA COMPLETO (20+ min de cante), no una tarjeta. El coste de
 *     un repaso es alto, así que la penalización por fallar debe ser suave: no se
 *     resetea a 1 día, se retrocede un escalón. Reventar a un opositor con 40 temas
 *     "vencidos" el mismo día es lo que le hace abandonar la app.
 *  2. La nota combina CONTENIDO (¿me lo sabía?) y TIEMPO (¿entré en 11-12 min?).
 *     Un tema recitado perfecto en 18 minutos no está listo para el tribunal.
 *  3. Los intervalos están topados por el horizonte de la convocatoria: si el examen
 *     es en 5 meses, no tiene sentido programar un repaso a 8 meses.
 *  4. Existe la OXIDACIÓN: un tema dominado que no se canta decae de estado solo,
 *     igual que le pasa al opositor en la vida real.
 *  5. Los intervalos son escalones fijos con jitter, no una curva continua: el
 *     opositor razona en "vueltas" y necesita previsibilidad para planificar semanas.
 */

/** Escalones base en días. Cada vuelta superada sube un escalón. */
export const ESCALONES = [1, 3, 7, 14, 25, 40, 60, 90, 130, 180]

/**
 * Techo absoluto del intervalo. En una oposición donde la convocatoria puede
 * caer en cualquier momento, ningún tema debe pasar más de siete meses sin
 * cantarse, por dominado que esté.
 */
export const INTERVALO_MAXIMO = 210

export const CALIFICACIONES: {
  valor: Calificacion
  etiqueta: string
  desc: string
  color: string
}[] = [
  { valor: 1, etiqueta: 'En blanco', desc: 'No he podido cantarlo', color: '#B45F42' },
  { valor: 2, etiqueta: 'Flojo', desc: 'Lagunas graves, he tirado de esquema', color: '#CC7C60' },
  { valor: 3, etiqueta: 'Aprobado', desc: 'Entero pero con tropiezos', color: '#C6A03A' },
  { valor: 4, etiqueta: 'Notable', desc: 'Fluido, algún detalle suelto', color: '#6F9A7B' },
  { valor: 5, etiqueta: 'Cante limpio', desc: 'De tribunal, sin fisuras', color: '#3E6349' },
]

export const ESTADOS: Record<
  EstadoTema,
  { etiqueta: string; color: string; bg: string; orden: number }
> = {
  no_tocado: { etiqueta: 'Sin tocar', color: '#8E8A82', bg: '#EFECE5', orden: 0 },
  primera_vuelta: { etiqueta: '1ª vuelta', color: '#556296', bg: '#DFE3F1', orden: 1 },
  en_arrastre: { etiqueta: 'En arrastre', color: '#A6832B', bg: '#F5EACB', orden: 2 },
  dominado: { etiqueta: 'Dominado', color: '#3E6349', bg: '#DFE8E1', orden: 4 },
  oxidado: { etiqueta: 'Oxidado', color: '#B45F42', bg: '#F6E2D9', orden: 3 },
}

export function progresoVacio(temaId: string): ProgresoTema {
  return {
    temaId,
    estado: 'no_tocado',
    vueltas: 0,
    intervalo: 0,
    facilidad: 2.2,
    ultimoCante: null,
    proximaRevision: null,
    notaMedia: null,
    minutosEstudio: 0,
  }
}

/**
 * Nota final 0-10 a partir del contenido (1-5) y del tiempo empleado.
 *
 * El tiempo no es un extra: en el cante real, pasarte del tiempo tasado te corta
 * el tema. Y quedarte muy corto suele significar que te has saltado epígrafes.
 */
export function calcularNota(
  calificacion: Calificacion,
  duracionSegundos: number,
  objetivoSegundos: number,
  lagunas = 0,
): number {
  const baseContenido = (calificacion - 1) * 2.5 // 0, 2.5, 5, 7.5, 10
  const ratio = objetivoSegundos > 0 ? duracionSegundos / objetivoSegundos : 1

  // Ventana buena: 88%–105% del objetivo. Fuera, penalización progresiva.
  let ajusteTiempo = 0
  if (ratio > 1.05) {
    // Pasarse: -0.9 puntos por cada 10% de exceso, hasta -3.5.
    ajusteTiempo = -Math.min(3.5, ((ratio - 1.05) / 0.1) * 0.9)
  } else if (ratio < 0.88) {
    // Quedarse corto: casi siempre significa epígrafes saltados, no eficiencia.
    // El tope es alto a propósito: un tema "perfecto" en 3 de los 12 minutos no
    // puede salir con un 7, porque ese cante no existió.
    ajusteTiempo = -Math.min(4.5, ((0.88 - ratio) / 0.1) * 0.8)
  } else {
    // Bonus pequeño por clavar el tiempo.
    ajusteTiempo = 0.3
  }

  const penalLagunas = Math.min(1.5, lagunas * 0.4)
  const nota = baseContenido + ajusteTiempo - penalLagunas
  return Math.round(Math.max(0, Math.min(10, nota)) * 10) / 10
}

/**
 * Ventana de tiempo válida: 88%–105% del objetivo.
 * Ojo: "en tiempo" NO es "por debajo del límite". Un tema recitado en 3 minutos
 * cuando el objetivo son 12 no está en tiempo, está incompleto.
 */
export const VENTANA_TIEMPO = { min: 0.88, max: 1.05 } as const

export function dentroDeTiempo(duracionSegundos: number, objetivoSegundos: number): boolean {
  if (objetivoSegundos <= 0) return false
  const r = duracionSegundos / objetivoSegundos
  return r >= VENTANA_TIEMPO.min && r <= VENTANA_TIEMPO.max
}

/** Etiqueta cualitativa del ratio de tiempo, para la UI. */
export function evaluarTiempo(
  duracionSegundos: number,
  objetivoSegundos: number,
): { etiqueta: string; tono: 'ok' | 'aviso' | 'mal'; ratio: number } {
  const ratio = objetivoSegundos > 0 ? duracionSegundos / objetivoSegundos : 1
  if (ratio > 1.15) return { etiqueta: 'Muy pasado de tiempo', tono: 'mal', ratio }
  if (ratio > VENTANA_TIEMPO.max) return { etiqueta: 'Pasado de tiempo', tono: 'aviso', ratio }
  if (ratio < 0.75) return { etiqueta: 'Muy corto', tono: 'mal', ratio }
  if (ratio < VENTANA_TIEMPO.min) return { etiqueta: 'Corto', tono: 'aviso', ratio }
  return { etiqueta: 'En tiempo', tono: 'ok', ratio }
}

function jitter(dias: number, semilla: string): number {
  // Reparto determinista ±12% para no acumular 30 temas el mismo día.
  let h = 0
  for (let i = 0; i < semilla.length; i++) h = (h * 31 + semilla.charCodeAt(i)) % 1000
  const factor = 1 + ((h / 1000) * 0.24 - 0.12)
  return Math.max(1, Math.round(dias * factor))
}

export interface ResultadoSrs {
  progreso: ProgresoTema
  /** Días hasta la próxima revisión, ya con jitter y tope de convocatoria. */
  intervaloDias: number
  /** Explicación en lenguaje del opositor. */
  explicacion: string
}

export function aplicarCante(
  previo: ProgresoTema,
  params: {
    calificacion: Calificacion
    nota: number
    ajustes: Ajustes
    fecha?: string
  },
): ResultadoSrs {
  const { calificacion, nota, ajustes } = params
  const fecha = params.fecha ?? hoy()

  let facilidad = previo.facilidad
  let escalon = ESCALONES.findIndex((e) => e >= previo.intervalo)
  if (escalon < 0) escalon = previo.intervalo > 0 ? ESCALONES.length - 1 : -1

  let explicacion = ''

  if (calificacion <= 2) {
    // Falla: retrocede escalones, no resetea. Un tema de 6ª vuelta que hoy sale
    // flojo no vuelve a estar "sin tocar".
    escalon = Math.max(0, escalon - (calificacion === 1 ? 3 : 2))
    facilidad = Math.max(1.4, facilidad - 0.22)
    explicacion = 'Cante flojo: el tema retrocede escalones y vuelve pronto.'
  } else if (calificacion === 3) {
    escalon = Math.max(0, escalon) // se mantiene, no avanza
    facilidad = Math.max(1.5, facilidad - 0.06)
    explicacion = 'Aprobado raspado: repite el mismo intervalo para consolidarlo.'
  } else {
    escalon = Math.min(ESCALONES.length - 1, escalon + 1)
    facilidad = Math.min(3.0, facilidad + (calificacion === 5 ? 0.14 : 0.06))
    explicacion =
      calificacion === 5
        ? 'Cante limpio: sube de escalón con intervalo ampliado.'
        : 'Buen cante: sube de escalón.'
  }

  const base = ESCALONES[Math.max(0, escalon)]
  const factorNota = 0.85 + (nota / 10) * 0.35 // 0.85 – 1.20
  let dias = base * (facilidad / 2.2) * factorNota * ajustes.factorSrs
  dias = Math.min(INTERVALO_MAXIMO, jitter(dias, previo.temaId + fecha))

  // Tope por horizonte de convocatoria: nunca programar más allá del examen.
  if (ajustes.fechaExamen) {
    const restantes = diffDays(fecha, ajustes.fechaExamen)
    if (restantes > 2) {
      // Antes del examen todo tema debe caer al menos una vez más.
      dias = Math.min(dias, Math.max(2, Math.floor(restantes * 0.55)))
    }
  }

  const vueltas = calificacion >= 3 ? previo.vueltas + 1 : previo.vueltas
  const notaMedia =
    previo.notaMedia == null ? nota : Math.round((previo.notaMedia * 0.65 + nota * 0.35) * 10) / 10

  const estado = derivarEstado({ vueltas, notaMedia, intervalo: dias })

  return {
    progreso: {
      ...previo,
      estado,
      vueltas,
      intervalo: dias,
      facilidad: Math.round(facilidad * 100) / 100,
      ultimoCante: fecha,
      proximaRevision: addDays(fecha, dias),
      notaMedia,
    },
    intervaloDias: dias,
    explicacion,
  }
}

function derivarEstado(p: { vueltas: number; notaMedia: number; intervalo: number }): EstadoTema {
  if (p.vueltas >= 3 && p.notaMedia >= 7.5 && p.intervalo >= 40) return 'dominado'
  if (p.vueltas <= 1) return 'primera_vuelta'
  return 'en_arrastre'
}

/**
 * Oxidación: recalcula estado según días transcurridos sin cantar.
 * Se aplica en cada carga de datos, no se persiste como evento.
 */
export function aplicarOxidacion(p: ProgresoTema, ajustes: Ajustes, ref = hoy()): ProgresoTema {
  if (!p.ultimoCante || p.estado === 'no_tocado') return p
  const dias = diffDays(p.ultimoCante, ref)
  const umbral = Math.max(14, Math.round(ajustes.umbralOxido))
  if (p.estado === 'dominado' && dias > umbral) return { ...p, estado: 'oxidado' }
  if (p.estado === 'en_arrastre' && dias > umbral * 1.6) return { ...p, estado: 'oxidado' }
  return p
}

/**
 * Riesgo de examen 0-100. Mide "si mañana sale este tema en el bombo, cuánto
 * me juego". Combina retraso sobre la fecha prevista, nota y nº de vueltas.
 * Es el número que ordena la cola de repaso del día.
 */
export function riesgo(p: ProgresoTema, ref = hoy()): number {
  if (p.estado === 'no_tocado') return 100
  const retraso = p.proximaRevision ? diffDays(p.proximaRevision, ref) : 0
  const compRetraso = Math.min(45, Math.max(0, retraso) * (p.intervalo > 30 ? 1.1 : 2.6))
  const compNota = p.notaMedia == null ? 22 : Math.max(0, (8.5 - p.notaMedia) * 4.2)
  const compVueltas = Math.max(0, 22 - p.vueltas * 4.5)
  const compFrescura = p.ultimoCante ? Math.min(18, diffDays(p.ultimoCante, ref) / 12) : 18
  return Math.round(Math.min(100, compRetraso + compNota + compVueltas + compFrescura))
}

export function estaVencido(p: ProgresoTema, ref = hoy()): boolean {
  if (!p.proximaRevision) return false
  return diffDays(p.proximaRevision, ref) >= 0
}

/**
 * Cola de repaso del día: vencidos ordenados por riesgo, más un relleno de
 * temas sin tocar si el opositor va sobrado. Tope para que sea alcanzable.
 */
export function colaDelDia(
  temas: Tema[],
  progreso: Record<string, ProgresoTema>,
  ajustes: Ajustes,
  ref = hoy(),
): { temaId: string; riesgo: number; motivo: 'vencido' | 'nuevo' | 'oxidado' }[] {
  const activos = temas.filter((t) => !t.excluido)
  const vencidos: { temaId: string; riesgo: number; motivo: 'vencido' | 'oxidado' }[] = []
  const nuevos: { temaId: string; riesgo: number; motivo: 'nuevo' }[] = []

  for (const t of activos) {
    const p = progreso[t.id] ?? progresoVacio(t.id)
    if (p.estado === 'no_tocado') {
      nuevos.push({ temaId: t.id, riesgo: 100, motivo: 'nuevo' })
    } else if (estaVencido(p, ref) || p.estado === 'oxidado') {
      vencidos.push({
        temaId: t.id,
        riesgo: riesgo(p, ref),
        motivo: p.estado === 'oxidado' ? 'oxidado' : 'vencido',
      })
    }
  }

  vencidos.sort((a, b) => b.riesgo - a.riesgo)
  const cupo = Math.max(1, ajustes.metaCantesDia)
  const cola: { temaId: string; riesgo: number; motivo: 'vencido' | 'nuevo' | 'oxidado' }[] = [
    ...vencidos.slice(0, cupo),
  ]
  // Solo se sugiere tema nuevo si el arrastre del día está bajo control.
  if (vencidos.length < cupo) {
    cola.push(...nuevos.slice(0, cupo - vencidos.length))
  }
  return cola
}

/**
 * Previsión de carga: cuántos repasos caen cada día en las próximas N semanas.
 * Alimenta el gráfico que evita el "muro de repasos" antes del examen.
 */
export function previsionCarga(
  progreso: Record<string, ProgresoTema>,
  dias = 42,
  ref = hoy(),
): { fecha: string; cantidad: number }[] {
  const conteo = new Map<string, number>()
  for (let i = 0; i < dias; i++) conteo.set(addDays(ref, i), 0)
  for (const p of Object.values(progreso)) {
    if (!p.proximaRevision) continue
    const d = diffDays(ref, p.proximaRevision)
    const clave = d < 0 ? ref : p.proximaRevision
    if (conteo.has(clave)) conteo.set(clave, (conteo.get(clave) ?? 0) + 1)
  }
  return [...conteo.entries()].map(([fecha, cantidad]) => ({ fecha, cantidad }))
}

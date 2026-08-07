import type { Recurrencia, Tarea } from './types'
import { addDays, diffDays, parseIso } from './dates'

/** Describe la recurrencia en lenguaje natural para la UI. */
export function describirRecurrencia(r: Recurrencia): string {
  const nombres = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados']
  switch (r.tipo) {
    case 'ninguna':
      return 'Una sola vez'
    case 'diaria':
      return r.cada === 1 ? 'Todos los días' : `Cada ${r.cada} días`
    case 'dias_laborables':
      return 'De lunes a viernes'
    case 'semanal': {
      const dias = [...r.dias].sort().map((d) => nombres[d])
      const lista =
        dias.length === 0
          ? 'semanalmente'
          : dias.length === 1
            ? dias[0]
            : `${dias.slice(0, -1).join(', ')} y ${dias[dias.length - 1]}`
      return r.cada === 1 ? `Todos los ${lista}` : `Cada ${r.cada} semanas: ${lista}`
    }
    case 'mensual':
      return r.cada === 1 ? `El día ${r.diaMes} de cada mes` : `El día ${r.diaMes} cada ${r.cada} meses`
  }
}

/** ¿Cae esta tarea en esta fecha concreta? Cálculo O(1), sin expandir la serie. */
export function ocurreEn(tarea: Tarea, fecha: string): boolean {
  if (tarea.archivada) return false
  if (fecha < tarea.fecha) return false
  if (tarea.hasta && fecha > tarea.hasta) return false

  const r = tarea.recurrencia
  switch (r.tipo) {
    case 'ninguna':
      return fecha === tarea.fecha
    case 'diaria': {
      const cada = Math.max(1, r.cada)
      return diffDays(tarea.fecha, fecha) % cada === 0
    }
    case 'dias_laborables': {
      const dow = parseIso(fecha).getDay()
      return dow >= 1 && dow <= 5
    }
    case 'semanal': {
      const cada = Math.max(1, r.cada)
      const dow = parseIso(fecha).getDay()
      const dias = r.dias.length ? r.dias : [parseIso(tarea.fecha).getDay()]
      if (!dias.includes(dow)) return false
      // Alineamos por semanas completas desde el lunes de la primera ocurrencia.
      const semanas = Math.floor(diffDays(alinearLunes(tarea.fecha), fecha) / 7)
      return semanas >= 0 && semanas % cada === 0
    }
    case 'mensual': {
      const cada = Math.max(1, r.cada)
      const d = parseIso(fecha)
      const inicio = parseIso(tarea.fecha)
      const ultimoDiaMes = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      const objetivo = Math.min(r.diaMes, ultimoDiaMes)
      if (d.getDate() !== objetivo) return false
      const meses =
        (d.getFullYear() - inicio.getFullYear()) * 12 + (d.getMonth() - inicio.getMonth())
      return meses >= 0 && meses % cada === 0
    }
  }
}

function alinearLunes(fecha: string): string {
  const dow = (parseIso(fecha).getDay() + 6) % 7
  return addDays(fecha, -dow)
}

export function tareasDe(tareas: Tarea[], fecha: string): Tarea[] {
  return tareas.filter((t) => ocurreEn(t, fecha))
}

export function estaCompletada(tarea: Tarea, fecha: string): boolean {
  return tarea.completadas.includes(fecha)
}

export function estaSaltada(tarea: Tarea, fecha: string): boolean {
  return tarea.saltadas.includes(fecha)
}

/** Próximas N ocurrencias a partir de una fecha. Para vistas de agenda. */
export function proximasOcurrencias(tarea: Tarea, desde: string, n = 5, horizonte = 400): string[] {
  const out: string[] = []
  for (let i = 0; i < horizonte && out.length < n; i++) {
    const f = addDays(desde, i)
    if (ocurreEn(tarea, f)) out.push(f)
  }
  return out
}

/** Minutos planificados en un día concreto (excluye completadas y saltadas). */
export function cargaPlanificada(tareas: Tarea[], fecha: string): number {
  return tareasDe(tareas, fecha)
    .filter((t) => !estaCompletada(t, fecha) && !estaSaltada(t, fecha))
    .reduce((acc, t) => acc + (t.duracionEstim ?? 0), 0)
}

/**
 * Botón de pánico: reparte las tareas NO recurrentes pendientes de un día entre
 * los siguientes días hábiles, respetando un tope de minutos por día.
 * Devuelve las tareas ya con su nueva fecha (no muta las originales).
 */
export function reprogramarDia(
  tareas: Tarea[],
  desde: string,
  opts: { topeMinutosDia: number; diasDisponibles?: number[]; horizonte?: number },
): { cambios: { id: string; nuevaFecha: string }[]; noReubicadas: string[] } {
  const pendientes = tareasDe(tareas, desde).filter(
    (t) =>
      t.recurrencia.tipo === 'ninguna' && !estaCompletada(t, desde) && !estaSaltada(t, desde),
  )
  const habiles = opts.diasDisponibles ?? [1, 2, 3, 4, 5, 6]
  const horizonte = opts.horizonte ?? 21

  // Carga ya comprometida en cada día futuro.
  const carga = new Map<string, number>()
  for (let i = 1; i <= horizonte; i++) {
    const f = addDays(desde, i)
    carga.set(f, cargaPlanificada(tareas, f))
  }

  const cambios: { id: string; nuevaFecha: string }[] = []
  const noReubicadas: string[] = []
  // Las más largas primero: encajan mejor (first-fit decreasing).
  const orden = [...pendientes].sort((a, b) => (b.duracionEstim ?? 0) - (a.duracionEstim ?? 0))

  for (const t of orden) {
    const dur = t.duracionEstim ?? 45
    let colocada = false
    for (let i = 1; i <= horizonte; i++) {
      const f = addDays(desde, i)
      if (!habiles.includes(parseIso(f).getDay())) continue
      const actual = carga.get(f) ?? 0
      if (actual + dur <= opts.topeMinutosDia) {
        carga.set(f, actual + dur)
        cambios.push({ id: t.id, nuevaFecha: f })
        colocada = true
        break
      }
    }
    if (!colocada) noReubicadas.push(t.id)
  }

  return { cambios, noReubicadas }
}

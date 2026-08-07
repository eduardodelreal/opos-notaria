import type { Ajustes, AppData } from './types'
import { PROGRAMA } from '@/data/programa'
import { hoy } from './dates'

export const DATA_VERSION = 1

export const AJUSTES_DEFAULT: Ajustes = {
  nombre: 'Opositor',
  oposicion: 'notarias',
  fechaInicio: hoy(),
  fechaExamen: null,
  objetivoCanteSegundos: 12 * 60,
  objetivoEjercicioSegundos: 60 * 60,
  temasPorEjercicio: 4,
  metaHorasDia: 9,
  metaCantesDia: 3,
  metaCantesSemana: 18,
  preparadorNombre: '',
  diaPreparador: 2, // martes
  grabarAudio: true,
  avisoSonoro: true,
  modoCiegoPorDefecto: false,
  factorSrs: 1,
  umbralOxido: 75,
}

export function datosVacios(overrides?: Partial<AppData>): AppData {
  return {
    version: DATA_VERSION,
    ajustes: { ...AJUSTES_DEFAULT },
    temas: PROGRAMA,
    progreso: {},
    cantes: [],
    sesiones: [],
    tareas: [],
    simulacros: [],
    diasCumplidos: [],
    logros: [],
    ...overrides,
  }
}

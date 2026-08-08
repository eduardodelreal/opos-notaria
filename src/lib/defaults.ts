import type { Ajustes, AppData } from './types'
import { hoy } from './dates'

export const DATA_VERSION = 2

export const AJUSTES_DEFAULT: Ajustes = {
  nombre: '',
  configurado: false,
  oposicion: 'notarias',
  fechaInicio: hoy(),
  fechaExamen: null,
  objetivoCanteSegundos: 12 * 60,
  objetivoEjercicioSegundos: 60 * 60,
  temasPorEjercicio: 4,
  metaHorasDia: 8,
  metaCantesDia: 3,
  metaCantesSemana: 18,
  preparadorNombre: '',
  diaPreparador: null,
  grabarAudio: true,
  avisoSonoro: true,
  modoCiegoPorDefecto: false,
  factorSrs: 1,
  umbralOxido: 75,
}

/**
 * Estado inicial: completamente vacío.
 * Ni materias, ni temas, ni tareas. El opositor lo construye a su ritmo,
 * según se lo van dando en la academia.
 */
export function datosVacios(overrides?: Partial<AppData>): AppData {
  return {
    version: DATA_VERSION,
    ajustes: { ...AJUSTES_DEFAULT },
    bloques: [],
    temas: [],
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

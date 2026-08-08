/** Modelo de dominio de la app. Vocabulario del opositor, no genérico. */

/**
 * Todo el contenido lo crea el opositor: sus materias, sus temas, sus tareas.
 * La app no trae ningún programa impuesto — en la academia cada preparador
 * numera y agrupa a su manera, y un catálogo cerrado obligaría a pelearse con
 * él desde el primer día.
 */

/** Id de materia. Slug generado a partir del nombre que escriba el usuario. */
export type BlockId = string

export interface Block {
  id: BlockId
  nombre: string
  /** Ejercicio del examen en el que entra esta materia. */
  ejercicio: 1 | 2 | 3 | 4
  color: string
  colorSoft: string
  colorText: string
  /** Posición en la lista. */
  orden: number
}

export interface Tema {
  id: string
  /** Id de la materia a la que pertenece. */
  bloque: BlockId
  numero: number
  titulo: string
  /** Marcado como fuera de programa: no cuenta en progreso ni entra en el bombo. */
  excluido?: boolean
  /** Epígrafes opcionales para el modo "cante por epígrafes". */
  epigrafes?: string[]
  /** Fecha ISO en que se añadió: sirve para ver el ritmo al que crece el programa. */
  creadoEn?: string
}

export type EstadoTema =
  | 'no_tocado'
  | 'primera_vuelta'
  | 'en_arrastre'
  | 'dominado'
  | 'oxidado'

export interface ProgresoTema {
  temaId: string
  estado: EstadoTema
  vueltas: number
  /** Días de intervalo actual del SRS. */
  intervalo: number
  /** Facilidad acumulada (estilo SM-2, adaptado). 1.3 – 3.0 */
  facilidad: number
  ultimoCante: string | null // ISO date
  proximaRevision: string | null // ISO date
  /** Nota media ponderada de los últimos cantes (0-10). */
  notaMedia: number | null
  /** Minutos totales de estudio acumulados en este tema. */
  minutosEstudio: number
  /** Fijado por el usuario como prioritario. */
  prioritario?: boolean
  notas?: string
}

export type Calificacion = 1 | 2 | 3 | 4 | 5

export interface Cante {
  id: string
  temaId: string
  fecha: string // ISO datetime
  duracionSegundos: number
  /** Objetivo de tiempo vigente cuando se cantó (para calcular el ratio). */
  objetivoSegundos: number
  /** Autocalificación de contenido 1-5 (¿me lo sabía?). */
  calificacion: Calificacion
  /** Nota final 0-10 = contenido × ajuste por tiempo. */
  nota: number
  /** Nº de lagunas / veces que se quedó en blanco. */
  lagunas: number
  /** Cante hecho ante el preparador. */
  antePreparador: boolean
  comentarios?: string
  /** Ruta en Supabase Storage o clave en IndexedDB local. */
  audioPath?: string | null
  audioDuracion?: number
  /** Si formó parte de un simulacro, su id. */
  simulacroId?: string
}

export interface SesionEstudio {
  id: string
  temaId: string | null
  fecha: string
  minutos: number
  tipo: 'lectura' | 'esquema' | 'memorizacion' | 'dictamen' | 'otro'
  notas?: string
}

export type Recurrencia =
  | { tipo: 'ninguna' }
  | { tipo: 'diaria'; cada: number }
  | { tipo: 'semanal'; cada: number; dias: number[] } // 0=Dom … 6=Sáb
  | { tipo: 'mensual'; cada: number; diaMes: number }
  | { tipo: 'dias_laborables' }

export interface Tarea {
  id: string
  titulo: string
  /** Fecha de la primera aparición (ISO date). */
  fecha: string
  hora?: string | null
  /** Minutos estimados: alimenta la previsión de carga del día. */
  duracionEstim?: number
  recurrencia: Recurrencia
  /** Fecha en la que la serie deja de repetirse (ISO date). */
  hasta?: string | null
  categoria: 'cante' | 'estudio' | 'dictamen' | 'repaso' | 'preparador' | 'personal'
  temaId?: string | null
  bloqueId?: BlockId | null
  color?: string
  notas?: string
  /** Fechas ISO concretas en las que la ocurrencia se completó. */
  completadas: string[]
  /** Fechas ISO saltadas explícitamente (no rompen la racha). */
  saltadas: string[]
  archivada?: boolean
}

export interface Simulacro {
  id: string
  fecha: string
  /** Temas que salieron del bombo. */
  temaIds: string[]
  /** Segundos totales del ejercicio. */
  duracionTotal: number
  notaMedia: number
  completado: boolean
}

export interface Ajustes {
  nombre: string
  /** El usuario ya ha pasado por la pantalla de bienvenida. */
  configurado?: boolean
  oposicion: 'notarias' | 'registros' | 'judicatura'
  fechaInicio: string
  /** Fecha estimada de la convocatoria. */
  fechaExamen: string | null
  /** Segundos objetivo por tema al cantar (Notarías: ~11-12 min). */
  objetivoCanteSegundos: number
  /** Segundos del ejercicio completo (4 temas × 15 min = 3600). */
  objetivoEjercicioSegundos: number
  temasPorEjercicio: number
  /** Objetivos diarios. */
  metaHorasDia: number
  metaCantesDia: number
  metaCantesSemana: number
  /** Preparador. */
  preparadorNombre: string
  diaPreparador: number | null // 0-6
  /** Preferencias de UI. */
  grabarAudio: boolean
  avisoSonoro: boolean
  modoCiegoPorDefecto: boolean
  /** Agresividad del SRS: 0.8 = intervalos más cortos (más repaso). */
  factorSrs: number
  /** Días sin cantar tras los que un tema dominado se marca "oxidado". */
  umbralOxido: number
}

export interface AppData {
  version: number
  ajustes: Ajustes
  /** Materias del programa, creadas por el usuario. */
  bloques: Block[]
  temas: Tema[]
  progreso: Record<string, ProgresoTema>
  cantes: Cante[]
  sesiones: SesionEstudio[]
  tareas: Tarea[]
  simulacros: Simulacro[]
  /** Racha: fechas ISO con objetivo mínimo cumplido. */
  diasCumplidos: string[]
  logros: string[]
}

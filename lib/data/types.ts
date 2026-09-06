/**
 * Modelo de dominio de opos-notaria.
 *
 * Todo cuelga del epígrafe, no del tema: los cantes, los fallos y las
 * horas se agregan hacia arriba. Eso es lo que permite decirle al
 * opositor "siempre fallas el epígrafe 3 del tema 47" en vez de
 * "el tema 47 se te da mal".
 *
 * Convenios que impone la sincronización (docs/sincronizacion.md):
 *
 *   · Los ids son uuid v4 generados en el cliente (lib/utils/id.ts).
 *   · `creado` y `actualizado` son los equivalentes locales de las columnas
 *     `creado_at` y `updated_at` del esquema. `actualizado` es el reloj del
 *     last-write-wins: se toca en cada edición y no se duplica con ningún
 *     otro campo que diga lo mismo.
 *   · Lo que se puede derivar de una colección append-only NO es un dato,
 *     es caché. Ver lib/data/derivados.ts.
 */

export type EstadoTema =
  | "nuevo"
  | "estudiando"
  | "cantable"
  | "dominado"
  | "oxidado";

export const ESTADOS: {
  id: EstadoTema;
  label: string;
  color: string;
  desc: string;
}[] = [
  {
    id: "nuevo",
    label: "Sin empezar",
    color: "var(--st-nuevo)",
    desc: "Aún no lo has tocado",
  },
  {
    id: "estudiando",
    label: "Estudiando",
    color: "var(--st-estudiando)",
    desc: "En primera lectura o comprensión",
  },
  {
    id: "cantable",
    label: "Cantable",
    color: "var(--st-cantable)",
    desc: "Lo puedes cantar entero, con fallos",
  },
  {
    id: "dominado",
    label: "Dominado",
    color: "var(--st-dominado)",
    desc: "Cante limpio y dentro de tiempo",
  },
  {
    id: "oxidado",
    label: "Oxidado",
    color: "var(--st-oxidado)",
    desc: "Lo dominaste, pero hace demasiado que no lo tocas",
  },
];

export type TipoFallo = "laguna" | "titubeo" | "orden" | "dato";

export const FALLOS: {
  id: TipoFallo;
  label: string;
  tecla: string;
  desc: string;
}[] = [
  { id: "laguna", label: "Laguna", tecla: "1", desc: "Te has quedado en blanco" },
  { id: "titubeo", label: "Titubeo", tecla: "2", desc: "Has dudado o repetido" },
  { id: "orden", label: "Orden", tecla: "3", desc: "Has alterado el orden" },
  { id: "dato", label: "Dato", tecla: "4", desc: "Artículo o cifra incorrecta" },
];

export type TipoSesion = "estudio" | "repaso" | "cante";

export interface Materia {
  id: string;
  nombre: string;
  abrev: string;
  color: string;
  /** Ejercicio de la oposición en el que entra esta materia. */
  ejercicio: 1 | 2 | 3 | 4;
  descripcion: string;
  /**
   * Posición en la barra lateral y en el mural. Es un campo y no la posición
   * en el array porque un array no sobrevive a una tabla: sin esto el orden
   * de las materias bailaría entre dispositivos.
   */
  orden: number;
}

export interface Epigrafe {
  id: string;
  orden: number;
  titulo: string;
  /** Texto del epígrafe tal y como lo estudia el opositor. */
  texto?: string;
  creado: number;
  /** Reloj del last-write-wins (`updated_at`). Lo toca cualquier edición. */
  actualizado: number;
}

/**
 * Epígrafe borrado en local. Es una tumba, no un dato: los epígrafes son
 * filas propias en el servidor, así que borrar uno tiene que poder viajar.
 * Si solo lo quitáramos del array, el otro dispositivo no se enteraría nunca
 * (no hay fila que bajar) y lo resucitaría en el siguiente pull.
 */
export interface EpigrafeBorrado {
  id: string;
  temaId: string;
  borrado: number;
}

export interface Tema {
  id: string;
  materiaId: string;
  numero: number;
  titulo: string;
  epigrafes: Epigrafe[];
  /** true si lo ha creado el usuario y no viene del programa base. */
  propio?: boolean;
}

/** Punto clave: dato suelto que se cae siempre (artículo, plazo, requisito). */
export interface KeyPoint {
  id: string;
  temaId: string;
  epigrafeId?: string;
  anverso: string;
  reverso: string;
  creado: number;
  /** Repaso espaciado ligero para los keypoints. */
  aciertos: number;
  fallos: number;
  proximoRepaso: number;
  intervaloDias: number;
}

export interface Nota {
  id: string;
  temaId: string;
  epigrafeId?: string;
  texto: string;
  creado: number;
  /** Reloj del last-write-wins (`updated_at`), igual que en Epigrafe. */
  actualizado: number;
}

/**
 * Transición de un tema a "dominado". Colección append-only: es la fuente
 * de la que sale `ProgresoTema.vueltas`.
 *
 * Existe porque un contador no se puede reconstruir tras un conflicto: si
 * cierras vuelta de un tema en el portátil y otra en el móvil sin
 * sincronizar entre medias, el last-write-wins se queda con el contador de
 * uno de los dos y la otra vuelta desaparece sin dejar rastro. Con un
 * registro por vuelta la cuenta se recompone sumando filas, que es lo que
 * el append-only sí sabe hacer.
 */
export interface Vuelta {
  id: string;
  temaId: string;
  fecha: number;
}

export interface ProgresoTema {
  temaId: string;
  estado: EstadoTema;
  /**
   * CACHÉ. Segundos efectivos acumulados (estudio + repaso + cante).
   * La verdad está en `sesiones`, que es append-only y por tanto no tiene
   * conflicto; este campo solo evita agregar en cada render. Para leerlo
   * usa lib/data/derivados.ts, nunca el valor crudo.
   */
  segundos: number;
  /** Dificultad percibida 1-5. Alimenta el intervalo de repaso. */
  dificultad: number;
  /** CACHÉ. Número de registros en `vueltas` de este tema. */
  vueltas: number;
  ultimoEstudio?: number;
  ultimoCante?: number;
  /** CACHÉ. Media de las notas de cante (0-10). La verdad está en `cantes`. */
  notaMedia?: number;
  /** Calculado por el SRS: cuándo toca repasarlo. */
  proximoRepaso?: number;
  favorito?: boolean;
}

export interface Sesion {
  id: string;
  temaId?: string;
  tipo: TipoSesion;
  inicio: number;
  fin: number;
  /** Segundos efectivos: descuenta las pausas y la inactividad. */
  segundos: number;
  nota?: string;
}

export interface CanteEpigrafe {
  epigrafeId: string;
  titulo: string;
  segundos: number;
  fallos: TipoFallo[];
}

export interface AnalisisCante {
  /** Veredicto en una frase. */
  titular: string;
  diagnostico: string;
  fortalezas: string[];
  mejoras: { que: string; como: string; prioridad: "alta" | "media" | "baja" }[];
  focoProximaSesion: string;
  /** Epígrafes concretos que el modelo marca como críticos. */
  epigrafesCriticos: string[];
  generado: number;
  modelo: string;
}

export interface Cante {
  id: string;
  temaId: string;
  fecha: number;
  segundos: number;
  epigrafes: CanteEpigrafe[];
  /** 0-10. Del preparador si lo hubo, o autoevaluación. */
  nota?: number;
  conPreparador: boolean;
  feedback?: string;
  analisis?: AnalisisCante;
}

export type TipoSimulacro = "cante" | "dictamen";

export interface Simulacro {
  id: string;
  tipo: TipoSimulacro;
  fecha: number;
  /** Temas que salieron en el sorteo. */
  temaIds: string[];
  /** Minutos totales concedidos. */
  minutos: number;
  segundosUsados: number;
  /** Nota por tema, en el mismo orden que temaIds. */
  notas: (number | null)[];
  supuesto?: string;
  respuesta?: string;
  correccion?: string;
  completado: boolean;
}

export interface MensajeChat {
  id: string;
  rol: "user" | "assistant";
  texto: string;
  creado: number;
  /** Contexto que se le inyectó al modelo en este turno. */
  contexto?: string;
}

export interface Perfil {
  nombre: string;
  oposicion: "notarias" | "registros" | "judicatura";
  fechaInicio: number;
  /** ISO date del examen objetivo, si lo tiene. */
  fechaExamen?: string;
  preparador?: string;
  objetivoHorasSemana: number;
  /** Minutos que da el tribunal por tema en el cante. */
  minutosPorTema: number;
  /** Días sin tocar un tema dominado antes de marcarlo oxidado. */
  diasOxido: number;
  tema: "dark" | "light";
  /** Estilo del feedback de la IA. Se inyecta en el system prompt. */
  estiloFeedback: "directo" | "equilibrado" | "amable";
}

/**
 * Modelo de dominio de opos-notaria.
 *
 * Todo cuelga del epígrafe, no del tema: los cantes, los fallos y las
 * horas se agregan hacia arriba. Eso es lo que permite decirle al
 * opositor "siempre fallas el epígrafe 3 del tema 47" en vez de
 * "el tema 47 se te da mal".
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
}

export interface Epigrafe {
  id: string;
  orden: number;
  titulo: string;
  /** Texto del epígrafe tal y como lo estudia el opositor. */
  texto?: string;
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
  actualizado: number;
}

export interface ProgresoTema {
  temaId: string;
  estado: EstadoTema;
  /** Segundos efectivos acumulados (estudio + repaso + cante). */
  segundos: number;
  /** Dificultad percibida 1-5. Alimenta el intervalo de repaso. */
  dificultad: number;
  vueltas: number;
  ultimoEstudio?: number;
  ultimoCante?: number;
  /** Media móvil de las notas de cante (0-10). */
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

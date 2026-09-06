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
 *     otro campo que diga lo mismo. Lo pone el sellado automático del store
 *     (lib/store/sellado.ts), no cada acción a mano.
 *   · `borrado` es el equivalente local de `deleted_at`: una fila con
 *     `borrado` es una tumba, no un dato. Nada de la app la lee (todas las
 *     lecturas pasan por lib/data/vivos.ts) pero sigue en IndexedDB porque
 *     es lo único que puede viajar: un borrado físico no deja rastro que
 *     bajar al otro dispositivo, y la fila resucitaría en el siguiente pull.
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
  /** Reloj del last-write-wins (`updated_at`). */
  actualizado: number;
  /** Tumba (`deleted_at`). Cascada: arrastra los temas de la materia. */
  borrado?: number;
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
  /**
   * Tumba (`deleted_at`). El epígrafe borrado se queda en el array del tema
   * en vez de desaparecer: en el servidor es una fila propia y la tumba
   * tiene que llevar su `id` y su `actualizado` para poder empujarse.
   */
  borrado?: number;
}

export interface Tema {
  id: string;
  materiaId: string;
  numero: number;
  titulo: string;
  epigrafes: Epigrafe[];
  /** true si lo ha creado el usuario y no viene del programa base. */
  propio?: boolean;
  /** Reloj del last-write-wins (`updated_at`). */
  actualizado: number;
  /**
   * Tumba (`deleted_at`). Cascada: arrastra epígrafes, progreso, cantes,
   * keypoints, notas y vueltas. Las sesiones NO: haber borrado el tema del
   * programa no borra las horas que el opositor le echó.
   */
  borrado?: number;
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
  /** Reloj del last-write-wins (`updated_at`). Cada respuesta lo mueve. */
  actualizado: number;
  /** Tumba (`deleted_at`). */
  borrado?: number;
}

export interface Nota {
  id: string;
  temaId: string;
  epigrafeId?: string;
  texto: string;
  creado: number;
  /** Reloj del last-write-wins (`updated_at`), igual que en Epigrafe. */
  actualizado: number;
  /** Tumba (`deleted_at`). */
  borrado?: number;
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
  /**
   * Reloj del last-write-wins (`updated_at`). Una vuelta no se edita nunca,
   * pero sí se entierra, y la tumba necesita reloj para poder empujarse.
   */
  actualizado: number;
  /** Tumba (`deleted_at`). La cascada del tema las entierra. */
  borrado?: number;
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
  /** Reloj del last-write-wins (`updated_at`). */
  actualizado: number;
  /** Tumba (`deleted_at`). La pone la cascada al borrar el tema. */
  borrado?: number;
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

/* --------------------------- grabación del cante -------------------------- */

/**
 * Marca temporal de un epígrafe dentro de la grabación.
 *
 * Se anota EN VIVO, al pasar de epígrafe, con un simple `Date.now()`: es lo
 * único que permite luego partir la transcripción por epígrafes y saltar en
 * el reproductor al minuto exacto en el que se recitó cada uno. Sin esto la
 * comparación con el temario solo podría hablar del tema entero, que es
 * justo el nivel de detalle que no sirve para nada (docs/decisiones.md §2).
 */
export interface MarcaEpigrafe {
  epigrafeId: string;
  titulo: string;
  /** Milisegundos desde el inicio de la grabación. */
  desdeMs: number;
  hastaMs: number;
}

/**
 * Metadatos de la grabación de un cante. **El binario no está aquí.**
 *
 * El audio pesa megas y el store se serializa entero en cada escritura
 * (zustand/persist): meter el blob aquí convertiría cada tecla marcada
 * durante un cante en una escritura de varios megabytes a IndexedDB. El
 * binario vive en su propio almacén (`lib/audio/almacen.ts`), indexado por
 * el id del cante, y esto es solo la ficha que sí viaja con la fila.
 */
export interface AudioCante {
  /**
   * Ruta dentro del bucket privado `cantes-audio`, con el convenio
   * `<usuario_id>/<cante_id>.<ext>` del que depende toda la seguridad de
   * Storage (db/migrations/0002_storage_audio.sql). Es `undefined` mientras
   * no haya sesión: sin `usuario_id` la ruta no se puede componer, y la
   * grabación se queda perfectamente utilizable en local.
   */
  path?: string;
  mime?: string;
  bytes?: number;
  segundos?: number;
  /** Momento en que el binario quedó confirmado en Storage. */
  subido?: number;
  /** Índice de epígrafes dentro del audio. */
  marcas?: MarcaEpigrafe[];
}

/**
 * Transcripción del cante.
 *
 * OJO: la Messages API de Anthropic **no acepta audio** (solo texto,
 * imágenes y PDF), así que esto no lo produce el mismo modelo que el resto
 * de la IA de la app. Lo genera un servicio de transcripción aparte,
 * configurable, y por eso guarda de qué proveedor viene (ver docs/ia.md).
 */
export interface TranscripcionCante {
  texto: string;
  /** Proveedor y modelo que la generaron, p. ej. "openai/whisper-1". */
  motor: string;
  generado: number;
  /** Segundos de audio transcritos, si el proveedor los informa. */
  segundos?: number;
}

export type TipoOmision =
  | "articulo"
  | "requisito"
  | "clasificacion"
  | "plazo"
  | "concepto"
  | "epigrafe";

/** Una cosa del temario que no aparece en lo que el opositor recitó. */
export interface OmisionCante {
  /** Título del epígrafe donde falta. */
  epigrafe: string;
  tipo: TipoOmision;
  /** Qué falta, dicho en una línea. */
  falta: string;
  /** Fragmento del texto del tema que lo respalda. Sin inventar. */
  cita?: string;
  gravedad: "alta" | "media" | "baja";
}

/**
 * Resultado de comparar la transcripción con el texto del tema.
 *
 * Es el diferencial del producto: en vez de "has fallado el epígrafe 3",
 * dice negro sobre blanco QUÉ se saltó — el artículo que no citó, el cuarto
 * requisito de la lista, la excepción que se comió.
 */
export interface ComparacionCante {
  titular: string;
  /** 0-100: cuánto del contenido del tema aparece de verdad en el cante. */
  cobertura: number;
  omisiones: OmisionCante[];
  /** Cosas dichas que no están en el temario (posible dato inventado). */
  dichoDeMas: string[];
  /** Epígrafes recitados de memoria pero incompletos. */
  epigrafesIncompletos: { epigrafe: string; cobertura: number; nota: string }[];
  /** Veredicto sobre la literalidad: cuánto se ciñe al texto estudiado. */
  literalidad: string;
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
  /**
   * Grabación del cante, si la hubo. Solo la ficha: el binario vive en
   * `lib/audio/almacen.ts`. De todo esto la única columna que existe en el
   * servidor es `cantes.audio_path` (0001), así que es lo único que viaja.
   */
  audio?: AudioCante;
  /**
   * Transcripción y comparación con el texto del tema. **No sincronizan**:
   * el esquema no tiene columnas para ellas y las migraciones están
   * cerradas. Quedan en el dispositivo que las generó; el audio sí sube, así
   * que en otro aparato se pueden volver a generar desde la grabación. Ver
   * docs/sincronizacion.md §8.
   */
  transcripcion?: TranscripcionCante;
  comparacion?: ComparacionCante;
  /** Reloj del last-write-wins (`updated_at`): nota, feedback y análisis. */
  actualizado: number;
  /** Tumba (`deleted_at`). */
  borrado?: number;
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
  /** Reloj del last-write-wins (`updated_at`): la corrección lo mueve. */
  actualizado: number;
  /** Tumba (`deleted_at`). */
  borrado?: number;
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

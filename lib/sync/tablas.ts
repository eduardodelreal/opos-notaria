import type {
  AnalisisCante,
  Cante,
  CanteEpigrafe,
  ComparacionCante,
  Epigrafe,
  EstadoTema,
  KeyPoint,
  Materia,
  Nota,
  Perfil,
  ProgresoTema,
  Sesion,
  Simulacro,
  Tema,
  TipoSesion,
  TipoSimulacro,
  TranscripcionCante,
  Vuelta,
} from "../data/types";
import { normalizarPerfil } from "../data/perfil";
import { acotarTamanoTema } from "../data/apariencia";

/* ============================================================
   El único sitio donde el dominio se convierte en columnas

   El modelo local está en camelCase y en milisegundos (`materiaId`,
   `actualizado: 1757...`); el esquema está en snake_case y en timestamptz
   (`materia_id`, `updated_at`). Ese doblez tiene que ocurrir en un único
   fichero y con tipos, porque el modo en que falla si se reparte es el
   peor posible: `materiaId` no es una columna, PostgREST lo rechaza o —
   con un `select` mal escrito— devuelve `undefined` en silencio, y el
   opositor descubre el problema cuando le falta un tema.

   Cada tabla declara su fila EXACTAMENTE como está en db/migrations/, y
   los conversores devuelven ese tipo. Renombrar una columna en el SQL sin
   tocar esto rompe `tsc`, que es donde queremos que se note, y no la
   sincronización de alguien a las once de la noche.

   Lo que NO se mapea, y por qué:
     · `creado_at` solo se envía en las entidades que llevan `creado` en el
       dominio. En las demás lo pone el default de la tabla en el insert, y
       al no ir en el payload el `do update` del upsert no lo toca: se
       escribe una vez y no se mueve más, que es el contrato.
     · `cantes.audio_path` SÍ viaja (docs/sincronizacion.md §8), pero solo la
       ruta: el binario sube por su cuenta a Storage (lib/audio/subida.ts) y
       nunca por esta tabla. La ruta se manda tal cual la tiene el cliente;
       como es determinista (`<uid>/<cante_id>.<ext>`), los dos dispositivos
       calculan la misma y el upsert no la pisa con otra distinta.
     · `Cante.transcripcion` y `Cante.comparacion` SÍ viajan desde 0005.
       Antes no tenían columna y se quedaban en el aparato que las generó:
       como el audio sube igual, en otro dispositivo se regeneraban, y eso
       es pagar otra vez la transcripción del cante entero y la llamada al
       modelo. Lo que la fusión sigue conservando es el hueco: un cante que
       gana el arbitraje SIN transcripción no borra la que hay en local
       (lib/sync/fusion.ts), porque estos dos campos solo van de ausente a
       presente y nadie los vacía a propósito.
     · las columnas de avisos de `perfiles` (0003) tampoco viajan aquí, por
       lo mismo: no están en el dominio y el upsert parcial las respeta.
   ============================================================ */

/**
 * Las tablas que sincroniza el cliente, EN ORDEN DE CLAVE AJENA.
 *
 * El push las recorre en este orden porque subir un epígrafe cuyo tema
 * todavía no está arriba es una violación de FK (§3.1). El pull usa el
 * mismo orden por un motivo distinto: los epígrafes se reanidan dentro de
 * su tema, así que el tema tiene que haber aterrizado antes.
 */
export const TABLAS = [
  "perfiles",
  "materias",
  "temas",
  "epigrafes",
  "progreso_temas",
  "sesiones",
  "cantes",
  "keypoints",
  "notas",
  "simulacros",
  "vueltas",
] as const;

export type Tabla = (typeof TABLAS)[number];

/** Columna sobre la que resuelve el conflicto el upsert de cada tabla. */
export const CONFLICTO: Record<Tabla, string> = {
  perfiles: "id",
  materias: "id",
  temas: "id",
  epigrafes: "id",
  // `progreso_temas` no tiene id propio: hay uno por tema y su PK es el tema.
  progreso_temas: "tema_id",
  sesiones: "id",
  cantes: "id",
  keypoints: "id",
  notas: "id",
  simulacros: "id",
  vueltas: "id",
};

/* ---------------------------------------------------------------- filas -- */

/** Las tres columnas de sincronización que lleva toda tabla (§2). */
interface Sincronizable {
  updated_at: string;
  deleted_at: string | null;
}

export interface FilaPerfil extends Sincronizable {
  id: string;
  nombre: string;
  oposicion: Perfil["oposicion"];
  fecha_inicio: string;
  fecha_examen: string | null;
  preparador: string | null;
  objetivo_horas_semana: number;
  minutos_por_tema: number;
  dias_oxido: number;
  tema: Perfil["tema"];
  estilo_feedback: Perfil["estiloFeedback"];
  /* --- apariencia y hábitos (0006) --- */
  acento: Perfil["acento"];
  /** `#rrggbb` del acento libre. `null` mientras el acento no sea el suyo. */
  acento_personal: string | null;
  fuente_temas: Perfil["fuenteTemas"];
  tamano_tema: number;
  densidad: Perfil["densidad"];
  orden_temas: Perfil["ordenTemas"];
  vista_programa: Perfil["vistaPrograma"];
}

export interface FilaMateria extends Sincronizable {
  id: string;
  usuario_id: string;
  nombre: string;
  abrev: string;
  color: string;
  ejercicio: number;
  descripcion: string;
  orden: number;
}

export interface FilaTema extends Sincronizable {
  id: string;
  usuario_id: string;
  materia_id: string;
  numero: number;
  titulo: string;
  propio: boolean;
}

export interface FilaEpigrafe extends Sincronizable {
  id: string;
  usuario_id: string;
  tema_id: string;
  orden: number;
  titulo: string;
  texto: string | null;
  creado_at: string;
}

export interface FilaProgreso extends Sincronizable {
  tema_id: string;
  usuario_id: string;
  estado: EstadoTema;
  segundos: number;
  dificultad: number;
  vueltas: number;
  ultimo_estudio: string | null;
  ultimo_cante: string | null;
  nota_media: number | null;
  proximo_repaso: string | null;
  favorito: boolean;
}

export interface FilaSesion extends Sincronizable {
  id: string;
  usuario_id: string;
  tema_id: string | null;
  tipo: TipoSesion;
  inicio: string;
  fin: string;
  segundos: number;
  nota: string | null;
}

export interface FilaCante extends Sincronizable {
  id: string;
  usuario_id: string;
  tema_id: string;
  fecha: string;
  segundos: number;
  epigrafes: CanteEpigrafe[];
  nota: number | null;
  con_preparador: boolean;
  feedback: string | null;
  analisis: AnalisisCante | null;
  /** Ruta en el bucket `cantes-audio`. Solo la ruta (0001, 0002). */
  audio_path: string | null;
  /** Transcripción del audio (0005). */
  transcripcion: TranscripcionCante | null;
  /** Comparación de la transcripción con el texto del tema (0005). */
  comparacion: ComparacionCante | null;
}

export interface FilaKeyPoint extends Sincronizable {
  id: string;
  usuario_id: string;
  tema_id: string;
  epigrafe_id: string | null;
  anverso: string;
  reverso: string;
  aciertos: number;
  fallos: number;
  intervalo_dias: number;
  proximo_repaso: string;
  creado_at: string;
}

export interface FilaNota extends Sincronizable {
  id: string;
  usuario_id: string;
  tema_id: string;
  epigrafe_id: string | null;
  texto: string;
  creado_at: string;
}

export interface FilaSimulacro extends Sincronizable {
  id: string;
  usuario_id: string;
  tipo: TipoSimulacro;
  fecha: string;
  tema_ids: string[];
  minutos: number;
  segundos_usados: number;
  notas: (number | null)[];
  supuesto: string | null;
  respuesta: string | null;
  correccion: string | null;
  completado: boolean;
}

export interface FilaVuelta extends Sincronizable {
  id: string;
  usuario_id: string;
  tema_id: string;
  fecha: string;
}

/** Cualquier fila del esquema, para lo que es común a todas. */
export type Fila =
  | FilaPerfil
  | FilaMateria
  | FilaTema
  | FilaEpigrafe
  | FilaProgreso
  | FilaSesion
  | FilaCante
  | FilaKeyPoint
  | FilaNota
  | FilaSimulacro
  | FilaVuelta;

/** Tipo de la fila de cada tabla. Lo usan el transporte y la fusión. */
export interface FilaDe {
  perfiles: FilaPerfil;
  materias: FilaMateria;
  temas: FilaTema;
  epigrafes: FilaEpigrafe;
  progreso_temas: FilaProgreso;
  sesiones: FilaSesion;
  cantes: FilaCante;
  keypoints: FilaKeyPoint;
  notas: FilaNota;
  simulacros: FilaSimulacro;
  vueltas: FilaVuelta;
}

/* ------------------------------------------------------------ conversión -- */

/** Milisegundos → timestamptz. */
export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** timestamptz → milisegundos. `null` sigue siendo `undefined` arriba. */
export function ms(valor: string | null | undefined): number | undefined {
  if (!valor) return undefined;
  const t = Date.parse(valor);
  return Number.isNaN(t) ? undefined : t;
}

/** El reloj del last-write-wins de una fila que baja, en milisegundos. */
export function relojFila(fila: Sincronizable): number {
  return ms(fila.updated_at) ?? 0;
}

/** Postgres devuelve `numeric` como número o como cadena según el driver. */
function num(valor: unknown): number | undefined {
  if (valor == null) return undefined;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : undefined;
}

/** `undefined` y cadena vacía son lo mismo para una columna de texto opcional. */
function texto(valor: string | undefined): string | null {
  return valor == null || valor === "" ? null : valor;
}

/* ------------------------------------------------------------- perfiles -- */

export function aFilaPerfil(
  perfil: Perfil,
  usuarioId: string,
  actualizado: number,
  borrado?: number,
): FilaPerfil {
  return {
    id: usuarioId,
    nombre: perfil.nombre,
    oposicion: perfil.oposicion,
    fecha_inicio: iso(perfil.fechaInicio),
    fecha_examen: texto(perfil.fechaExamen),
    preparador: texto(perfil.preparador),
    objetivo_horas_semana: perfil.objetivoHorasSemana,
    minutos_por_tema: perfil.minutosPorTema,
    dias_oxido: perfil.diasOxido,
    tema: perfil.tema,
    estilo_feedback: perfil.estiloFeedback,
    acento: "lacre",
    acento_personal: texto(perfil.acentoPersonal),
    fuente_temas: perfil.fuenteTemas,
    // El check de la columna es `between 15 and 24`: un cuerpo fuera de
    // rango reventaría el push entero, y una preferencia visual no vale una
    // sincronización. Se acota con la misma función que usa la interfaz.
    tamano_tema: acotarTamanoTema(perfil.tamanoTema),
    densidad: perfil.densidad,
    orden_temas: perfil.ordenTemas,
    vista_programa: perfil.vistaPrograma,
    updated_at: iso(actualizado),
    deleted_at: borrado == null ? null : iso(borrado),
  };
}

/**
 * La fila del servidor, de vuelta al dominio.
 *
 * Pasa por `normalizarPerfil` y no se construye a pelo porque una fila
 * escrita por una versión anterior a 0006 trae las columnas de apariencia a
 * null (o directamente no las trae, si el `select` viene de un cliente
 * viejo). Un `acento: null` llegaría al generador de paletas; con el
 * saneado se convierte en el acento de la casa, que es la app de siempre.
 */
export function deFilaPerfil(fila: FilaPerfil): Perfil {
  return normalizarPerfil({
    nombre: fila.nombre ?? "",
    oposicion: fila.oposicion,
    fechaInicio: ms(fila.fecha_inicio) ?? Date.now(),
    fechaExamen: fila.fecha_examen ?? undefined,
    preparador: fila.preparador ?? undefined,
    objetivoHorasSemana: fila.objetivo_horas_semana,
    minutosPorTema: fila.minutos_por_tema,
    diasOxido: fila.dias_oxido,
    tema: fila.tema,
    estiloFeedback: fila.estilo_feedback,
    acento: fila.acento,
    acentoPersonal: fila.acento_personal ?? undefined,
    fuenteTemas: fila.fuente_temas,
    tamanoTema: fila.tamano_tema,
    densidad: fila.densidad,
    ordenTemas: fila.orden_temas,
    vistaPrograma: fila.vista_programa,
  });
}

/* ------------------------------------------------------------- materias -- */

export function aFilaMateria(m: Materia, usuarioId: string): FilaMateria {
  return {
    id: m.id,
    usuario_id: usuarioId,
    nombre: m.nombre,
    abrev: m.abrev,
    color: m.color,
    ejercicio: m.ejercicio,
    descripcion: m.descripcion,
    orden: m.orden ?? 0,
    updated_at: iso(m.actualizado),
    deleted_at: m.borrado == null ? null : iso(m.borrado),
  };
}

export function deFilaMateria(f: FilaMateria): Materia {
  return {
    id: f.id,
    nombre: f.nombre,
    abrev: f.abrev,
    color: f.color,
    ejercicio: (f.ejercicio as Materia["ejercicio"]) ?? 1,
    descripcion: f.descripcion ?? "",
    orden: f.orden ?? 0,
    actualizado: relojFila(f),
    borrado: ms(f.deleted_at),
  };
}

/* ---------------------------------------------------------------- temas -- */

export function aFilaTema(t: Tema, usuarioId: string): FilaTema {
  return {
    id: t.id,
    usuario_id: usuarioId,
    materia_id: t.materiaId,
    numero: t.numero,
    titulo: t.titulo,
    propio: t.propio ?? true,
    updated_at: iso(t.actualizado),
    deleted_at: t.borrado == null ? null : iso(t.borrado),
  };
}

/**
 * El tema baja SIN epígrafes: son filas propias en el servidor y el que
 * fusiona conserva los que ya tenía el tema en local (§9.2).
 */
export function deFilaTema(f: FilaTema): Omit<Tema, "epigrafes"> {
  return {
    id: f.id,
    materiaId: f.materia_id,
    numero: f.numero,
    titulo: f.titulo,
    propio: f.propio,
    actualizado: relojFila(f),
    borrado: ms(f.deleted_at),
  };
}

/* ------------------------------------------------------------ epigrafes -- */

export function aFilaEpigrafe(
  e: Epigrafe,
  temaId: string,
  usuarioId: string,
): FilaEpigrafe {
  return {
    id: e.id,
    usuario_id: usuarioId,
    tema_id: temaId,
    orden: e.orden,
    titulo: e.titulo,
    texto: texto(e.texto),
    creado_at: iso(e.creado),
    updated_at: iso(e.actualizado),
    deleted_at: e.borrado == null ? null : iso(e.borrado),
  };
}

export function deFilaEpigrafe(f: FilaEpigrafe): Epigrafe & { temaId: string } {
  return {
    id: f.id,
    temaId: f.tema_id,
    orden: f.orden,
    titulo: f.titulo,
    texto: f.texto ?? undefined,
    creado: ms(f.creado_at) ?? relojFila(f),
    actualizado: relojFila(f),
    borrado: ms(f.deleted_at),
  };
}

/* ------------------------------------------------------- progreso_temas -- */

export function aFilaProgreso(p: ProgresoTema, usuarioId: string): FilaProgreso {
  return {
    tema_id: p.temaId,
    usuario_id: usuarioId,
    estado: p.estado,
    segundos: Math.max(0, Math.round(p.segundos)),
    dificultad: Math.min(5, Math.max(1, Math.round(p.dificultad))),
    vueltas: Math.max(0, Math.round(p.vueltas)),
    ultimo_estudio: p.ultimoEstudio == null ? null : iso(p.ultimoEstudio),
    ultimo_cante: p.ultimoCante == null ? null : iso(p.ultimoCante),
    // El check de la columna es `between 0 and 10`: una media fuera de rango
    // reventaría el lote entero, y una nota no vale una sincronización.
    nota_media:
      p.notaMedia == null ? null : Math.min(10, Math.max(0, Number(p.notaMedia.toFixed(1)))),
    proximo_repaso: p.proximoRepaso == null ? null : iso(p.proximoRepaso),
    favorito: p.favorito ?? false,
    updated_at: iso(p.actualizado),
    deleted_at: p.borrado == null ? null : iso(p.borrado),
  };
}

export function deFilaProgreso(f: FilaProgreso): ProgresoTema {
  return {
    temaId: f.tema_id,
    estado: f.estado,
    segundos: num(f.segundos) ?? 0,
    dificultad: num(f.dificultad) ?? 3,
    vueltas: num(f.vueltas) ?? 0,
    ultimoEstudio: ms(f.ultimo_estudio),
    ultimoCante: ms(f.ultimo_cante),
    notaMedia: num(f.nota_media),
    proximoRepaso: ms(f.proximo_repaso),
    favorito: f.favorito ?? false,
    actualizado: relojFila(f),
    borrado: ms(f.deleted_at),
  };
}

/* ------------------------------------------------------------- sesiones -- */

/**
 * La sesión no tiene reloj en el dominio, y no es un olvido: es append-only
 * y no se entierra (borrar un tema no borra las horas), así que no hay nada
 * que arbitrar. Como columna hace falta igual, se manda el instante en que
 * se cerró: mientras el desfase no cambie es estable, así que reenviarla no
 * mueve nada en el servidor.
 *
 * Sí lleva el desfase del reloj (lib/sync/reloj.ts), porque `updated_at` no
 * solo arbitra: también es el cursor del pull. Una sesión insertada con la
 * hora atrasada del móvil puede caer por debajo del cursor del portátil, y
 * entonces esas horas de estudio no aparecen ahí nunca. `fin` en sí no se
 * toca: es dato que el opositor ve en su histórico.
 */
export function relojSesion(s: Sesion, desfase = 0): number {
  return s.fin + desfase;
}

export function aFilaSesion(s: Sesion, usuarioId: string, desfase = 0): FilaSesion {
  return {
    id: s.id,
    usuario_id: usuarioId,
    tema_id: s.temaId ?? null,
    tipo: s.tipo,
    inicio: iso(s.inicio),
    fin: iso(s.fin),
    segundos: Math.max(0, Math.round(s.segundos)),
    nota: texto(s.nota),
    updated_at: iso(relojSesion(s, desfase)),
    deleted_at: null,
  };
}

export function deFilaSesion(f: FilaSesion): Sesion {
  return {
    id: f.id,
    temaId: f.tema_id ?? undefined,
    tipo: f.tipo,
    inicio: ms(f.inicio) ?? 0,
    fin: ms(f.fin) ?? 0,
    segundos: num(f.segundos) ?? 0,
    nota: f.nota ?? undefined,
  };
}

/* --------------------------------------------------------------- cantes -- */

export function aFilaCante(c: Cante, usuarioId: string): FilaCante {
  return {
    id: c.id,
    usuario_id: usuarioId,
    tema_id: c.temaId,
    fecha: iso(c.fecha),
    segundos: Math.max(0, Math.round(c.segundos)),
    epigrafes: c.epigrafes ?? [],
    nota: c.nota == null ? null : Math.min(10, Math.max(0, c.nota)),
    con_preparador: c.conPreparador ?? false,
    feedback: texto(c.feedback),
    analisis: c.analisis ?? null,
    audio_path: c.audio?.path ?? null,
    // Se mandan aunque sean `null`: la columna tiene que poder pasar de un
    // valor a otro cuando el cante se reanaliza, y omitirla del payload haría
    // que el `do update` del upsert la dejara como estuviera.
    transcripcion: c.transcripcion ?? null,
    comparacion: c.comparacion ?? null,
    updated_at: iso(c.actualizado),
    deleted_at: c.borrado == null ? null : iso(c.borrado),
  };
}

export function deFilaCante(f: FilaCante): Cante {
  return {
    id: f.id,
    temaId: f.tema_id,
    fecha: ms(f.fecha) ?? 0,
    segundos: num(f.segundos) ?? 0,
    epigrafes: f.epigrafes ?? [],
    nota: num(f.nota),
    conPreparador: f.con_preparador ?? false,
    feedback: f.feedback ?? undefined,
    analisis: f.analisis ?? undefined,
    // La fila solo trae la ruta. El resto de la ficha del audio (mime,
    // duración, marcas de epígrafe) es local y la conserva la fusión.
    audio: f.audio_path ? { path: f.audio_path } : undefined,
    transcripcion: f.transcripcion ?? undefined,
    comparacion: f.comparacion ?? undefined,
    actualizado: relojFila(f),
    borrado: ms(f.deleted_at),
  };
}

/* ------------------------------------------------------------ keypoints -- */

export function aFilaKeyPoint(k: KeyPoint, usuarioId: string): FilaKeyPoint {
  return {
    id: k.id,
    usuario_id: usuarioId,
    tema_id: k.temaId,
    epigrafe_id: texto(k.epigrafeId),
    anverso: k.anverso,
    reverso: k.reverso,
    aciertos: Math.max(0, Math.round(k.aciertos)),
    fallos: Math.max(0, Math.round(k.fallos)),
    intervalo_dias: Math.min(3650, Math.max(1, Math.round(k.intervaloDias))),
    proximo_repaso: iso(k.proximoRepaso),
    creado_at: iso(k.creado),
    updated_at: iso(k.actualizado),
    deleted_at: k.borrado == null ? null : iso(k.borrado),
  };
}

export function deFilaKeyPoint(f: FilaKeyPoint): KeyPoint {
  return {
    id: f.id,
    temaId: f.tema_id,
    epigrafeId: f.epigrafe_id ?? undefined,
    anverso: f.anverso,
    reverso: f.reverso,
    aciertos: num(f.aciertos) ?? 0,
    fallos: num(f.fallos) ?? 0,
    intervaloDias: num(f.intervalo_dias) ?? 1,
    proximoRepaso: ms(f.proximo_repaso) ?? Date.now(),
    creado: ms(f.creado_at) ?? relojFila(f),
    actualizado: relojFila(f),
    borrado: ms(f.deleted_at),
  };
}

/* ---------------------------------------------------------------- notas -- */

export function aFilaNota(n: Nota, usuarioId: string): FilaNota {
  return {
    id: n.id,
    usuario_id: usuarioId,
    tema_id: n.temaId,
    epigrafe_id: texto(n.epigrafeId),
    texto: n.texto,
    creado_at: iso(n.creado),
    updated_at: iso(n.actualizado),
    deleted_at: n.borrado == null ? null : iso(n.borrado),
  };
}

export function deFilaNota(f: FilaNota): Nota {
  return {
    id: f.id,
    temaId: f.tema_id,
    epigrafeId: f.epigrafe_id ?? undefined,
    texto: f.texto ?? "",
    creado: ms(f.creado_at) ?? relojFila(f),
    // §9.5: `Nota.actualizado` y `updated_at` son la misma cosa, no se
    // duplican. "Editada hace X" se pinta con esto.
    actualizado: relojFila(f),
    borrado: ms(f.deleted_at),
  };
}

/* ----------------------------------------------------------- simulacros -- */

export function aFilaSimulacro(s: Simulacro, usuarioId: string): FilaSimulacro {
  return {
    id: s.id,
    usuario_id: usuarioId,
    tipo: s.tipo,
    fecha: iso(s.fecha),
    tema_ids: s.temaIds ?? [],
    minutos: Math.max(0, Math.round(s.minutos)),
    segundos_usados: Math.max(0, Math.round(s.segundosUsados)),
    // Posicionales: notas[i] es la nota de tema_ids[i] (§9.8).
    notas: s.notas ?? [],
    supuesto: texto(s.supuesto),
    respuesta: texto(s.respuesta),
    correccion: texto(s.correccion),
    completado: s.completado ?? false,
    updated_at: iso(s.actualizado),
    deleted_at: s.borrado == null ? null : iso(s.borrado),
  };
}

export function deFilaSimulacro(f: FilaSimulacro): Simulacro {
  return {
    id: f.id,
    tipo: f.tipo,
    fecha: ms(f.fecha) ?? 0,
    temaIds: f.tema_ids ?? [],
    minutos: num(f.minutos) ?? 0,
    segundosUsados: num(f.segundos_usados) ?? 0,
    notas: (f.notas ?? []).map((n) => num(n) ?? null),
    supuesto: f.supuesto ?? undefined,
    respuesta: f.respuesta ?? undefined,
    correccion: f.correccion ?? undefined,
    completado: f.completado ?? false,
    actualizado: relojFila(f),
    borrado: ms(f.deleted_at),
  };
}

/* -------------------------------------------------------------- vueltas -- */

export function aFilaVuelta(v: Vuelta, usuarioId: string): FilaVuelta {
  return {
    id: v.id,
    usuario_id: usuarioId,
    tema_id: v.temaId,
    fecha: iso(v.fecha),
    updated_at: iso(v.actualizado),
    deleted_at: v.borrado == null ? null : iso(v.borrado),
  };
}

export function deFilaVuelta(f: FilaVuelta): Vuelta {
  return {
    id: f.id,
    temaId: f.tema_id,
    fecha: ms(f.fecha) ?? 0,
    actualizado: relojFila(f),
    borrado: ms(f.deleted_at),
  };
}

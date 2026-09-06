import { uid } from "../utils/id";
import type {
  Cante,
  Epigrafe,
  EpigrafeBorrado,
  KeyPoint,
  Materia,
  MensajeChat,
  Nota,
  Perfil,
  ProgresoTema,
  Sesion,
  Simulacro,
  Tema,
  Vuelta,
} from "../data/types";

/* ============================================================
   Migración v1 → v2 del expediente guardado en IndexedDB

   El modelo v1 generaba ids tipo `tem_lx9f3kq2a` y daba a las materias
   precargadas un slug (`civil`, `mercantil`) idéntico en todas las
   instalaciones. Ninguna de las dos cosas cabe en el esquema de Postgres:
   las columnas son `uuid` y dos opositores no pueden compartir el id
   `civil`. El primer push de cualquier instalación existente fallaría.

   Aquí se reescribe el expediente entero: id nuevo para cada entidad y
   TODAS las referencias cruzadas apuntando a los ids nuevos. Un solo
   olvido y el opositor pierde su expediente, así que la reescritura va
   por tabla y con un mapa único con espacio de nombres por tipo.

   De paso se rellenan los campos que el modelo v1 no tenía y que la
   sincronización necesita: `Materia.orden`, los timestamps de `Epigrafe`
   y los registros de `vueltas`.
   ============================================================ */

type MateriaV1 = Omit<Materia, "orden"> & { orden?: number };
type EpigrafeV1 = Omit<Epigrafe, "creado" | "actualizado"> & {
  creado?: number;
  actualizado?: number;
};
type TemaV1 = Omit<Tema, "epigrafes"> & { epigrafes?: EpigrafeV1[] };
type NotaV1 = Omit<Nota, "actualizado" | "creado"> & {
  creado?: number;
  actualizado?: number;
};

interface CronoV1 {
  tipo: string;
  temaId?: string;
  desde: number;
  acumulado: number;
  pausado: boolean;
}

/** Forma laxa: es lo que había en IndexedDB, no un tipo del dominio vivo. */
export interface ExpedienteV1 {
  perfil?: Perfil;
  materias?: MateriaV1[];
  temas?: TemaV1[];
  progresos?: Record<string, ProgresoTema>;
  sesiones?: Sesion[];
  cantes?: Cante[];
  keypoints?: KeyPoint[];
  notas?: NotaV1[];
  simulacros?: Simulacro[];
  chat?: MensajeChat[];
  crono?: CronoV1 | null;
  [otros: string]: unknown;
}

export interface ExpedienteV2 {
  perfil?: Perfil;
  materias: Materia[];
  temas: Tema[];
  progresos: Record<string, ProgresoTema>;
  sesiones: Sesion[];
  cantes: Cante[];
  keypoints: KeyPoint[];
  notas: Nota[];
  simulacros: Simulacro[];
  chat: MensajeChat[];
  vueltas: Vuelta[];
  epigrafesBorrados: EpigrafeBorrado[];
  crono: CronoV1 | null;
  [otros: string]: unknown;
}

export interface ResultadoMigracion {
  estado: ExpedienteV2;
  /** `tipo:idViejo → uuid`. Se guarda aparte por si hay que depurar. */
  mapa: Record<string, string>;
}

type Tipo = "materia" | "tema" | "epigrafe" | "sesion" | "cante" | "keypoint" | "nota" | "simulacro" | "mensaje";

const lista = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function migrarAUuid(guardado: ExpedienteV1): ResultadoMigracion {
  const mapa: Record<string, string> = {};

  /**
   * Traduce un id viejo. El espacio de nombres evita que un slug de materia
   * y un id de tema que casualmente coincidan acaben compartiendo uuid.
   *
   * Una referencia a algo que ya no existe (una sesión de un tema borrado,
   * que el modelo no cascadea a propósito) también recibe uuid: sigue
   * colgando, igual que antes, pero deja de ser un valor que Postgres
   * rechazaría por no ser uuid.
   */
  const ref = (tipo: Tipo, viejo: string | undefined): string => {
    if (!viejo) return uid();
    const clave = `${tipo}:${viejo}`;
    if (!mapa[clave]) mapa[clave] = uid();
    return mapa[clave];
  };
  const refOpc = (tipo: Tipo, viejo: string | undefined): string | undefined =>
    viejo == null ? undefined : ref(tipo, viejo);

  const ahora = Date.now();

  /* ---------------- materias ---------------- */
  // El orden era la posición en el array; se materializa tal cual estaba
  // para que la barra lateral no se reordene delante del usuario.
  const materias: Materia[] = lista<MateriaV1>(guardado.materias).map((m, i) => ({
    ...m,
    id: ref("materia", m.id),
    orden: typeof m.orden === "number" ? m.orden : i,
  }));

  /* ---------------- temas y epígrafes ---------------- */
  // Los epígrafes no tenían timestamps. Se sellan con la hora de la
  // migración: es lo único comprobable, y basta para el last-write-wins
  // (cualquier edición posterior avanzará el reloj).
  const temas: Tema[] = lista<TemaV1>(guardado.temas).map((t) => ({
    ...t,
    id: ref("tema", t.id),
    materiaId: ref("materia", t.materiaId),
    epigrafes: lista<EpigrafeV1>(t.epigrafes).map((e, i) => ({
      ...e,
      id: ref("epigrafe", e.id),
      orden: typeof e.orden === "number" ? e.orden : i + 1,
      creado: e.creado ?? ahora,
      actualizado: e.actualizado ?? ahora,
    })),
  }));

  /* ---------------- progresos ---------------- */
  // Mapa cuyas CLAVES son referencias a temas: hay que reescribir la clave
  // y el temaId de dentro, no solo uno de los dos.
  const progresosV1 =
    guardado.progresos && typeof guardado.progresos === "object"
      ? guardado.progresos
      : {};
  const progresos: Record<string, ProgresoTema> = {};
  for (const [temaIdViejo, p] of Object.entries(progresosV1)) {
    const temaId = ref("tema", temaIdViejo);
    progresos[temaId] = { ...p, temaId };
  }

  /* ---------------- vueltas ---------------- */
  // El modelo v1 solo guardaba el contador `vueltas`, nunca las fechas de
  // las transiciones a "dominado". Aproximación: se generan tantos
  // registros como marcaba el contador y todos llevan la fecha del último
  // contacto con el tema (último cante, o último estudio, o el arranque del
  // expediente). Solo la CUENTA es un dato real; la fecha es una etiqueta
  // para que el registro exista y pueda sincronizarse. No afecta a nada
  // visible: `vueltas` se usa como número, nunca como serie temporal.
  const inicioExpediente = guardado.perfil?.fechaInicio ?? ahora;
  const vueltas: Vuelta[] = [];
  for (const p of Object.values(progresos)) {
    const cuantas = Math.max(0, Math.floor(p.vueltas ?? 0));
    const fecha = p.ultimoCante ?? p.ultimoEstudio ?? inicioExpediente;
    for (let i = 0; i < cuantas; i++) {
      vueltas.push({ id: uid(), temaId: p.temaId, fecha });
    }
  }

  /* ---------------- colecciones que cuelgan del tema ---------------- */
  const sesiones: Sesion[] = lista<Sesion>(guardado.sesiones).map((s) => ({
    ...s,
    id: ref("sesion", s.id),
    temaId: refOpc("tema", s.temaId),
  }));

  const cantes: Cante[] = lista<Cante>(guardado.cantes).map((c) => ({
    ...c,
    id: ref("cante", c.id),
    temaId: ref("tema", c.temaId),
    // El desglose por epígrafe vive dentro del cante y también apunta a ids.
    epigrafes: lista<Cante["epigrafes"][number]>(c.epigrafes).map((e) => ({
      ...e,
      epigrafeId: ref("epigrafe", e.epigrafeId),
    })),
  }));

  const keypoints: KeyPoint[] = lista<KeyPoint>(guardado.keypoints).map((k) => ({
    ...k,
    id: ref("keypoint", k.id),
    temaId: ref("tema", k.temaId),
    epigrafeId: refOpc("epigrafe", k.epigrafeId),
  }));

  const notas: Nota[] = lista<NotaV1>(guardado.notas).map((n) => ({
    ...n,
    id: ref("nota", n.id),
    temaId: ref("tema", n.temaId),
    epigrafeId: refOpc("epigrafe", n.epigrafeId),
    creado: n.creado ?? ahora,
    actualizado: n.actualizado ?? n.creado ?? ahora,
  }));

  const simulacros: Simulacro[] = lista<Simulacro>(guardado.simulacros).map((s) => ({
    ...s,
    id: ref("simulacro", s.id),
    // temaIds y notas se corresponden índice a índice: se mapea sin
    // reordenar, o las notas se cruzarían de tema.
    temaIds: lista<string>(s.temaIds).map((t) => ref("tema", t)),
  }));

  const chat: MensajeChat[] = lista<MensajeChat>(guardado.chat).map((m) => ({
    ...m,
    id: ref("mensaje", m.id),
  }));

  // El cronómetro en marcha no se sincroniza, pero apunta a un tema: si no
  // se reescribe, al parar el crono la sesión se guardaría contra un id que
  // ya no existe y esas horas se perderían de la ficha del tema.
  const crono = guardado.crono
    ? { ...guardado.crono, temaId: refOpc("tema", guardado.crono.temaId) }
    : null;

  return {
    estado: {
      ...guardado,
      perfil: guardado.perfil,
      materias,
      temas,
      progresos,
      sesiones,
      cantes,
      keypoints,
      notas,
      simulacros,
      chat,
      vueltas,
      epigrafesBorrados: [],
      crono,
    },
    mapa,
  };
}

import { uid } from "../utils/id";
import { normalizarPerfil } from "../data/perfil";
import type {
  Cante,
  Epigrafe,
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
   Migraciones del expediente guardado en IndexedDB

   Van encadenadas: un expediente v1 pasa por las dos, uno v2 solo por la
   segunda (`migrarARelojes`, al final del fichero).

   --- v1 → v2 -------------------------------------------------

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

/**
 * `actualizado` no existía antes de la v3: en los tipos intermedios de la
 * migración es opcional, y `migrarARelojes` es quien lo hace obligatorio.
 */
type SinReloj<T> = Omit<T, "actualizado"> & { actualizado?: number };

type MateriaV1 = SinReloj<Omit<Materia, "orden"> & { orden?: number }>;
type EpigrafeV1 = SinReloj<Omit<Epigrafe, "creado">> & { creado?: number };
type TemaV1 = SinReloj<Omit<Tema, "epigrafes">> & { epigrafes?: EpigrafeV1[] };
type NotaV1 = SinReloj<Omit<Nota, "creado">> & { creado?: number };

type MateriaV2 = SinReloj<Materia>;
type EpigrafeV2 = SinReloj<Epigrafe>;
type TemaV2 = SinReloj<Omit<Tema, "epigrafes">> & { epigrafes: EpigrafeV2[] };
type CanteV2 = SinReloj<Cante>;
type KeyPointV2 = SinReloj<KeyPoint>;
type NotaV2 = SinReloj<Nota>;
type SimulacroV2 = SinReloj<Simulacro>;
type ProgresoV2 = SinReloj<ProgresoTema>;
type VueltaV2 = SinReloj<Vuelta>;

/**
 * Las tumbas de epígrafe vivían en un array aparte en la v2. En la v3 son
 * el propio epígrafe con `borrado`, porque la tumba tiene que llevar id y
 * reloj para poder empujarse al servidor y el array suelto no los tenía.
 */
interface EpigrafeBorradoV2 {
  id: string;
  temaId: string;
  borrado: number;
}

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
  progresos?: Record<string, ProgresoV2>;
  sesiones?: Sesion[];
  cantes?: SinReloj<Cante>[];
  keypoints?: SinReloj<KeyPoint>[];
  notas?: NotaV1[];
  simulacros?: SinReloj<Simulacro>[];
  chat?: MensajeChat[];
  crono?: CronoV1 | null;
  [otros: string]: unknown;
}

export interface ExpedienteV2 {
  perfil?: Perfil;
  materias: MateriaV2[];
  temas: TemaV2[];
  progresos: Record<string, ProgresoV2>;
  sesiones: Sesion[];
  cantes: CanteV2[];
  keypoints: KeyPointV2[];
  notas: NotaV2[];
  simulacros: SimulacroV2[];
  chat: MensajeChat[];
  vueltas: VueltaV2[];
  /** Solo lo trae un expediente guardado con la v2. */
  epigrafesBorrados?: EpigrafeBorradoV2[];
  crono: CronoV1 | null;
  [otros: string]: unknown;
}

/** El expediente ya con todos los relojes puestos. Es lo que usa el store. */
export interface ExpedienteV3 {
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
  const materias: MateriaV2[] = lista<MateriaV1>(guardado.materias).map((m, i) => ({
    ...m,
    id: ref("materia", m.id),
    orden: typeof m.orden === "number" ? m.orden : i,
  }));

  /* ---------------- temas y epígrafes ---------------- */
  // Los epígrafes no tenían timestamps. Se sellan con la hora de la
  // migración: es lo único comprobable, y basta para el last-write-wins
  // (cualquier edición posterior avanzará el reloj).
  const temas: TemaV2[] = lista<TemaV1>(guardado.temas).map((t) => ({
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
  const progresos: Record<string, ProgresoV2> = {};
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
  const vueltas: VueltaV2[] = [];
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

  const cantes: CanteV2[] = lista<CanteV2>(guardado.cantes).map((c) => ({
    ...c,
    id: ref("cante", c.id),
    temaId: ref("tema", c.temaId),
    // El desglose por epígrafe vive dentro del cante y también apunta a ids.
    epigrafes: lista<Cante["epigrafes"][number]>(c.epigrafes).map((e) => ({
      ...e,
      epigrafeId: ref("epigrafe", e.epigrafeId),
    })),
  }));

  const keypoints: KeyPointV2[] = lista<KeyPointV2>(guardado.keypoints).map((k) => ({
    ...k,
    id: ref("keypoint", k.id),
    temaId: ref("tema", k.temaId),
    epigrafeId: refOpc("epigrafe", k.epigrafeId),
  }));

  const notas: NotaV2[] = lista<NotaV1>(guardado.notas).map((n) => ({
    ...n,
    id: ref("nota", n.id),
    temaId: ref("tema", n.temaId),
    epigrafeId: refOpc("epigrafe", n.epigrafeId),
    creado: n.creado ?? ahora,
    actualizado: n.actualizado ?? n.creado ?? ahora,
  }));

  const simulacros: SimulacroV2[] = lista<SimulacroV2>(guardado.simulacros).map((s) => ({
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
      crono,
    },
    mapa,
  };
}

/* ============================================================
   Migración v2 → v3: relojes en todas las entidades mutables y
   borrado lógico

   La v2 solo tenía `actualizado` en `Nota` y `Epigrafe`. El push manda el
   `actualizado` de cada fila y el servidor arbitra con él (§3.1 y §4 de
   docs/sincronizacion.md): una fila sin reloj no se puede empujar sin
   inventárselo, y lo que se invente decide quién gana los conflictos.

   Criterio: NUNCA la hora de la migración cuando hay un dato real de la
   fila, porque sellarlo todo "ahora" haría que el dispositivo que abra la
   app más tarde ganase todos los conflictos por el mero hecho de abrirla.
   Por eso cada entidad usa lo más cercano que tiene a "cuándo se tocó esto
   por última vez":

     · Cante y Simulacro  → su `fecha`. Se crean y se corrigen ahí mismo.
     · KeyPoint           → la última respuesta, que se puede reconstruir:
                            `proximoRepaso - intervaloDias` es exactamente
                            el momento en que se contestó la tarjeta. Si no
                            se ha contestado nunca, su `creado`.
     · ProgresoTema       → el último contacto con el tema (último cante o
                            último estudio), que es lo que mueve la fila.
     · Nota y Epigrafe    → ya lo tenían; solo se completa si falta.
     · Materia y Tema     → no hay ni un dato de fecha por fila. Se usa el
                            arranque del expediente (`perfil.fechaInicio`):
                            es antiguo y por tanto conservador — ante un
                            conflicto pierde contra cualquier edición real
                            de otro dispositivo, que es justo lo que se
                            quiere cuando no se sabe nada.

   Y las tumbas de epígrafe del array suelto `epigrafesBorrados` se pliegan
   dentro del tema, que es donde viven ahora.
   ============================================================ */

const DIA = 86_400_000;

/** Momento en que se contestó por última vez una tarjeta, si se contestó. */
function ultimaRespuesta(k: KeyPointV2): number | undefined {
  if (!k.aciertos && !k.fallos) return undefined;
  const t = k.proximoRepaso - (k.intervaloDias || 1) * DIA;
  return Number.isFinite(t) && t > 0 ? t : undefined;
}

export function migrarARelojes(guardado: ExpedienteV2): ExpedienteV3 {
  const ahora = Date.now();
  // Suelo conservador para lo que no tiene fecha propia.
  const inicio = Math.min(guardado.perfil?.fechaInicio ?? ahora, ahora);

  // Las tumbas sueltas, indexadas por tema para plegarlas de una pasada.
  const tumbas = new Map<string, EpigrafeBorradoV2[]>();
  for (const t of lista<EpigrafeBorradoV2>(guardado.epigrafesBorrados)) {
    const arr = tumbas.get(t.temaId) ?? [];
    arr.push(t);
    tumbas.set(t.temaId, arr);
  }

  const temas: Tema[] = lista<TemaV2>(guardado.temas).map((t) => {
    const epigrafes: Epigrafe[] = lista<EpigrafeV2>(t.epigrafes).map((e) => ({
      ...e,
      creado: e.creado ?? inicio,
      actualizado: e.actualizado ?? e.creado ?? inicio,
    }));
    const presentes = new Set(epigrafes.map((e) => e.id));
    for (const tumba of tumbas.get(t.id) ?? []) {
      if (presentes.has(tumba.id)) continue;
      // De la fila borrada solo se conservaba el id: para sincronizar basta
      // (lo que viaja es id + deleted_at + updated_at) y nada de la app la
      // lee, porque todas las lecturas filtran por `borrado`.
      epigrafes.push({
        id: tumba.id,
        orden: 0,
        titulo: "",
        creado: tumba.borrado,
        actualizado: tumba.borrado,
        borrado: tumba.borrado,
      });
    }
    return { ...t, epigrafes, actualizado: t.actualizado ?? inicio };
  });

  const progresos: Record<string, ProgresoTema> = {};
  for (const [temaId, p] of Object.entries(guardado.progresos ?? {})) {
    const contacto = Math.max(p.ultimoCante ?? 0, p.ultimoEstudio ?? 0);
    progresos[temaId] = {
      ...p,
      actualizado: p.actualizado ?? (contacto > 0 ? contacto : inicio),
    };
  }

  return {
    ...guardado,
    materias: lista<MateriaV2>(guardado.materias).map((m) => ({
      ...m,
      actualizado: m.actualizado ?? inicio,
    })),
    temas,
    progresos,
    sesiones: lista<Sesion>(guardado.sesiones),
    cantes: lista<CanteV2>(guardado.cantes).map((c) => ({
      ...c,
      actualizado: c.actualizado ?? c.fecha ?? inicio,
    })),
    keypoints: lista<KeyPointV2>(guardado.keypoints).map((k) => ({
      ...k,
      actualizado: k.actualizado ?? ultimaRespuesta(k) ?? k.creado ?? inicio,
    })),
    notas: lista<NotaV2>(guardado.notas).map((n) => ({
      ...n,
      actualizado: n.actualizado ?? n.creado ?? inicio,
    })),
    simulacros: lista<SimulacroV2>(guardado.simulacros).map((s) => ({
      ...s,
      actualizado: s.actualizado ?? s.fecha ?? inicio,
    })),
    // Una vuelta no se edita: su reloj es la fecha en que se cerró.
    vueltas: lista<VueltaV2>(guardado.vueltas).map((v) => ({
      ...v,
      actualizado: v.actualizado ?? v.fecha ?? inicio,
    })),
    chat: lista<MensajeChat>(guardado.chat),
    crono: guardado.crono ?? null,
    // El array suelto desaparece: sus tumbas ya están dentro de los temas.
    epigrafesBorrados: undefined,
  };
}


/* ============================================================
   v3 → v4: la apariencia

   El perfil gana los campos de personalización (acento, tipografía y
   cuerpo del texto de los temas, densidad, orden de los temas, vista del
   programa). Un expediente guardado antes de esto no los trae, y hay que
   rellenarlos con los valores que reproducen la app tal y como la tenía
   ese opositor ayer: los de PERFIL_INICIAL. Si se dejaran en `undefined`,
   `apariencia()` recibiría un acento que no existe y el generador de
   paletas trabajaría sobre basura.

   El saneado va por `normalizarPerfil()` y no por un `{...defectos,
   ...guardado}` a pelo porque esto mismo lo llama la importación de una
   copia, y un fichero JSON editado a mano puede traer un `tamanoTema` de
   400: hay un único sitio donde se decide qué es un perfil válido.
   ============================================================ */

export function migrarAApariencia(guardado: ExpedienteV3): ExpedienteV3 {
  return { ...guardado, perfil: normalizarPerfil(guardado.perfil) };
}

import type { Tema } from "../data/types";
import type { Expediente } from "./expediente";
import type { Tabla } from "./tablas";
import { TABLAS } from "./tablas";

/* ============================================================
   La cola de salida

   Guarda `{tabla, id}` y NUNCA la fila (§3.1). Dos motivos, y los dos
   importan: al empujar se lee el estado actual —cinco ediciones offline de
   la misma nota suben una vez y con el valor final— y la cola no puede
   quedarse con una copia vieja que pise lo que el usuario escribió después.

   Vive dentro del estado persistido del store, no en una clave aparte de
   IndexedDB. Es deliberado: el expediente y la cola se guardan en la misma
   escritura, así que no existe el instante en el que el dato está guardado
   y su marca de "pendiente de subir" no, que es exactamente lo que se
   pierde cuando la app se cierra a media sincronización.

   El valor de cada entrada es el momento en que se encoló. Sirve para dos
   cosas: para saber qué reloj mandar en el perfil (que no tiene campo
   propio) y, sobre todo, para no borrar de la cola una entrada que se ha
   vuelto a tocar mientras subía el lote.
   ============================================================ */

/** `tabla:id`. Los uuid no llevan `:`, así que la clave es reversible. */
export type Cola = Record<string, number>;

/**
 * El perfil no tiene id local: el suyo es el del usuario, que offline
 * todavía no se conoce. Se encola con este marcador y el push lo resuelve.
 */
export const ID_PERFIL = "yo";

export function clave(tabla: Tabla, id: string): string {
  return `${tabla}:${id}`;
}

export function partirClave(k: string): { tabla: Tabla; id: string } | null {
  const corte = k.indexOf(":");
  if (corte < 0) return null;
  const tabla = k.slice(0, corte) as Tabla;
  if (!TABLAS.includes(tabla)) return null;
  return { tabla, id: k.slice(corte + 1) };
}

/** Las entradas de la cola agrupadas por tabla, en orden de clave ajena. */
export function porTabla(cola: Cola): { tabla: Tabla; ids: string[] }[] {
  const mapa = new Map<Tabla, string[]>();
  for (const k of Object.keys(cola)) {
    const p = partirClave(k);
    if (!p) continue;
    const lista = mapa.get(p.tabla);
    if (lista) lista.push(p.id);
    else mapa.set(p.tabla, [p.id]);
  }
  return TABLAS.filter((t) => mapa.has(t)).map((t) => ({ tabla: t, ids: mapa.get(t)! }));
}

/**
 * Saca de la cola las entradas ya subidas, respetando las que se han
 * vuelto a tocar mientras el lote estaba en vuelo.
 *
 * Sin esta comparación se pierde la edición que el opositor hizo durante la
 * subida: la fila se habría empujado con el valor viejo y su marca de
 * pendiente desaparecería con ella.
 */
export function quitarSubidas(cola: Cola, subidas: Cola): Cola {
  let cambia = false;
  const salida: Cola = {};
  for (const [k, v] of Object.entries(cola)) {
    if (k in subidas && subidas[k] === v) {
      cambia = true;
      continue;
    }
    salida[k] = v;
  }
  return cambia ? salida : cola;
}

export function encolar(cola: Cola, tabla: Tabla, id: string, ahora: number): Cola {
  return { ...cola, [clave(tabla, id)]: ahora };
}

/* ---------------------------------------------------- detección de cambios */

/**
 * Qué filas ha tocado una escritura del store.
 *
 * Se engancha en `escribir()`, el embudo por el que pasan TODAS las
 * escrituras de entidades sincronizables, por la misma razón por la que el
 * sellado del reloj se engancha ahí (lib/store/sellado.ts): hay más de
 * treinta acciones y acordarse en cada una es cuestión de tiempo que se
 * olvide en alguna. Una escritura que no se encola no viaja, y nadie se
 * entera hasta que el opositor abre el otro portátil.
 *
 * El criterio es la IDENTIDAD de la fila, no su contenido: el sellado ya se
 * ha encargado de que una fila con contenido nuevo sea un objeto nuevo, y
 * las acciones del store nunca mutan en sitio. Comparar contenido aquí
 * sería pagar dos veces por lo mismo.
 *
 * Solo mira las claves que trae el parcial: una acción que escribe el
 * cronómetro no paga nada.
 */
export function cambiosDe(
  previo: Expediente,
  parcial: Partial<Expediente>,
  cola: Cola,
  ahora: number,
): { cola: Cola; perfilActualizado?: number } {
  const nuevas: Cola = {};
  let hay = false;
  let perfilActualizado: number | undefined;

  const marcar = (tabla: Tabla, id: string) => {
    nuevas[clave(tabla, id)] = ahora;
    hay = true;
  };

  const lista = <T extends { id: string }>(
    tabla: Tabla,
    filas: T[] | undefined,
    previas: T[],
  ) => {
    if (!filas || filas === previas) return;
    const antes = new Map(previas.map((f) => [f.id, f]));
    for (const f of filas) if (antes.get(f.id) !== f) marcar(tabla, f.id);
  };

  if (parcial.perfil && parcial.perfil !== previo.perfil) {
    marcar("perfiles", ID_PERFIL);
    perfilActualizado = ahora;
  }

  lista("materias", parcial.materias, previo.materias);
  lista("cantes", parcial.cantes, previo.cantes);
  lista("keypoints", parcial.keypoints, previo.keypoints);
  lista("notas", parcial.notas, previo.notas);
  lista("simulacros", parcial.simulacros, previo.simulacros);
  lista("vueltas", parcial.vueltas, previo.vueltas);
  // Las sesiones no se editan ni se entierran, pero sí se crean: si no se
  // encolaran, las horas del opositor no saldrían nunca de este aparato.
  lista("sesiones", parcial.sesiones, previo.sesiones);

  // El tema y sus epígrafes son filas distintas en el servidor: cambiar el
  // título del epígrafe 3 encola ese epígrafe, no el tema entero.
  if (parcial.temas && parcial.temas !== previo.temas) {
    const antes = new Map(previo.temas.map((t) => [t.id, t]));
    for (const t of parcial.temas) {
      const previoT = antes.get(t.id);
      if (previoT === t) continue;
      // Comparar sin los epígrafes evita encolar el tema cada vez que se
      // toca uno de sus hijos: en el servidor son filas distintas.
      if (!previoT || cambiaSinEpigrafes(previoT, t)) marcar("temas", t.id);
      const antesE = new Map((previoT?.epigrafes ?? []).map((e) => [e.id, e]));
      for (const e of t.epigrafes) if (antesE.get(e.id) !== e) marcar("epigrafes", e.id);
    }
  }

  if (parcial.progresos && parcial.progresos !== previo.progresos) {
    for (const [temaId, p] of Object.entries(parcial.progresos)) {
      if (previo.progresos[temaId] !== p) marcar("progreso_temas", temaId);
    }
  }

  if (!hay) return { cola };
  return { cola: { ...cola, ...nuevas }, perfilActualizado };
}

/** ¿Ha cambiado el tema en sí, dejando fuera sus epígrafes? */
function cambiaSinEpigrafes(a: Tema, b: Tema): boolean {
  const claves = new Set([
    ...(Object.keys(a) as (keyof Tema)[]),
    ...(Object.keys(b) as (keyof Tema)[]),
  ]);
  claves.delete("epigrafes");
  for (const k of claves) {
    if ((a[k] as unknown) !== (b[k] as unknown)) return true;
  }
  return false;
}

/**
 * Encola el expediente entero. Es lo que hace la primera sincronización con
 * lo que todavía no está en la nube (`salvo` trae lo que acaba de bajar el
 * pull, que ya está arriba y volver a subirlo solo gastaría datos).
 */
export function encolarTodo(
  exp: Expediente,
  cola: Cola,
  ahora: number,
  salvo: Set<string> = new Set(),
): Cola {
  const salida: Cola = { ...cola };
  const marcar = (tabla: Tabla, id: string) => {
    const k = clave(tabla, id);
    if (salvo.has(k)) return;
    salida[k] = ahora;
  };

  for (const m of exp.materias) marcar("materias", m.id);
  for (const t of exp.temas) {
    marcar("temas", t.id);
    for (const e of t.epigrafes) marcar("epigrafes", e.id);
  }
  for (const temaId of Object.keys(exp.progresos)) marcar("progreso_temas", temaId);
  for (const s of exp.sesiones) marcar("sesiones", s.id);
  for (const c of exp.cantes) marcar("cantes", c.id);
  for (const k of exp.keypoints) marcar("keypoints", k.id);
  for (const n of exp.notas) marcar("notas", n.id);
  for (const s of exp.simulacros) marcar("simulacros", s.id);
  for (const v of exp.vueltas) marcar("vueltas", v.id);

  return salida;
}

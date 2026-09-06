import type {
  Cante,
  Epigrafe,
  KeyPoint,
  Materia,
  Nota,
  ProgresoTema,
  Simulacro,
  Tema,
  Vuelta,
} from "../data/types";

/* ============================================================
   Sellado automático de `actualizado`

   El push manda el `actualizado` local de cada fila y el servidor arbitra
   con él el last-write-wins (docs/sincronizacion.md §3.1 y §4). Una fila
   que se modifica sin mover su reloj no viaja: el trigger la ve más vieja
   que la del servidor y devuelve OLD, así que la edición se pierde en
   silencio. No hay error, no hay aviso: simplemente el opositor pierde lo
   que escribió.

   El store tiene decenas de acciones que escriben. Poner `actualizado:
   Date.now()` a mano en cada una es garantía de olvido, así que no se hace
   a mano: TODA escritura pasa por `escribir()` en el store, que llama a
   `sellar()` con el estado anterior y el parcial nuevo, y aquí se decide
   fila a fila si el reloj tiene que avanzar. Añadir una acción nueva no
   requiere acordarse de nada; añadir una COLECCIÓN nueva sí, y por eso la
   lista de colecciones selladas está en un único sitio, abajo.

   El criterio es "ha cambiado el contenido", no "ha cambiado la
   referencia": el primer filtro es la identidad (barato, y descarta todas
   las filas que la acción ni tocó), y solo para las pocas que quedan se
   compara el contenido. Así una acción que reconstruye un objeto sin
   cambiar nada —`setEpigrafes` rehace el array entero cada vez— no marca
   como sucias filas idénticas ni las hace viajar sin motivo.
   ============================================================ */

interface ConReloj {
  actualizado?: number;
}

/** Estado que sella este módulo. El store cumple esta forma. */
export interface Sellable {
  materias: Materia[];
  temas: Tema[];
  progresos: Record<string, ProgresoTema>;
  cantes: Cante[];
  keypoints: KeyPoint[];
  notas: Nota[];
  simulacros: Simulacro[];
  vueltas: Vuelta[];
}

/**
 * Colecciones de tipo array con reloj propio. `temas` va aparte porque
 * lleva epígrafes anidados, que son filas con su propio reloj.
 *
 * `vueltas` está aunque sea append-only: nadie edita una vuelta, pero la
 * cascada del tema las entierra, y una tumba sin reloj no se puede empujar.
 *
 * `sesiones` NO está: ni se editan ni se entierran (borrar un tema no borra
 * las horas), así que no tienen nada que sellar.
 */
const LISTAS_SELLADAS = [
  "materias",
  "cantes",
  "keypoints",
  "notas",
  "simulacros",
  "vueltas",
] as const;

/**
 * Igualdad estructural ignorando ciertas claves del primer nivel.
 * Solo se llama sobre filas cuya referencia ya sabemos que cambió, así que
 * el coste es una fila o dos por escritura.
 */
function iguales(a: unknown, b: unknown, omitir: readonly string[] = []): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  const arrA = Array.isArray(a);
  if (arrA !== Array.isArray(b)) return false;
  if (arrA) {
    const la = a as unknown[];
    const lb = b as unknown[];
    if (la.length !== lb.length) return false;
    return la.every((x, i) => iguales(x, lb[i]));
  }
  const oa = a as Record<string, unknown>;
  const ob = b as Record<string, unknown>;
  const claves = new Set([...Object.keys(oa), ...Object.keys(ob)]);
  for (const k of omitir) claves.delete(k);
  for (const k of claves) {
    if (!iguales(oa[k], ob[k])) return false;
  }
  return true;
}

const SOLO_RELOJ = ["actualizado"] as const;

function sellarFila<T extends ConReloj>(
  fila: T,
  previa: T | undefined,
  ahora: number,
  omitir: readonly string[] = SOLO_RELOJ,
): T {
  if (previa === fila) return fila;
  // Fila nueva: si la acción ya le puso reloj se respeta (puede venir de un
  // import o de un pull con la fecha del otro dispositivo).
  if (!previa) {
    return typeof fila.actualizado === "number" ? fila : { ...fila, actualizado: ahora };
  }
  if (iguales(fila, previa, omitir)) return fila;
  // Monotónico por fila, igual que el trigger del servidor
  // (`greatest(now(), old.updated_at + 1 ms)`): dos ediciones dentro del
  // mismo milisegundo tienen que dejar relojes distintos, o la segunda no
  // se distinguiría de la primera y el pull de otro dispositivo podría
  // considerarla ya bajada.
  return { ...fila, actualizado: Math.max(ahora, (previa.actualizado ?? 0) + 1) };
}

function porId<T extends { id: string }>(filas: T[] | undefined): Map<string, T> {
  const mapa = new Map<string, T>();
  for (const f of filas ?? []) mapa.set(f.id, f);
  return mapa;
}

/** Devuelve el array original si ninguna fila ha necesitado sello. */
function sellarLista<T extends ConReloj & { id: string }>(
  filas: T[],
  previas: T[],
  ahora: number,
): T[] {
  const antes = porId(previas);
  let cambia = false;
  const salida = filas.map((f) => {
    const sellada = sellarFila(f, antes.get(f.id), ahora);
    if (sellada !== f) cambia = true;
    return sellada;
  });
  return cambia ? salida : filas;
}

function sellarEpigrafes(
  epigrafes: Epigrafe[],
  previos: Epigrafe[] | undefined,
  ahora: number,
): Epigrafe[] {
  const antes = porId(previos);
  let cambia = false;
  const salida = epigrafes.map((e) => {
    const sellado = sellarFila(e, antes.get(e.id), ahora);
    if (sellado !== e) cambia = true;
    return sellado;
  });
  return cambia ? salida : epigrafes;
}

// El tema y sus epígrafes son filas distintas en el servidor: editar el
// título del epígrafe 3 no debe mover el reloj del tema, ni al revés.
const TEMA_OMITE = ["actualizado", "epigrafes"] as const;

function sellarTemas(temas: Tema[], previos: Tema[], ahora: number): Tema[] {
  const antes = porId(previos);
  let cambia = false;
  const salida = temas.map((t) => {
    const previo = antes.get(t.id);
    if (previo === t) return t;
    const epigrafes = sellarEpigrafes(t.epigrafes, previo?.epigrafes, ahora);
    const conEpigrafes = epigrafes === t.epigrafes ? t : { ...t, epigrafes };
    const sellado = sellarFila(conEpigrafes, previo, ahora, TEMA_OMITE);
    if (sellado !== t) cambia = true;
    return sellado;
  });
  return cambia ? salida : temas;
}

function sellarProgresos(
  progresos: Record<string, ProgresoTema>,
  previos: Record<string, ProgresoTema>,
  ahora: number,
): Record<string, ProgresoTema> {
  let cambia = false;
  const salida: Record<string, ProgresoTema> = {};
  for (const [temaId, p] of Object.entries(progresos)) {
    const sellado = sellarFila(p, previos[temaId], ahora);
    if (sellado !== p) cambia = true;
    salida[temaId] = sellado;
  }
  return cambia ? salida : progresos;
}

/**
 * Sella el parcial que va a entrar en el store.
 *
 * Solo mira las claves que trae el parcial: una acción que escribe `crono`
 * no paga nada. Devuelve el mismo objeto si no ha habido que tocar nada.
 */
export function sellar<P extends Partial<Sellable>>(
  previo: Sellable,
  parcial: P,
  ahora: number = Date.now(),
): P {
  const salida: Record<string, unknown> = { ...parcial };
  let cambia = false;

  const registrar = (clave: string, valor: unknown, original: unknown) => {
    if (valor === original) return;
    salida[clave] = valor;
    cambia = true;
  };

  for (const clave of LISTAS_SELLADAS) {
    const filas = parcial[clave];
    if (!filas) continue;
    registrar(
      clave,
      sellarLista(filas as (ConReloj & { id: string })[], previo[clave], ahora),
      filas,
    );
  }

  if (parcial.temas) {
    registrar("temas", sellarTemas(parcial.temas, previo.temas, ahora), parcial.temas);
  }
  if (parcial.progresos) {
    registrar(
      "progresos",
      sellarProgresos(parcial.progresos, previo.progresos, ahora),
      parcial.progresos,
    );
  }

  return (cambia ? salida : parcial) as P;
}

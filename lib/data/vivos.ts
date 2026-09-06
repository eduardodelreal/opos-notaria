import type { Tema } from "./types";

/* ============================================================
   El punto único donde se filtra lo borrado

   El borrado es lógico: `removeTema` no quita la fila, le pone `borrado`
   (el `deleted_at` del esquema). Es la única forma de que el borrado viaje
   —un DELETE físico no deja nada que bajar al otro dispositivo y la fila
   resucitaría en el siguiente pull— pero deja el estado lleno de filas que
   la app NO debe ver. Un solo olvido y al opositor le salen temas fantasma.

   Por eso no hay `.filter((x) => !x.borrado)` repartido por las páginas:
   toda lectura pasa por aquí, y las páginas leen a través de los hooks del
   store (`useTemas`, `useCantes`, …), que son lo único que llama a estas
   funciones. Si mañana aparece otra colección con tumbas, se añade aquí.

   Sobre el caché: los selectores de Zustand comparan por identidad, así que
   derivar un array nuevo en cada render provoca el bucle infinito de
   renders (React #185) que ya nos costó una tarde. El WeakMap devuelve
   SIEMPRE la misma referencia para la misma entrada, y como el store nunca
   muta un array en sitio (siempre crea uno nuevo), la caché se invalida
   sola. Cuando no hay ninguna tumba se devuelve el array original tal cual:
   el caso normal no asigna nada.
   ============================================================ */

export interface Borrable {
  borrado?: number;
}

const cacheListas = new WeakMap<object, unknown>();

/** Filas vivas de una colección. Referencia estable por array de entrada. */
export function vivos<T extends Borrable>(filas: T[]): T[] {
  const cacheado = cacheListas.get(filas);
  if (cacheado) return cacheado as T[];
  const salida = filas.some((f) => f.borrado != null)
    ? filas.filter((f) => f.borrado == null)
    : filas;
  cacheListas.set(filas, salida);
  return salida;
}

/** Igual, para los mapas por id (hoy `progresos`, indexado por temaId). */
export function vivosMapa<T extends Borrable>(
  mapa: Record<string, T>,
): Record<string, T> {
  const cacheado = cacheListas.get(mapa);
  if (cacheado) return cacheado as Record<string, T>;
  let hayTumbas = false;
  for (const v of Object.values(mapa)) {
    if (v.borrado != null) {
      hayTumbas = true;
      break;
    }
  }
  let salida = mapa;
  if (hayTumbas) {
    salida = {};
    for (const [k, v] of Object.entries(mapa)) {
      if (v.borrado == null) salida[k] = v;
    }
  }
  cacheListas.set(mapa, salida);
  return salida;
}

/**
 * Temas vivos, y dentro de cada uno solo sus epígrafes vivos.
 *
 * Los epígrafes van anidados en el tema por comodidad de la UI, pero en el
 * servidor son filas con su propio reloj, así que sus tumbas se quedan en
 * el array. Nadie fuera de aquí debería mirar `tema.epigrafes` en crudo:
 * saneamos el tema entero de una vez para que quien tenga un `Tema` en la
 * mano pueda usarlo sin saber nada de todo esto.
 */
export function temasVivos(temas: Tema[]): Tema[] {
  const cacheado = cacheListas.get(temas);
  if (cacheado) return cacheado as Tema[];

  let cambia = false;
  const salida: Tema[] = [];
  for (const t of temas) {
    if (t.borrado != null) {
      cambia = true;
      continue;
    }
    const epigrafes = vivos(t.epigrafes);
    if (epigrafes === t.epigrafes) salida.push(t);
    else {
      cambia = true;
      salida.push({ ...t, epigrafes });
    }
  }

  const fin = cambia ? salida : temas;
  cacheListas.set(temas, fin);
  return fin;
}

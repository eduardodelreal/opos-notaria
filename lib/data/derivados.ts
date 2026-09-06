import type { Cante, ProgresoTema, Sesion, Vuelta } from "./types";

/* ============================================================
   Contadores derivados

   `ProgresoTema.segundos`, `.notaMedia` y `.vueltas` son acumuladores, y el
   last-write-wins por fila los trunca: 40 minutos en el portátil y 30 en el
   móvil sin sincronizar entre medias dan 40 o 30, nunca 70. Esta app existe
   para dar el número honesto de horas, así que ese redondeo no es aceptable.

   La salida no es un CRDT: es que los tres salen de colecciones append-only
   —`sesiones`, `cantes`, `vueltas`—, que no tienen conflicto porque nadie
   edita una fila ya escrita. Dos dispositivos que graban sesiones distintas
   acaban con la unión de ambas, y la suma sale sola.

   Las columnas del progreso se quedan como caché (evitan agregar en cada
   render y viajan a Supabase para que el servidor no tenga que agregar),
   pero lo que se pinta en pantalla sale siempre de aquí.
   ============================================================ */

/** Segundos efectivos por tema, sumados de las sesiones. */
export function segundosPorTema(sesiones: Sesion[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const s of sesiones) {
    if (!s.temaId) continue;
    mapa.set(s.temaId, (mapa.get(s.temaId) ?? 0) + s.segundos);
  }
  return mapa;
}

/** Media de las notas de cante por tema. Los cantes sin nota no cuentan. */
export function notaMediaPorTema(cantes: Cante[]): Map<string, number> {
  const suma = new Map<string, { total: number; n: number }>();
  for (const c of cantes) {
    if (c.nota == null) continue;
    const acc = suma.get(c.temaId) ?? { total: 0, n: 0 };
    acc.total += c.nota;
    acc.n += 1;
    suma.set(c.temaId, acc);
  }
  const mapa = new Map<string, number>();
  for (const [temaId, { total, n }] of suma) {
    mapa.set(temaId, Number((total / n).toFixed(1)));
  }
  return mapa;
}

/** Vueltas cerradas por tema: una por cada transición registrada a dominado. */
export function vueltasPorTema(vueltas: Vuelta[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const v of vueltas) {
    mapa.set(v.temaId, (mapa.get(v.temaId) ?? 0) + 1);
  }
  return mapa;
}

export function segundosDeTema(temaId: string, sesiones: Sesion[]): number {
  let total = 0;
  for (const s of sesiones) if (s.temaId === temaId) total += s.segundos;
  return total;
}

export function notaMediaDeTema(
  temaId: string,
  cantes: Cante[],
): number | undefined {
  const notas = cantes
    .filter((c) => c.temaId === temaId && c.nota != null)
    .map((c) => c.nota as number);
  if (!notas.length) return undefined;
  return Number((notas.reduce((a, b) => a + b, 0) / notas.length).toFixed(1));
}

export function vueltasDeTema(temaId: string, vueltas: Vuelta[]): number {
  return vueltas.reduce((n, v) => n + (v.temaId === temaId ? 1 : 0), 0);
}

/**
 * Devuelve el progreso con los tres contadores recalculados.
 *
 * Solo se reescriben los temas que ya tienen progreso: crear entradas para
 * temas que no lo tienen cambiaría el comportamiento de la cola de repaso,
 * que distingue "sin progreso" de "progreso en estado nuevo".
 */
export function derivarProgresos(
  progresos: Record<string, ProgresoTema>,
  sesiones: Sesion[],
  cantes: Cante[],
  vueltas: Vuelta[],
): Record<string, ProgresoTema> {
  const segundos = segundosPorTema(sesiones);
  const notas = notaMediaPorTema(cantes);
  const cuenta = vueltasPorTema(vueltas);

  const salida: Record<string, ProgresoTema> = {};
  for (const [temaId, p] of Object.entries(progresos)) {
    salida[temaId] = {
      ...p,
      segundos: segundos.get(temaId) ?? 0,
      notaMedia: notas.get(temaId),
      vueltas: cuenta.get(temaId) ?? 0,
    };
  }
  return salida;
}

import type {
  Cante,
  Epigrafe,
  KeyPoint,
  Materia,
  Nota,
  Perfil,
  ProgresoTema,
  Sesion,
  Simulacro,
  Tema,
  Vuelta,
} from "../data/types";
import { ahoraSellado, desfaseAplicable } from "./reloj";
import {
  aFilaCante,
  aFilaEpigrafe,
  aFilaKeyPoint,
  aFilaMateria,
  aFilaNota,
  aFilaPerfil,
  aFilaProgreso,
  aFilaSesion,
  aFilaSimulacro,
  aFilaTema,
  aFilaVuelta,
  type Fila,
  type Tabla,
} from "./tablas";

/* ============================================================
   El expediente: lo que se sincroniza del store

   Es exactamente el trozo del estado que tiene destino en Supabase. Fuera
   se quedan, a propósito, el chat (§9.6: historial voluminoso cuyo valor
   cae a cero al terminar la sesión y que ni siquiera tiene tabla) y el
   cronómetro activo (§9.7: estado de sesión, no dato).

   Está declarado como interfaz propia y no como `Pick<Estado, …>` para que
   el motor se pueda ejercitar sin store: las pruebas de integración montan
   dos "dispositivos" como dos objetos planos, y así lo que se prueba es el
   motor de verdad y no un doble.
   ============================================================ */

export interface Expediente {
  perfil: Perfil;
  materias: Materia[];
  temas: Tema[];
  progresos: Record<string, ProgresoTema>;
  sesiones: Sesion[];
  cantes: Cante[];
  keypoints: KeyPoint[];
  notas: Nota[];
  simulacros: Simulacro[];
  vueltas: Vuelta[];
}

/** Marcas de la sincronización con la cuenta actual. Viven en IndexedDB. */
export interface Marcas {
  /** Cuenta con la que se sincronizó por última vez. */
  usuarioId: string | null;
  /** Cursor del pull incremental, en ms. 0 = no se ha bajado nada nunca. */
  ultimoPull: number;
  /**
   * Reloj del last-write-wins del perfil.
   *
   * `Perfil` es el único tipo del dominio sin campo `actualizado`: es un
   * singleton sin id que la app trata como ajustes, no como una fila. Su
   * reloj tiene que vivir en algún sitio, y este es el sitio.
   */
  perfilActualizado: number;
  /** Última sincronización terminada sin error, en ms. */
  ultimaSync: number;
  /** ¿Se hizo ya la reconciliación de primer arranque con esta cuenta? */
  primeraHecha: boolean;
  /**
   * Desfase estimado entre el reloj del servidor y el de este aparato, en ms
   * (`servidor − local`). Ver lib/sync/reloj.ts y docs/sincronizacion.md §4.
   */
  desfaseReloj: number;
  /**
   * El `creado_at` más nuevo que se ha visto venir del servidor. Es lo que
   * distingue un lote que ha insertado filas —cuya medida vale— de uno de
   * puros updates, que devuelve marcas de nacimiento viejas. 0 = ninguno.
   */
  desfaseServidor: number;
  /** Desfase que está pendiente de confirmarse. Ver `medirDesfase`. */
  desfaseCandidato: number;
  /** Medidas coherentes que apoyan al candidato. */
  desfaseConfirmaciones: number;
}

export const MARCAS_INICIALES: Marcas = {
  usuarioId: null,
  ultimoPull: 0,
  perfilActualizado: 0,
  ultimaSync: 0,
  primeraHecha: false,
  desfaseReloj: 0,
  desfaseServidor: 0,
  desfaseCandidato: 0,
  desfaseConfirmaciones: 0,
};

/**
 * Índice de epígrafes por id, con el tema al que pertenecen.
 *
 * En local viven anidados dentro del tema y en el servidor son filas
 * sueltas (§9.2), así que el push necesita poder ir del id a su tema sin
 * recorrer el temario entero por cada entrada de la cola.
 */
export function indiceEpigrafes(
  temas: Tema[],
): Map<string, { temaId: string; epigrafe: Epigrafe }> {
  const mapa = new Map<string, { temaId: string; epigrafe: Epigrafe }>();
  for (const t of temas) {
    for (const e of t.epigrafes) mapa.set(e.id, { temaId: t.id, epigrafe: e });
  }
  return mapa;
}

/** Lo que hace falta para convertir el expediente en filas. */
export interface ContextoPush {
  usuarioId: string;
  marcas: Marcas;
  epigrafes: Map<string, { temaId: string; epigrafe: Epigrafe }>;
}

export function contextoPush(exp: Expediente, usuarioId: string, marcas: Marcas): ContextoPush {
  return { usuarioId, marcas, epigrafes: indiceEpigrafes(exp.temas) };
}

function porId<T>(filas: T[], id: (f: T) => string): Map<string, T> {
  const mapa = new Map<string, T>();
  for (const f of filas) mapa.set(id(f), f);
  return mapa;
}

/**
 * Las filas que hay que subir de una tabla, leídas del estado ACTUAL
 * (§3.1): la cola guarda `{tabla, id}` y nunca la fila, así que cinco
 * ediciones offline de la misma nota suben una vez y con el valor final.
 *
 * Los ids que ya no tienen fila se devuelven en `ausentes` para poder
 * sacarlos de la cola: pasa con las materias sembradas que la primera
 * sincronización descarta, que nunca existieron en el servidor y por tanto
 * no hay nada que subir ni nada que enterrar.
 *
 * El índice se construye una vez por tabla y no una búsqueda por id: en la
 * primera sincronización la cola tiene el expediente entero, y buscar en un
 * array por cada entrada convierte el primer push en cuadrático.
 */
export function filasParaPush(
  exp: Expediente,
  tabla: Tabla,
  ids: string[],
  ctx: ContextoPush,
): { filas: { id: string; fila: Fila }[]; ausentes: string[] } {
  const uid = ctx.usuarioId;
  const filas: { id: string; fila: Fila }[] = [];
  const ausentes: string[] = [];

  const recoger = (id: string, fila: Fila | null | undefined) => {
    if (fila) filas.push({ id, fila });
    else ausentes.push(id);
  };

  switch (tabla) {
    case "perfiles": {
      for (const id of ids) {
        recoger(
          id,
          aFilaPerfil(exp.perfil, uid, ctx.marcas.perfilActualizado || ahoraSellado(ctx.marcas)),
        );
      }
      break;
    }
    case "materias": {
      const idx = porId(exp.materias, (m) => m.id);
      for (const id of ids) recoger(id, idx.has(id) ? aFilaMateria(idx.get(id)!, uid) : null);
      break;
    }
    case "temas": {
      const idx = porId(exp.temas, (t) => t.id);
      for (const id of ids) recoger(id, idx.has(id) ? aFilaTema(idx.get(id)!, uid) : null);
      break;
    }
    case "epigrafes": {
      for (const id of ids) {
        const e = ctx.epigrafes.get(id);
        recoger(id, e ? aFilaEpigrafe(e.epigrafe, e.temaId, uid) : null);
      }
      break;
    }
    case "progreso_temas": {
      for (const id of ids) {
        const p = exp.progresos[id];
        recoger(id, p ? aFilaProgreso(p, uid) : null);
      }
      break;
    }
    case "sesiones": {
      // La única tabla cuyo `updated_at` no lo pone el sellado del store:
      // `Sesion` no tiene campo `actualizado` porque no hay nada que
      // arbitrar. El desfase del reloj se le aplica aquí (ver `relojSesion`).
      const desfase = desfaseAplicable(ctx.marcas);
      const idx = porId(exp.sesiones, (s) => s.id);
      for (const id of ids) {
        recoger(id, idx.has(id) ? aFilaSesion(idx.get(id)!, uid, desfase) : null);
      }
      break;
    }
    case "cantes": {
      const idx = porId(exp.cantes, (c) => c.id);
      for (const id of ids) recoger(id, idx.has(id) ? aFilaCante(idx.get(id)!, uid) : null);
      break;
    }
    case "keypoints": {
      const idx = porId(exp.keypoints, (k) => k.id);
      for (const id of ids) recoger(id, idx.has(id) ? aFilaKeyPoint(idx.get(id)!, uid) : null);
      break;
    }
    case "notas": {
      const idx = porId(exp.notas, (n) => n.id);
      for (const id of ids) recoger(id, idx.has(id) ? aFilaNota(idx.get(id)!, uid) : null);
      break;
    }
    case "simulacros": {
      const idx = porId(exp.simulacros, (s) => s.id);
      for (const id of ids) recoger(id, idx.has(id) ? aFilaSimulacro(idx.get(id)!, uid) : null);
      break;
    }
    case "vueltas": {
      const idx = porId(exp.vueltas, (v) => v.id);
      for (const id of ids) recoger(id, idx.has(id) ? aFilaVuelta(idx.get(id)!, uid) : null);
      break;
    }
    default: {
      // Tabla nueva sin caso: que rompa la compilación, no la sincronización.
      const nunca: never = tabla;
      throw new Error(`tabla sin mapeo: ${String(nunca)}`);
    }
  }

  return { filas, ausentes };
}

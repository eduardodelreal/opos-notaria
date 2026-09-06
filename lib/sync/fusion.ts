import { derivarProgresos } from "../data/derivados";
import type {
  Cante,
  Epigrafe,
  KeyPoint,
  Nota,
  Materia,
  ProgresoTema,
  Sesion,
  Simulacro,
  Tema,
  Vuelta,
} from "../data/types";
import type { Expediente, Marcas } from "./expediente";
import {
  deFilaCante,
  deFilaEpigrafe,
  deFilaKeyPoint,
  deFilaMateria,
  deFilaNota,
  deFilaPerfil,
  deFilaProgreso,
  deFilaSesion,
  deFilaSimulacro,
  deFilaTema,
  deFilaVuelta,
  relojFila,
  type Fila,
  type FilaCante,
  type FilaEpigrafe,
  type FilaKeyPoint,
  type FilaMateria,
  type FilaNota,
  type FilaPerfil,
  type FilaProgreso,
  type FilaSesion,
  type FilaSimulacro,
  type FilaTema,
  type FilaVuelta,
  type Tabla,
} from "./tablas";

/* ============================================================
   Fusión: qué pasa cuando una fila del servidor aterriza en local

   Last-write-wins por fila (§4), sin merge por campos:

       remoto > local  →  gana el remoto, se sobrescribe
       remoto < local  →  gana el local, se deja y se REENCOLA para push
       iguales         →  no se toca nada

   Esta función se usa en los dos sitios donde llegan filas del servidor: el
   pull y el `RETURNING` del upsert. Que sea la misma no es economía de
   código, es lo que hace que adoptar la fila ganadora que devuelve el push
   (§4) se comporte exactamente igual que si hubiera bajado en un pull.

   Dos cosas que NO son opcionales:

   · Una fila con `deleted_at` se marca borrada en local. Ignorarla es
     exactamente el bug que hace que un tema borrado en el móvil reaparezca
     en el portátil.
   · Tras aplicar, los contadores derivados se recalculan desde las
     colecciones append-only (§6). Si no, `segundos` y `notaMedia` se quedan
     con lo que dijera la fila ganadora y las horas mienten en cuanto se
     estudia el mismo tema en dos sitios.
   ============================================================ */

export interface LoteBajado {
  tabla: Tabla;
  filas: Fila[];
}

export interface ResultadoFusion {
  /** Solo las colecciones que han cambiado. */
  expediente: Partial<Expediente>;
  /** Filas en las que ha ganado el local: hay que volver a empujarlas. */
  reencolar: { tabla: Tabla; id: string }[];
  /** Nuevo reloj del perfil, si el remoto ha ganado. */
  perfilActualizado?: number;
  /** El `updated_at` máximo recibido. Es el cursor del pull (§3.2). */
  maxReloj: number;
  /** Cuántas filas han cambiado algo en local. */
  aplicadas: number;
}

interface Acumulador {
  exp: Expediente;
  cambia: Set<keyof Expediente>;
  reencolar: { tabla: Tabla; id: string }[];
  perfilActualizado?: number;
  maxReloj: number;
  aplicadas: number;
  /** Temas que esta fusión ha enterrado: hay que cascadear en local. */
  enterrados: Set<string>;
}

export function fusionar(
  exp: Expediente,
  lotes: LoteBajado[],
  marcas: Marcas,
): ResultadoFusion {
  const acc: Acumulador = {
    exp: { ...exp },
    cambia: new Set(),
    reencolar: [],
    maxReloj: 0,
    aplicadas: 0,
    enterrados: new Set(),
  };

  for (const lote of lotes) {
    for (const fila of lote.filas) {
      acc.maxReloj = Math.max(acc.maxReloj, relojFila(fila));
    }
    aplicarLote(acc, lote, marcas);
  }

  if (acc.enterrados.size) cascadaLocal(acc);

  // Los contadores en caché de `progreso_temas` se rehacen desde `sesiones`,
  // `cantes` y `vueltas` SIEMPRE que baja algo, no solo cuando baja un
  // progreso: la fila que los arregla puede ser una sesión del otro
  // dispositivo. No mueve ningún reloj ni encola nada — es caché, y
  // encolarla haría que dos dispositivos se la reenviaran sin fin.
  if (acc.cambia.size) rehacerDerivados(acc);

  const expediente: Partial<Expediente> = {};
  for (const k of acc.cambia) {
    // El índice genérico sobre Expediente no se estrecha solo; el valor sale
    // del mismo objeto, así que la copia es correcta por construcción.
    (expediente as unknown as Record<string, unknown>)[k] = acc.exp[k];
  }

  return {
    expediente,
    reencolar: acc.reencolar,
    perfilActualizado: acc.perfilActualizado,
    maxReloj: acc.maxReloj,
    aplicadas: acc.aplicadas,
  };
}

/* ------------------------------------------------------------- por tabla -- */

function aplicarLote(acc: Acumulador, lote: LoteBajado, marcas: Marcas): void {
  switch (lote.tabla) {
    case "perfiles":
      return aplicarPerfil(acc, lote.filas as FilaPerfil[], marcas);
    case "materias":
      return lista<Materia, FilaMateria>(
        acc,
        "materias",
        lote.filas as FilaMateria[],
        deFilaMateria,
        (m) => m.actualizado,
      );
    case "temas":
      return aplicarTemas(acc, lote.filas as FilaTema[]);
    case "epigrafes":
      return aplicarEpigrafes(acc, lote.filas as FilaEpigrafe[]);
    case "progreso_temas":
      return aplicarProgresos(acc, lote.filas as FilaProgreso[]);
    case "sesiones":
      return aplicarSesiones(acc, lote.filas as FilaSesion[]);
    case "cantes":
      return lista<Cante, FilaCante>(
        acc,
        "cantes",
        lote.filas as FilaCante[],
        deFilaCante,
        (c) => c.actualizado,
        fundirCante,
      );
    case "keypoints":
      return lista<KeyPoint, FilaKeyPoint>(
        acc,
        "keypoints",
        lote.filas as FilaKeyPoint[],
        deFilaKeyPoint,
        (k) => k.actualizado,
      );
    case "notas":
      return lista<Nota, FilaNota>(
        acc,
        "notas",
        lote.filas as FilaNota[],
        deFilaNota,
        (n) => n.actualizado,
      );
    case "simulacros":
      return lista<Simulacro, FilaSimulacro>(
        acc,
        "simulacros",
        lote.filas as FilaSimulacro[],
        deFilaSimulacro,
        (s) => s.actualizado,
      );
    case "vueltas":
      return lista<Vuelta, FilaVuelta>(
        acc,
        "vueltas",
        lote.filas as FilaVuelta[],
        deFilaVuelta,
        (v) => v.actualizado,
      );
    default: {
      const nunca: never = lote.tabla;
      throw new Error(`tabla sin fusión: ${String(nunca)}`);
    }
  }
}

/**
 * Colecciones planas con id y reloj: materias, cantes, keypoints, notas…
 *
 * `fundir` es para las entidades en las que ganar el last-write-wins no
 * significa "lo que tú tienes de más ya no vale". Devuelve la fila fundida
 * y, en `devolver`, si el resultado conserva algo que el servidor todavía no
 * tiene: entonces la fila se REENCOLA aunque haya perdido el arbitraje, para
 * que ese algo suba en el siguiente ciclo. Hoy solo lo usan los cantes.
 */
function lista<E extends { id: string }, F extends Fila>(
  acc: Acumulador,
  clave: "materias" | "cantes" | "keypoints" | "notas" | "simulacros" | "vueltas",
  filas: F[],
  deFila: (f: F) => E,
  reloj: (e: E) => number,
  fundir?: (local: E, entrante: E) => { fila: E; devolver: boolean },
): void {
  if (!filas.length) return;
  const actual = acc.exp[clave] as unknown as E[];
  const indice = new Map(actual.map((e, i) => [e.id, i]));
  let salida: E[] | null = null;

  for (const f of filas) {
    const entrante = deFila(f);
    const i = indice.get(entrante.id);
    if (i == null) {
      salida = salida ?? [...actual];
      indice.set(entrante.id, salida.length);
      salida.push(entrante);
      acc.aplicadas += 1;
      continue;
    }
    const local = (salida ?? actual)[i];
    const rl = reloj(local);
    const rr = reloj(entrante);
    if (rr > rl) {
      salida = salida ?? [...actual];
      if (fundir) {
        const fundido = fundir(local, entrante);
        salida[i] = fundido.fila;
        if (fundido.devolver) acc.reencolar.push({ tabla: clave, id: entrante.id });
      } else {
        salida[i] = entrante;
      }
      acc.aplicadas += 1;
    } else if (rr < rl) {
      acc.reencolar.push({ tabla: clave, id: entrante.id });
    }
  }

  if (salida) {
    (acc.exp as unknown as Record<string, unknown>)[clave] = salida;
    acc.cambia.add(clave);
  }
}

/**
 * Lo que el cante remoto NO puede borrar aunque gane el arbitraje.
 *
 * Desde 0005 `transcripcion` y `comparacion` tienen columna, así que la fila
 * que baja SÍ habla de ellas. Aun así se sigue conservando lo local cuando
 * lo que baja es `null`, y ahora por un motivo distinto del de antes: estos
 * dos campos solo van de ausente a presente. Nadie los vacía —no hay acción
 * en el store que los borre— así que un `null` que baja no es "esto ya no
 * vale", es "el dispositivo que escribió esa fila todavía no los tenía".
 * Pisar con ese hueco costaría otra transcripción del cante entero y otra
 * llamada al modelo.
 *
 * Y como ahora sí tienen sitio en el servidor, conservarlos no basta: hay
 * que DEVOLVERLOS. Si nos quedamos el análisis y no reencolamos la fila, el
 * único aparato que lo tiene es este y el otro seguirá regenerándolo. El
 * reencolado termina solo: al subirlo, la fila del servidor ya lo trae y la
 * siguiente fusión no encuentra nada que devolver.
 *
 * De la ficha del audio, en cambio, la fila solo trae `audio_path`; el mime,
 * la duración y las marcas de epígrafe siguen sin columna, son de este
 * aparato y no hay adónde devolverlas.
 */
function fundirCante(local: Cante, entrante: Cante): { fila: Cante; devolver: boolean } {
  const transcripcion = entrante.transcripcion ?? local.transcripcion;
  const comparacion = entrante.comparacion ?? local.comparacion;
  return {
    fila: {
      ...entrante,
      audio: entrante.audio ? { ...local.audio, ...entrante.audio } : local.audio,
      transcripcion,
      comparacion,
    },
    devolver:
      (transcripcion != null && entrante.transcripcion == null) ||
      (comparacion != null && entrante.comparacion == null),
  };
}

function aplicarPerfil(acc: Acumulador, filas: FilaPerfil[], marcas: Marcas): void {
  for (const f of filas) {
    const rr = relojFila(f);
    const rl = acc.perfilActualizado ?? marcas.perfilActualizado;
    if (rr > rl) {
      acc.exp.perfil = deFilaPerfil(f);
      acc.perfilActualizado = rr;
      acc.cambia.add("perfil");
      acc.aplicadas += 1;
    } else if (rr < rl) {
      acc.reencolar.push({ tabla: "perfiles", id: f.id });
    }
  }
}

function aplicarTemas(acc: Acumulador, filas: FilaTema[]): void {
  if (!filas.length) return;
  const actual = acc.exp.temas;
  const indice = new Map(actual.map((t, i) => [t.id, i]));
  let salida: Tema[] | null = null;

  for (const f of filas) {
    const entrante = deFilaTema(f);
    const i = indice.get(entrante.id);
    if (i == null) {
      salida = salida ?? [...actual];
      indice.set(entrante.id, salida.length);
      // Sin epígrafes: bajan por su tabla y se reanidan aquí (§9.2).
      salida.push({ ...entrante, epigrafes: [] });
      acc.aplicadas += 1;
      if (entrante.borrado != null) acc.enterrados.add(entrante.id);
      continue;
    }
    const local = (salida ?? actual)[i];
    if (entrante.actualizado > local.actualizado) {
      salida = salida ?? [...actual];
      // Los epígrafes locales se conservan: el tema que baja no los trae.
      salida[i] = { ...entrante, epigrafes: local.epigrafes };
      acc.aplicadas += 1;
      if (entrante.borrado != null && local.borrado == null) acc.enterrados.add(entrante.id);
    } else if (entrante.actualizado < local.actualizado) {
      acc.reencolar.push({ tabla: "temas", id: entrante.id });
    }
  }

  if (salida) {
    acc.exp.temas = salida;
    acc.cambia.add("temas");
  }
}

function aplicarEpigrafes(acc: Acumulador, filas: FilaEpigrafe[]): void {
  if (!filas.length) return;
  // Agrupados por tema para no rehacer el array de temas una vez por
  // epígrafe: al montar el temario bajan cientos de golpe.
  const porTema = new Map<string, Epigrafe[]>();
  for (const f of filas) {
    const { temaId, ...epigrafe } = deFilaEpigrafe(f);
    const lista = porTema.get(temaId);
    if (lista) lista.push(epigrafe);
    else porTema.set(temaId, [epigrafe]);
  }

  let salida: Tema[] | null = null;
  const actual = acc.exp.temas;

  for (const [temaId, entrantes] of porTema) {
    const i = actual.findIndex((t) => t.id === temaId);
    // Epígrafe sin tema en local: no se puede reanidar en ninguna parte. No
    // debería ocurrir —el tema viaja en el mismo pull y se aplica antes—,
    // así que se deja pasar en vez de inventarle un tema fantasma.
    if (i < 0) continue;

    const tema = (salida ?? actual)[i];
    const indice = new Map(tema.epigrafes.map((e, j) => [e.id, j]));
    let hijos: Epigrafe[] | null = null;

    for (const entrante of entrantes) {
      const j = indice.get(entrante.id);
      if (j == null) {
        hijos = hijos ?? [...tema.epigrafes];
        indice.set(entrante.id, hijos.length);
        hijos.push(entrante);
        acc.aplicadas += 1;
        continue;
      }
      const local = (hijos ?? tema.epigrafes)[j];
      if (entrante.actualizado > local.actualizado) {
        hijos = hijos ?? [...tema.epigrafes];
        hijos[j] = entrante;
        acc.aplicadas += 1;
      } else if (entrante.actualizado < local.actualizado) {
        acc.reencolar.push({ tabla: "epigrafes", id: entrante.id });
      }
    }

    if (hijos) {
      salida = salida ?? [...actual];
      salida[i] = { ...tema, epigrafes: hijos };
    }
  }

  if (salida) {
    acc.exp.temas = salida;
    acc.cambia.add("temas");
  }
}

function aplicarProgresos(acc: Acumulador, filas: FilaProgreso[]): void {
  if (!filas.length) return;
  const actual = acc.exp.progresos;
  let salida: Record<string, ProgresoTema> | null = null;

  for (const f of filas) {
    const entrante = deFilaProgreso(f);
    const local = (salida ?? actual)[entrante.temaId];
    if (!local) {
      salida = salida ?? { ...actual };
      salida[entrante.temaId] = entrante;
      acc.aplicadas += 1;
    } else if (entrante.actualizado > local.actualizado) {
      salida = salida ?? { ...actual };
      salida[entrante.temaId] = entrante;
      acc.aplicadas += 1;
    } else if (entrante.actualizado < local.actualizado) {
      acc.reencolar.push({ tabla: "progreso_temas", id: entrante.temaId });
    }
  }

  if (salida) {
    acc.exp.progresos = salida;
    acc.cambia.add("progresos");
  }
}

function aplicarSesiones(acc: Acumulador, filas: FilaSesion[]): void {
  if (!filas.length) return;
  const actual = acc.exp.sesiones;
  const conocidas = new Set(actual.map((s) => s.id));
  let salida: Sesion[] | null = null;

  for (const f of filas) {
    const borrada = f.deleted_at != null;
    if (conocidas.has(f.id)) {
      // Append-only: una sesión que ya está es la misma sesión, no hay nada
      // que arbitrar. Lo único que puede cambiar es que alguien la enterrara
      // con la service_role, y entonces se va también de aquí: el tipo
      // `Sesion` no tiene tumba donde guardar ese estado.
      if (!borrada) continue;
      salida = (salida ?? [...actual]).filter((s) => s.id !== f.id);
      conocidas.delete(f.id);
      acc.aplicadas += 1;
      continue;
    }
    if (borrada) continue;
    salida = salida ?? [...actual];
    salida.push(deFilaSesion(f));
    conocidas.add(f.id);
    acc.aplicadas += 1;
  }

  if (salida) {
    acc.exp.sesiones = salida;
    acc.cambia.add("sesiones");
  }
}

/* -------------------------------------------------------------- cascada -- */

/**
 * La misma cascada que `cascada_borrado_tema()` hace en el servidor y
 * `removeTema` en local (§7).
 *
 * Se repite aquí porque el pull puede traer el tema enterrado antes que sus
 * hijos —los hijos los entierra el trigger con SU reloj, así que llegan en
 * otro momento— y mientras tanto este dispositivo enseñaría los cantes y las
 * notas de un tema que ya no existe. No encola nada: el servidor ya tiene
 * esas tumbas, volvérselas a mandar sería ruido.
 *
 * Las sesiones no se cascadean, aquí tampoco: esas horas son del opositor.
 */
function cascadaLocal(acc: Acumulador): void {
  const ids = acc.enterrados;
  const marca = (t: number | undefined, ref: number) => Math.max(t ?? 0, ref);

  const temas = acc.exp.temas.map((t) => {
    if (!ids.has(t.id)) return t;
    const cuando = t.borrado ?? Date.now();
    const epigrafes = t.epigrafes.map((e) =>
      e.borrado == null
        ? { ...e, borrado: cuando, actualizado: marca(e.actualizado, cuando) }
        : e,
    );
    return { ...t, epigrafes };
  });
  acc.exp.temas = temas;
  acc.cambia.add("temas");

  const cuandoDe = new Map(
    acc.exp.temas.filter((t) => ids.has(t.id)).map((t) => [t.id, t.borrado ?? Date.now()]),
  );

  const porTema = <T extends { temaId: string; borrado?: number; actualizado: number }>(
    filas: T[],
  ): T[] => {
    let cambia = false;
    const salida = filas.map((f) => {
      if (!ids.has(f.temaId) || f.borrado != null) return f;
      cambia = true;
      const cuando = cuandoDe.get(f.temaId) ?? Date.now();
      return { ...f, borrado: cuando, actualizado: marca(f.actualizado, cuando) };
    });
    return cambia ? salida : filas;
  };

  const progresos: Record<string, ProgresoTema> = { ...acc.exp.progresos };
  let tocaProgresos = false;
  for (const temaId of ids) {
    const p = progresos[temaId];
    if (p && p.borrado == null) {
      const cuando = cuandoDe.get(temaId) ?? Date.now();
      progresos[temaId] = { ...p, borrado: cuando, actualizado: marca(p.actualizado, cuando) };
      tocaProgresos = true;
    }
  }
  if (tocaProgresos) {
    acc.exp.progresos = progresos;
    acc.cambia.add("progresos");
  }

  const cantes = porTema(acc.exp.cantes);
  if (cantes !== acc.exp.cantes) {
    acc.exp.cantes = cantes;
    acc.cambia.add("cantes");
  }
  const keypoints = porTema(acc.exp.keypoints);
  if (keypoints !== acc.exp.keypoints) {
    acc.exp.keypoints = keypoints;
    acc.cambia.add("keypoints");
  }
  const notas = porTema(acc.exp.notas);
  if (notas !== acc.exp.notas) {
    acc.exp.notas = notas;
    acc.cambia.add("notas");
  }
  const vueltas = porTema(acc.exp.vueltas);
  if (vueltas !== acc.exp.vueltas) {
    acc.exp.vueltas = vueltas;
    acc.cambia.add("vueltas");
  }
}

/* ------------------------------------------------------------ derivados -- */

/**
 * Rehace `segundos`, `notaMedia` y `vueltas` de cada progreso desde las
 * colecciones append-only (§6).
 *
 * `derivarProgresos` deja fuera las tumbas a propósito (nadie debe ver los
 * contadores de un tema borrado), así que aquí se vuelven a poner: son lo
 * único que puede enterrar ese progreso en el otro dispositivo, y perderlas
 * lo resucitaría en el siguiente push.
 *
 * No mueve `actualizado`. La caché no es un dato: si moviera el reloj, cada
 * pull generaría un push que provocaría el pull del otro, y así siempre.
 */
function rehacerDerivados(acc: Acumulador): void {
  const exp = acc.exp;
  const derivados = derivarProgresos(exp.progresos, exp.sesiones, exp.cantes, exp.vueltas);

  let cambia = false;
  const salida: Record<string, ProgresoTema> = { ...exp.progresos };
  for (const [temaId, p] of Object.entries(derivados)) {
    const previo = exp.progresos[temaId];
    if (
      previo &&
      previo.segundos === p.segundos &&
      previo.notaMedia === p.notaMedia &&
      previo.vueltas === p.vueltas
    ) {
      continue;
    }
    salida[temaId] = p;
    cambia = true;
  }

  if (cambia) {
    acc.exp.progresos = salida;
    acc.cambia.add("progresos");
  }
}

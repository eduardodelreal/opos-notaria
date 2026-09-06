import { esMateriaSembrada } from "../data/materias";
import { perfilDeFabrica } from "../data/perfil";
import {
  clave,
  encolarTodo,
  porTabla,
  quitarSubidas,
  ID_PERFIL,
  type Cola,
} from "./cola";
import {
  contextoPush,
  filasParaPush,
  type Expediente,
  type Marcas,
} from "./expediente";
import { fusionar, type LoteBajado } from "./fusion";
import { ahoraSellado, medirDesfase, muestraDeRespuesta } from "./reloj";
import { relojFila, TABLAS, type Fila, type Tabla } from "./tablas";
import type { Transporte } from "./transporte";

/* ============================================================
   El ciclo

       push de la cola  →  pull de lo tocado desde el cursor  →  fusión
                        →  cursor nuevo

   Las dos mitades son independientes a propósito (§3): si el push falla, el
   pull se intenta igual, porque bajar lo que hizo el otro dispositivo no
   depende de que lo mío haya subido.

   Nada de lo que hay aquí espera a la red antes de dar por buena una
   escritura del usuario: cuando esto corre, el dato lleva rato en
   IndexedDB. Si todo falla, lo único que pasa es que no se propaga.
   ============================================================ */

/** Filas por petición. PostgREST traga lotes grandes; el móvil, menos. */
const LOTE_PUSH = 200;
const LOTE_PULL = 1000;

/**
 * Margen del cursor hacia atrás (§3.2). El pull siguiente vuelve a bajar
 * unos segundos ya vistos: aplicar dos veces la misma fila no hace nada
 * (el LWW la ve igual), y a cambio no se pierde lo que otro dispositivo
 * escribió mientras corría este pull.
 */
const MARGEN_CURSOR = 5_000;

/**
 * Lo que el motor necesita del almacén. El store lo cumple; las pruebas
 * también.
 *
 * Entre un `leer()` y el `aplicar()` que le corresponde NO puede haber un
 * `await`: si lo hubiera, una escritura del opositor podría colarse en medio
 * y el `aplicar` la borraría al reemplazar la colección con la instantánea
 * vieja. Por eso el push vuelve a leer DESPUÉS de cada subida y la fusión es
 * síncrona de principio a fin.
 */
export interface Almacen {
  leer(): { expediente: Expediente; cola: Cola; marcas: Marcas };
  /**
   * Aplica un resultado del ciclo. NO sella relojes ni encola: lo que entra
   * por aquí viene del servidor o ya está decidido, y volver a encolarlo
   * haría que dos dispositivos se reenviaran la misma fila para siempre.
   */
  aplicar(cambio: CambioSync): void;
}

export interface CambioSync {
  expediente?: Partial<Expediente>;
  cola?: Cola;
  marcas?: Partial<Marcas>;
}

/** Este navegador guarda el expediente de otro opositor. Ver `sincronizar`. */
export class ErrorCuentaDistinta extends Error {
  constructor() {
    super(
      "Este navegador guarda el expediente de otra cuenta. Para sincronizar con esta, " +
        "descarga una copia desde Ajustes y usa «Borrar todo»; después vuelve a entrar.",
    );
    this.name = "ErrorCuentaDistinta";
  }
}

export interface Resumen {
  subidas: number;
  bajadas: number;
  aplicadas: number;
  primera: boolean;
}

export async function sincronizar(
  almacen: Almacen,
  transporte: Transporte,
  ahora: () => number = Date.now,
): Promise<Resumen> {
  const marcas = almacen.leer().marcas;

  // Cuenta distinta de la última con la que se sincronizó este navegador.
  // Aquí no se toca NADA, y es la decisión más importante de este fichero:
  //
  //   · subir lo local sería regalarle a esta cuenta el expediente del
  //     opositor anterior. Además ni siquiera funcionaría: las filas ya
  //     existen con el `usuario_id` del otro y la RLS rechaza el upsert.
  //   · bajar lo de esta cuenta encima dejaría los dos expedientes
  //     mezclados en la misma pantalla, sin forma de separarlos después.
  //   · borrar lo local para hacer sitio es lo único irreversible que
  //     podríamos hacer, y no lo ha pedido nadie.
  //
  // Así que se para y se dice. La salida está en Ajustes: descargar la
  // copia y «Borrar todo», que reinicia las marcas y deja este navegador
  // listo para bajar el expediente de la cuenta nueva.
  if (marcas.usuarioId && marcas.usuarioId !== transporte.usuarioId) {
    throw new ErrorCuentaDistinta();
  }

  const primera = !marcas.primeraHecha || marcas.usuarioId !== transporte.usuarioId;

  if (primera) {
    const r = await primeraSincronizacion(almacen, transporte, ahora);
    // La primera sincronización deja la cola llena con lo que no estaba en
    // la nube; el push normal de aquí abajo es el que la vacía.
    const push = await empujar(almacen, transporte, ahora);
    return {
      subidas: push.subidas,
      bajadas: r.bajadas,
      aplicadas: r.aplicadas + push.aplicadas,
      primera: true,
    };
  }

  // Las dos mitades son independientes (§3): que no haya podido subir lo
  // mío no es motivo para no bajar lo que hizo el otro dispositivo. El
  // fallo del push se guarda y se relanza al final, para que el servicio
  // cuente el intento como fallido y aplique su espera.
  let falloPush: unknown = null;
  let push = { subidas: 0, aplicadas: 0 };
  try {
    push = await empujar(almacen, transporte, ahora);
  } catch (e) {
    falloPush = e;
  }

  const pull = await tirar(almacen, transporte, ahora);
  if (falloPush) throw falloPush;

  // La marca de "última sincronización" solo se pone si las dos mitades han
  // ido bien: es lo que el opositor lee para fiarse.
  almacen.aplicar({ marcas: { ultimaSync: ahora() } });

  return {
    subidas: push.subidas,
    bajadas: pull.bajadas,
    aplicadas: push.aplicadas + pull.aplicadas,
    primera: false,
  };
}

/* ------------------------------------------------------------------ push -- */

async function empujar(
  almacen: Almacen,
  transporte: Transporte,
  ahora: () => number,
): Promise<{ subidas: number; aplicadas: number }> {
  let subidas = 0;
  let aplicadas = 0;

  // El orden es el de las claves ajenas (§3.1): subir un epígrafe cuyo tema
  // no está arriba es una violación de FK, y no hace falta nada más para
  // evitarla.
  for (const { tabla, ids } of porTabla(almacen.leer().cola)) {
    // Se relee en cada tabla: mientras subía la anterior, el opositor ha
    // podido seguir escribiendo.
    const { expediente, cola, marcas } = almacen.leer();
    const ctx = contextoPush(expediente, transporte.usuarioId, marcas);
    const { filas, ausentes } = filasParaPush(expediente, tabla, ids, ctx);

    // Filas que ya no existen: se creó y se descartó algo que nunca llegó a
    // subir. No hay nada que enterrar (0003 §2) y la entrada se va.
    if (ausentes.length) {
      const subidasFalsas: Cola = {};
      for (const id of ausentes) {
        const k = clave(tabla, id);
        if (k in cola) subidasFalsas[k] = cola[k];
      }
      almacen.aplicar({ cola: quitarSubidas(almacen.leer().cola, subidasFalsas) });
    }

    for (let i = 0; i < filas.length; i += LOTE_PUSH) {
      const trozo = filas.slice(i, i + LOTE_PUSH);
      // El reloj local a los dos lados de la petición: con eso y el
      // `creado_at` que devuelve el servidor se estima el desfase entre los
      // dos relojes (lib/sync/reloj.ts). No cuesta ni una petición más.
      const t0 = ahora();
      const devueltas = await transporte.subir(
        tabla,
        trozo.map((f) => f.fila),
      );
      const t1 = ahora();
      subidas += trozo.length;

      const estado = almacen.leer();
      const muestra = muestraDeRespuesta(tabla, devueltas, t0, t1);
      const reloj = muestra == null ? null : medirDesfase(estado.marcas, muestra);
      // Adoptar la fila ganadora que devuelve el RETURNING (§4): si hemos
      // perdido el arbitraje, esto es lo que hay arriba y ya no hace falta
      // esperar al siguiente pull para enterarse.
      const fusion = fusionar(estado.expediente, [{ tabla, filas: devueltas }], estado.marcas);
      aplicadas += fusion.aplicadas;

      // Lo que sube se saca de la cola comparando el valor: si el opositor
      // ha vuelto a tocar esa fila mientras el lote estaba en vuelo, la
      // entrada se queda y se reintenta con el valor nuevo.
      const subidasCola: Cola = {};
      for (const { id } of trozo) {
        const k = clave(tabla, id);
        if (k in estado.cola) subidasCola[k] = estado.cola[k];
      }

      const marcasNuevas: Partial<Marcas> = {
        ...(fusion.perfilActualizado ? { perfilActualizado: fusion.perfilActualizado } : {}),
        ...(reloj ?? {}),
      };

      almacen.aplicar({
        expediente: fusion.expediente,
        marcas: Object.keys(marcasNuevas).length ? marcasNuevas : undefined,
        cola: reencolar(quitarSubidas(estado.cola, subidasCola), fusion.reencolar, ahora()),
      });
    }
  }

  return { subidas, aplicadas };
}

function reencolar(
  cola: Cola,
  entradas: { tabla: Tabla; id: string }[],
  ahora: number,
): Cola {
  if (!entradas.length) return cola;
  const salida = { ...cola };
  for (const e of entradas) {
    // El perfil se encola con su marcador, no con el uuid del usuario.
    salida[clave(e.tabla, e.tabla === "perfiles" ? ID_PERFIL : e.id)] = ahora;
  }
  return salida;
}

/* ------------------------------------------------------------------ pull -- */

async function bajarTodo(
  transporte: Transporte,
  desde: number,
): Promise<{ lotes: LoteBajado[]; filas: number }> {
  const lotes: LoteBajado[] = [];
  let filas = 0;

  for (const tabla of TABLAS) {
    let cursor = desde;
    for (;;) {
      const trozo = await transporte.bajar(tabla, cursor, LOTE_PULL);
      if (!trozo.length) break;
      lotes.push({ tabla, filas: trozo });
      filas += trozo.length;
      if (trozo.length < LOTE_PULL) break;

      // Paginación por cursor y no por offset: con offset, una fila que se
      // actualiza entre página y página se cuela o se salta.
      const max = trozo.reduce((m, f) => Math.max(m, relojFila(f)), 0);
      // Mil filas con el mismo milisegundo: no avanzaríamos nunca. Solo
      // pasa con una importación masiva; se corta y lo demás baja al
      // siguiente ciclo, que es mejor que un bucle infinito.
      if (max <= cursor) break;
      cursor = max;
    }
  }

  return { lotes, filas };
}

async function tirar(
  almacen: Almacen,
  transporte: Transporte,
  ahora: () => number,
): Promise<{ bajadas: number; aplicadas: number }> {
  const marcas = almacen.leer().marcas;
  const { lotes, filas } = await bajarTodo(transporte, marcas.ultimoPull);
  if (!lotes.length) return { bajadas: 0, aplicadas: 0 };

  const estado = almacen.leer();
  const fusion = fusionar(estado.expediente, lotes, estado.marcas);

  almacen.aplicar({
    expediente: fusion.expediente,
    cola: reencolar(estado.cola, fusion.reencolar, ahora()),
    marcas: {
      // El cursor es el máximo `updated_at` RECIBIDO, no el reloj local
      // (§3.2): con el reloj local se pierden las filas que otro
      // dispositivo escribió durante este mismo pull.
      //
      // Con un tope, eso sí: nunca por delante de ahora. Una fila sellada en
      // el futuro por un aparato con la hora mal puesta —o por una versión
      // vieja de la app, que no corrige nada— empujaría el cursor a ese
      // futuro y este dispositivo dejaría de ver TODO lo demás hasta que el
      // reloj lo alcanzara. Lo que cuesta el tope es volver a bajar esa fila
      // en cada ciclo mientras tanto, y bajar dos veces la misma fila no
      // hace nada.
      ultimoPull: Math.max(
        marcas.ultimoPull,
        Math.min(fusion.maxReloj, ahoraSellado(marcas, ahora())) - MARGEN_CURSOR,
      ),
      ...(fusion.perfilActualizado ? { perfilActualizado: fusion.perfilActualizado } : {}),
    },
  });

  return { bajadas: filas, aplicadas: fusion.aplicadas };
}

/* ------------------------------------------------ primera sincronización -- */

/**
 * El caso que más trabajo puede destruir: el opositor lleva meses en local
 * y acaba de crear la cuenta.
 *
 * El orden importa y es este:
 *
 *   1. PULL COMPLETO PRIMERO. Antes de subir nada hay que saber qué hay ya
 *      en la nube. Al revés —empujar y luego mirar— un aparato recién
 *      instalado le mandaría sus valores de fábrica a una cuenta que ya
 *      tiene expediente y el LWW le daría la razón por ser más reciente.
 *   2. Reconciliar lo que se siembra solo: las cinco materias de fábrica
 *      (§9.3) y el perfil. Es lo único que existe en los dos lados sin que
 *      el usuario lo haya creado, y por tanto lo único que puede duplicarse
 *      o pisarse sin que nadie lo haya pedido.
 *   3. Encolar SOLO lo que no ha bajado en el paso 1. Los ids son uuid
 *      generados en el cliente, así que subir lo demás no duplicaría nada
 *      —el upsert lo resolvería por PK— pero serían miles de filas de ida y
 *      vuelta para dejar todo como estaba.
 *
 * Lo que NO se hace: descartar nada del opositor. Si los dos lados tienen
 * temario de verdad, el resultado es la unión. Es lo honesto: nadie ha
 * pedido borrar y dos temarios se pueden fusionar a mano, un temario
 * borrado no se recupera.
 */
async function primeraSincronizacion(
  almacen: Almacen,
  transporte: Transporte,
  ahora: () => number,
): Promise<{ bajadas: number; aplicadas: number }> {
  const { lotes, filas } = await bajarTodo(transporte, 0);

  // Qué ha traído la nube, por clave de cola: lo que esté aquí ya está
  // arriba y no hay que volver a subirlo.
  const remotas = new Set<string>();
  const materiasRemotasVivas = new Set<string>();
  for (const lote of lotes) {
    for (const fila of lote.filas) {
      const id = idDeFila(lote.tabla, fila);
      if (!id) continue;
      remotas.add(clave(lote.tabla, lote.tabla === "perfiles" ? ID_PERFIL : id));
      if (lote.tabla === "materias" && fila.deleted_at == null) materiasRemotasVivas.add(id);
    }
  }

  const previo = almacen.leer();

  // El perfil local, si el opositor lo ha tocado alguna vez, gana al de
  // fábrica que el trigger de alta acaba de crear en el servidor. Sin esto,
  // crear la cuenta le borraría el nombre y sus objetivos: la fila del
  // servidor es de hace un segundo y el LWW le daría la razón.
  const perfilLocalCuenta =
    !perfilDeFabrica(previo.expediente.perfil) && previo.marcas.perfilActualizado === 0;
  const marcasFusion: Marcas = perfilLocalCuenta
    ? { ...previo.marcas, perfilActualizado: ahora() }
    : previo.marcas;

  const fusion = fusionar(previo.expediente, lotes, marcasFusion);

  almacen.aplicar({
    expediente: fusion.expediente,
    marcas: {
      ...(perfilLocalCuenta ? { perfilActualizado: marcasFusion.perfilActualizado } : {}),
      ...(fusion.perfilActualizado ? { perfilActualizado: fusion.perfilActualizado } : {}),
    },
  });

  // Las materias de fábrica que no se han usado y que la nube ya tiene por
  // su cuenta: se quitan del todo, sin tumba. Nunca salieron de este
  // navegador, así que no hay nada de lo que otro dispositivo deba
  // enterarse (y una tumba sería mentira: crearía la fila para matarla).
  const conTemas = new Set(
    almacen
      .leer()
      .expediente.temas.filter((t) => t.borrado == null)
      .map((t) => t.materiaId),
  );
  const estado = almacen.leer();
  const sobran = materiasRemotasVivas.size
    ? estado.expediente.materias.filter(
        (m) =>
          m.borrado == null &&
          !materiasRemotasVivas.has(m.id) &&
          !conTemas.has(m.id) &&
          esMateriaSembrada(m),
      )
    : [];

  let cola = estado.cola;
  let materias = estado.expediente.materias;
  if (sobran.length) {
    const ids = new Set(sobran.map((m) => m.id));
    materias = materias.filter((m) => !ids.has(m.id));
    cola = { ...cola };
    for (const id of ids) delete cola[clave("materias", id)];
  }

  const marca = ahora();
  cola = encolarTodo({ ...estado.expediente, materias }, cola, marca, remotas);
  // Y las filas que SÍ estaban arriba pero cuya versión local es más nueva:
  // `remotas` las ha dejado fuera del encolado, y sin esto la edición que el
  // opositor hizo sin cobertura se quedaría en este aparato para siempre.
  cola = reencolar(cola, fusion.reencolar, marca);
  // El perfil sube salvo que haya ganado el remoto, en cuyo caso lo que hay
  // arriba es exactamente lo que acabamos de adoptar.
  if (!fusion.perfilActualizado) cola[clave("perfiles", ID_PERFIL)] = marca;

  almacen.aplicar({
    expediente: sobran.length ? { materias } : undefined,
    cola,
    marcas: {
      usuarioId: transporte.usuarioId,
      primeraHecha: true,
      // Mismo tope que en `tirar()`: una fila sellada en el futuro por otro
      // aparato no puede dejar a este ciego desde el primer día.
      ultimoPull: Math.max(
        0,
        Math.min(fusion.maxReloj, ahoraSellado(previo.marcas, marca)) - MARGEN_CURSOR,
      ),
      ultimaSync: marca,
    },
  });

  return { bajadas: filas, aplicadas: fusion.aplicadas };
}

/** El id de una fila cualquiera. `progreso_temas` no tiene `id`: es el tema. */
function idDeFila(tabla: Tabla, fila: Fila): string | null {
  if (tabla === "progreso_temas") {
    return (fila as { tema_id?: string }).tema_id ?? null;
  }
  return (fila as { id?: string }).id ?? null;
}

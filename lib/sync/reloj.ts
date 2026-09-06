import type { Marcas } from "./expediente";
import { ms, type Fila, type Tabla } from "./tablas";

/* ============================================================
   Deriva de relojes

   El arbitraje de conflictos es last-write-wins comparando marcas de tiempo
   (§4), y esas marcas las pone el reloj del aparato. Un móvil con la hora
   diez minutos adelantada gana TODOS los conflictos; uno atrasado los
   pierde todos. Y hay algo peor que perder un conflicto: `updated_at` es
   también el cursor del pull, así que una fila insertada con una marca muy
   en el pasado puede quedar por DEBAJO del cursor de otro dispositivo, que
   entonces no la ve nunca. El `greatest()` del trigger protege los updates,
   pero la primera escritura de una fila es un INSERT y ahí no hay trigger
   que la salve.

   La corrección no necesita ni tocar la base ni una RPC nueva: el servidor
   ya nos manda su reloj en cada escritura. El upsert pide `.select()` para
   adoptar la fila ganadora (§4), y lo que vuelve es la fila ENTERA,
   `creado_at` incluido. Y `creado_at` es la única columna de tiempo que
   nunca sale del cliente en estas tablas: la pone el `default now()` de la
   base al insertar y no se vuelve a tocar (0001, y las comprobaciones
   «creado_at no se toca nunca» y «creado_at lo pone el servidor, no el
   cliente adelantado» de db/pruebas/pruebas.sql).

   De ahí sale la medida:

       muestra = max(creado_at devuelto) − (t0 + t1) / 2

   con t0 y t1 el reloj local justo antes y justo después de la petición. El
   punto medio es lo que descuenta la latencia: `creado_at` se sella dentro
   de la transacción, a mitad del viaje, así que compararlo con t1 metería
   como desfase el tiempo de vuelta. Lo que queda de error está acotado por
   media ida y vuelta —décimas de segundo—, muy por debajo de la zona muerta
   de dos segundos con la que se aplica.

   Toda la robustez cuelga de una asimetría: `max(creado_at)` NUNCA puede ir
   por delante del reloj del servidor. Si el lote insertó alguna fila, la
   medida es exacta; si era todo updates, `creado_at` es de cuando nacieron
   esas filas y la medida sale corta. O sea: **toda muestra es una cota
   inferior del desfase, nunca una sobreestimación**.

   De ahí sale el estimador entero, que por eso es de tres líneas y no un
   filtro de Kalman:

     · el desfase es el MÁXIMO de las últimas cuatro medidas. Como las
       medidas cortas nunca superan a las exactas, basta con que una de las
       cuatro venga de un lote con filas nuevas para que el máximo sea la
       buena. Ese máximo es a la vez el suavizado: descarta la mitad mala de
       la muestra sin promediar nada.
     · una medida que supera la estimación es prueba directa de que la
       estimación se quedaba corta, así que se adopta en el acto sin esperar
       a que cierre el bloque.
     · bajar, en cambio, solo pasa al cerrar bloque. Ahí está el margen para
       que el opositor pueda poner el móvil en hora sin que un lote suelto
       de updates arrastre la estimación entre medias.

   Y una medida cuyo `max(creado_at)` no sea más nuevo que el mayor ya visto
   se tira sin más: esa fila ya estaba, no dice nada que no supiéramos, y
   ocuparía un hueco del bloque.

   Solo se miran las tablas cuyo push NO manda `creado_at`. En `epigrafes`,
   `keypoints` y `notas` el cliente sí lo manda, así que el servidor le
   devolvería su propia marca y la medida sería siempre cero: un aparato
   desviado se creería en hora.
   ============================================================ */

/**
 * Tablas cuyo `creado_at` lo pone SIEMPRE el servidor, porque el push no lo
 * incluye en el payload (ver los conversores de `lib/sync/tablas.ts`).
 *
 * Si algún día una de estas empieza a mandar `creado_at`, hay que sacarla de
 * aquí o la medida se irá a cero sin avisar.
 */
const TABLAS_CREADO_SERVIDOR: ReadonlySet<Tabla> = new Set<Tabla>([
  "perfiles",
  "materias",
  "temas",
  "progreso_temas",
  "sesiones",
  "cantes",
  "simulacros",
  "vueltas",
]);

/**
 * Por encima de esta ida y vuelta la muestra se tira. Con la latencia por
 * las nubes, la mitad del viaje deja de ser un margen despreciable y ya no
 * se distingue el desfase del retraso de la red.
 */
const RTT_MAXIMO = 10_000;

/**
 * Zona muerta. Por debajo de esto el desfase ni se aplica: dos segundos de
 * diferencia entre dos dispositivos no cambian ningún arbitraje real (la
 * ventana de escritura concurrente de un solo opositor es mucho mayor) y
 * corregir por ruido solo haría bailar las marcas sin motivo.
 */
const UMBRAL_APLICAR = 2_000;

/**
 * Medidas por bloque. Es la ventana del máximo, y por tanto las dos cosas a
 * la vez: cuántos lotes sin filas nuevas se toleran seguidos, y cuánto tarda
 * en adoptarse una hora nueva del aparato.
 */
const MUESTRAS_POR_BLOQUE = 4;

/** Una medida útil: el desfase que implica y el reloj del servidor que la dio. */
export interface Muestra {
  desfase: number;
  servidor: number;
}

/**
 * El desfase que se aplica de verdad. Fuera de la zona muerta es el
 * estimado; dentro, cero.
 */
export function desfaseAplicable(marcas: Marcas): number {
  const desfase = marcas.desfaseReloj ?? 0;
  if (!Number.isFinite(desfase) || Math.abs(desfase) < UMBRAL_APLICAR) return 0;
  return Math.round(desfase);
}

/**
 * El reloj con el que hay que sellar lo que va a viajar.
 *
 * Se usa en el embudo `escribir()` del store, que es por donde pasan TODAS
 * las escrituras de entidades sincronizables: una acción nueva no tiene que
 * acordarse de nada. Lo que NO se corrige son los instantes que son dato y
 * no reloj de sincronización (`Sesion.inicio`, `Cante.fecha`, el próximo
 * repaso del SRS): esos se comparan contra el reloj local del propio aparato
 * y moverlos descuadraría lo que el opositor ve.
 */
export function ahoraSellado(marcas: Marcas, ahora: number = Date.now()): number {
  return ahora + desfaseAplicable(marcas);
}

/**
 * La medida que sale de una respuesta del push, o `null` si ese lote no
 * sirve para medir.
 */
export function muestraDeRespuesta(
  tabla: Tabla,
  devueltas: Fila[],
  t0: number,
  t1: number,
): Muestra | null {
  if (!TABLAS_CREADO_SERVIDOR.has(tabla) || !devueltas.length) return null;
  const viaje = t1 - t0;
  if (!Number.isFinite(viaje) || viaje < 0 || viaje > RTT_MAXIMO) return null;

  let servidor = 0;
  for (const fila of devueltas) {
    const t = ms((fila as { creado_at?: string | null }).creado_at);
    if (t != null && t > servidor) servidor = t;
  }
  if (!servidor) return null;

  return { servidor, desfase: servidor - (t0 + t1) / 2 };
}

/**
 * Incorpora una medida al desfase estimado. Devuelve solo las marcas que
 * cambian, o `null` si la medida no sirve.
 *
 * Los tres casos feos del enunciado, y qué hace cada uno:
 *
 *   · **la primera medida de todas.** No se adopta a ciegas, y no por
 *     prudencia genérica: si ese primer lote fuera de puros updates, su
 *     `creado_at` podría ser de hace años (el perfil lo crea el alta) y el
 *     aparato se creería años atrasado, sellándolo todo por debajo del
 *     cursor de los demás. Entra en el bloque como una más, y el máximo del
 *     bloque la deja fuera en cuanto llega una medida de verdad. Hasta que
 *     el bloque cierre se sella con el reloj local, como antes de todo esto.
 *
 *   · **un desfase que cambia** (el opositor pone en hora el móvil). Si la
 *     hora se atrasa, las medidas suben y se adopta la primera. Si se
 *     adelanta, las medidas bajan y hay que esperar a que cierre el bloque:
 *     cuatro pushes de margen para no hacer caso a un lote sin filas nuevas.
 *
 *   · **la latencia confundida con desfase.** El punto medio de la ida y
 *     vuelta la descuenta, las respuestas demasiado lentas se tiran, y lo
 *     que quede se lo come la zona muerta de `desfaseAplicable`.
 */
export function medirDesfase(marcas: Marcas, muestra: Muestra): Partial<Marcas> | null {
  if (!Number.isFinite(muestra.desfase) || !Number.isFinite(muestra.servidor)) return null;

  const visto = marcas.desfaseServidor ?? 0;
  // El lote no ha traído ninguna fila nacida después de la última medida: su
  // `creado_at` no dice nada nuevo y gastaría un hueco del bloque.
  if (visto && muestra.servidor <= visto) return null;

  const desfase = marcas.desfaseReloj ?? 0;
  const vistas = marcas.desfaseMuestras ?? 0;
  const mejor = vistas ? Math.max(marcas.desfaseCandidato ?? 0, muestra.desfase) : muestra.desfase;

  const cerrar = (valor: number): Partial<Marcas> => ({
    desfaseReloj: valor,
    desfaseServidor: muestra.servidor,
    desfaseCandidato: 0,
    desfaseMuestras: 0,
  });

  // Una cota inferior por encima de la estimación no puede ser ruido: la
  // estimación era baja y punto. Se sube sin esperar al bloque.
  if (muestra.desfase > desfase) return cerrar(muestra.desfase);
  if (vistas + 1 >= MUESTRAS_POR_BLOQUE) return cerrar(mejor);

  return {
    desfaseServidor: muestra.servidor,
    desfaseCandidato: mejor,
    desfaseMuestras: vistas + 1,
  };
}

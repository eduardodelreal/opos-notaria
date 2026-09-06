/**
 * Zonas horarias: lo único que hay entre "avísame a las 20:00" y un instante.
 *
 * La preferencia de hora vive en `perfiles` (una por opositor) y la zona en
 * `suscripciones_aviso` (una por dispositivo). Ese reparto es deliberado
 * —db/migrations/0003, bloque 3— y obliga a resolver la hora contra la zona
 * del aparato que va a recibir el aviso, no contra la del servidor: el cron
 * corre en UTC en Railway y las 20:00 de Madrid no son las 20:00 de nadie más.
 *
 * Todo se hace con `Intl`, que ya lleva la base de datos de zonas dentro. Sin
 * dependencias: una librería de fechas aquí sería 70 kB para cuatro cuentas.
 */

/** Partes de un instante vistas desde una zona concreta. */
export interface HoraLocal {
  /** Clave YYYY-MM-DD del día local. */
  dia: string;
  /** Día ISO de la semana: 1 = lunes … 7 = domingo. */
  diaSemana: number;
  hora: number;
  minuto: number;
  /** Minutos transcurridos desde la medianoche local. */
  minutosDelDia: number;
}

const ORDEN_ISO: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/**
 * Cómo se ve `ts` desde `zona`.
 *
 * Se usa `en-CA` porque su formato de fecha es exactamente YYYY-MM-DD, que es
 * la clave de día que usa el resto de la app (`claveDia` en lib/utils/time).
 * Si la zona no existe (un `zona_horaria` corrupto en la fila), `Intl` lanza:
 * se cae a UTC en vez de tumbar el envío de todos los demás usuarios.
 */
export function horaLocal(ts: number, zona: string): HoraLocal {
  let partes: Intl.DateTimeFormatPart[];
  try {
    partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: zona,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    }).formatToParts(new Date(ts));
  } catch {
    return horaLocal(ts, "UTC");
  }

  const buscar = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? "";

  // `hour12: false` da 24 en la medianoche de algunos entornos; normalizamos.
  const hora = Number(buscar("hour")) % 24;
  const minuto = Number(buscar("minute"));

  return {
    dia: `${buscar("year")}-${buscar("month")}-${buscar("day")}`,
    diaSemana: ORDEN_ISO[buscar("weekday")] ?? 1,
    hora,
    minuto,
    minutosDelDia: hora * 60 + minuto,
  };
}

/** "20:00" o "20:00:00" (lo que devuelve un `time` de Postgres) → 1200. */
export function minutosDeHora(hora: string): number {
  const [h, m] = hora.split(":");
  const hh = Number(h);
  const mm = Number(m);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 20 * 60;
  return Math.min(23, Math.max(0, hh)) * 60 + Math.min(59, Math.max(0, mm));
}

/**
 * ¿Le toca aviso a este dispositivo ahora mismo?
 *
 * La ventana existe porque el cron no corre en el minuto exacto: si dispara
 * cada 15 minutos, un aviso de las 20:00 se manda en la pasada de las 20:00 a
 * 20:14. Compararlo con igualdad estricta haría que la mayoría de los avisos
 * no se mandaran nunca.
 *
 * No se envuelve la medianoche a propósito: una ventana que cruzara las 00:00
 * cambiaría de día local a mitad de comprobación y el filtro de días de la
 * semana dejaría de significar lo que dice.
 */
export function tocaAhora(
  local: HoraLocal,
  horaPreferida: string,
  dias: number[],
  ventanaMin: number,
): boolean {
  if (!dias.includes(local.diaSemana)) return false;
  const objetivo = minutosDeHora(horaPreferida);
  return (
    local.minutosDelDia >= objetivo &&
    local.minutosDelDia < objetivo + Math.max(1, ventanaMin)
  );
}

/**
 * Ejecuta `fn` como si el proceso viviera en `zona`.
 *
 * Hace falta porque `lib/data/srs.ts` calcula con `Date.now()` y con días
 * locales del proceso (`claveDia`, `inicioSemana`, `calcularRacha`). En el
 * cron, que corre en UTC, la racha de un opositor de México se partiría por la
 * mitad seis horas antes de tiempo. Cambiar `process.env.TZ` es la forma que
 * tiene Node de mover ese "local" (lo soporta desde la v16), y así se reutiliza
 * el SRS real en vez de reimplementarlo con zonas, que es justo lo que haría
 * que la app y el aviso dijeran cosas distintas.
 *
 * Es una variable global, así que:
 *   · se restaura siempre, incluso si `fn` lanza;
 *   · el cron procesa usuarios EN SERIE, nunca en paralelo, o dos usuarios de
 *     zonas distintas se pisarían el reloj;
 *   · `fn` tiene que ser síncrona. Si fuera `async`, el `await` devolvería el
 *     control al bucle de eventos con la zona cambiada y cualquier otra cosa
 *     que mirase la hora vería la zona equivocada.
 */
export function conZona<T>(zona: string, fn: () => T): T {
  const previa = process.env.TZ;
  try {
    process.env.TZ = zona;
    return fn();
  } finally {
    if (previa === undefined) delete process.env.TZ;
    else process.env.TZ = previa;
  }
}

/** La zona del navegador que está mirando. "Europe/Madrid" si no la dice. */
export function zonaDelNavegador(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Madrid";
  } catch {
    return "Europe/Madrid";
  }
}

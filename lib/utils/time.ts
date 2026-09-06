export const MINUTO = 60;
export const HORA = 3600;
export const DIA_MS = 86_400_000;

/** 3725 -> "1h 02m". Para tarjetas y resúmenes. */
export function horasMin(segundos: number): string {
  if (!segundos || segundos < 0) return "0m";
  const h = Math.floor(segundos / HORA);
  const m = Math.floor((segundos % HORA) / MINUTO);
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** 3725 -> "01:02:05". Para cronómetros. */
export function reloj(segundos: number, forzarHoras = false): string {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / HORA);
  const m = Math.floor((s % HORA) / MINUTO);
  const seg = s % MINUTO;
  const mm = String(m).padStart(2, "0");
  const ss = String(seg).padStart(2, "0");
  if (h > 0 || forzarHoras) return `${String(h).padStart(2, "0")}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

export function horas(segundos: number, decimales = 1): number {
  return Number((segundos / HORA).toFixed(decimales));
}

export function diasDesde(ts?: number): number | null {
  if (!ts) return null;
  return Math.floor((Date.now() - ts) / DIA_MS);
}

export function haceTexto(ts?: number): string {
  const d = diasDesde(ts);
  if (d === null) return "nunca";
  if (d === 0) return "hoy";
  if (d === 1) return "ayer";
  if (d < 7) return `hace ${d} días`;
  if (d < 30) return `hace ${Math.floor(d / 7)} sem`;
  if (d < 365) return `hace ${Math.floor(d / 30)} meses`;
  return `hace ${Math.floor(d / 365)} años`;
}

const FMT_FECHA = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const FMT_FECHA_HORA = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export const fecha = (ts: number) => FMT_FECHA.format(new Date(ts));
export const fechaHora = (ts: number) => FMT_FECHA_HORA.format(new Date(ts));

/** Clave YYYY-MM-DD en horario local, para agrupar por día. */
export function claveDia(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function inicioDeHoy(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Lunes de la semana en curso a las 00:00. */
export function inicioSemana(ts = Date.now()): number {
  const d = new Date(ts);
  const dia = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dia);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

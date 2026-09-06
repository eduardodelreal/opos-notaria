/** "1 cante" / "3 cantes". Evita el clásico "1 cantes" de toda app sin cuidar. */
export function plural(n: number, singular: string, pluralForma?: string): string {
  const p = pluralForma ?? `${singular}s`;
  return `${n} ${n === 1 ? singular : p}`;
}

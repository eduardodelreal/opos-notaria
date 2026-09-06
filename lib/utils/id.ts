/**
 * Identificadores del dominio: uuid v4 generados en el cliente.
 *
 * Los genera el cliente y no el servidor porque toda escritura se completa
 * en IndexedDB antes de que la red entre en juego: sin id local no se puede
 * crear una entidad sin cobertura, y sin eso no hay local-first. Que sean
 * uuid, y no ids cortos legibles, es lo que exige el esquema de Postgres
 * (todas las PK son `uuid`) y lo que evita que dos opositores distintos
 * acaben con la misma materia `civil`.
 */
export function uid(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();

  // randomUUID solo existe en contexto seguro (https o localhost). La app se
  // abre a veces desde otro dispositivo de la LAN por http, y ahí seguimos
  // necesitando un uuid válido: lo componemos a mano con la versión y la
  // variante correctas.
  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const RE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Comprobación barata que usa la migración para saber si ya está hecha. */
export function esUuid(valor: unknown): boolean {
  return typeof valor === "string" && RE_UUID.test(valor);
}

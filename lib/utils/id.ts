/** Ids cortos, ordenables por tiempo y sin dependencias. */
export function uid(prefijo = ""): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefijo}${prefijo ? "_" : ""}${t}${r}`;
}

/** Slug estable para ids legibles (materias creadas por el usuario). */
export function slug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

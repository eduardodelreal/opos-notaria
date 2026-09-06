/**
 * Aritmética de color, sin dependencias y sin DOM.
 *
 * Existe por una razón muy concreta: el opositor puede elegir el color de
 * acento y no es diseñador. Un acento mal elegido —un azul marino sobre el
 * fondo oscuro, un amarillo sobre el papel— no "queda feo": deja texto que
 * no se lee, y esta app se mira ocho horas al día durante años.
 *
 * Así que nada de confiar en el ojo: se mide el contraste WCAG de verdad
 * (relación entre luminancias relativas) y, si no llega, se corrige el
 * color automáticamente subiendo o bajando su luminosidad hasta que llega.
 * El opositor elige el TONO; la legibilidad no se negocia.
 *
 * Se trabaja en HSL de sRGB y no en OKLCH porque lo que hay que medir es el
 * contraste WCAG, que se define sobre sRGB: cualquier espacio perceptual
 * daría un paso más bonito pero habría que medir igual en sRGB al final, y
 * aquí el criterio de parada es la medida, no el paso.
 *
 * Todo son funciones puras: las prueba pruebas/modelo.mjs sin navegador.
 */

export type RGB = [number, number, number];
export type HSL = [number, number, number];

/** `#rgb`, `#rrggbb` o nada. Lo que el usuario escribe en el campo libre. */
export function esHex(valor: string | undefined | null): valor is string {
  return typeof valor === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(valor);
}

/** Normaliza a `#rrggbb` en minúsculas. Devuelve null si no es un color. */
export function normalizarHex(valor: string | undefined | null): string | null {
  if (!esHex(valor)) return null;
  let h = valor.slice(1).toLowerCase();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return `#${h}`;
}

export function hexARgb(hex: string): RGB {
  const n = normalizarHex(hex) ?? "#000000";
  return [
    parseInt(n.slice(1, 3), 16),
    parseInt(n.slice(3, 5), 16),
    parseInt(n.slice(5, 7), 16),
  ];
}

export function rgbAHex([r, g, b]: RGB): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function rgbAHsl([r, g, b]: RGB): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

export function hslARgb([h, s, l]: HSL): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: RGB;
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

/** Luminancia relativa WCAG (0 negro, 1 blanco). */
export function luminancia(hex: string): number {
  const [r, g, b] = hexARgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Relación de contraste WCAG entre dos colores opacos. De 1 a 21. */
export function contraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const [alto, bajo] = la >= lb ? [la, lb] : [lb, la];
  return (alto + 0.05) / (bajo + 0.05);
}

/** Mueve la luminosidad HSL sin tocar tono ni saturación. `delta` en 0..1. */
export function moverLuz(hex: string, delta: number): string {
  const [h, s, l] = rgbAHsl(hexARgb(hex));
  return rgbAHex(hslARgb([h, s, Math.max(0, Math.min(1, l + delta))]));
}

/** Un fondo contra el que hay que destacar, con el mínimo que se le exige. */
export interface Exigencia {
  fondo: string;
  minimo: number;
}

/**
 * Empuja la luminosidad del color hasta que cumple TODAS las exigencias.
 *
 * `direccion` es +1 (aclarar) o -1 (oscurecer): la elige quien llama según
 * el tono, porque sobre fondo oscuro se destaca aclarando y sobre papel
 * oscureciendo. Si el color ya cumple, se devuelve tal cual — es lo que
 * hace que un acento bien elegido salga EXACTAMENTE como lo eligió el
 * opositor y no "corregido" sin motivo.
 *
 * El paso es pequeño (1%) y el tope es el blanco o el negro: en ese
 * extremo se devuelve lo mejor que se ha conseguido. No puede pasar con
 * los fondos de la app —todos dejan hueco de sobra— pero devolver algo
 * legible es mejor que un bucle.
 */
export function empujarHasta(
  hex: string,
  exigencias: Exigencia[],
  direccion: 1 | -1,
): string {
  const cumple = (c: string) => exigencias.every((e) => contraste(c, e.fondo) >= e.minimo);
  if (cumple(hex)) return hex;

  const [h, s, l0] = rgbAHsl(hexARgb(hex));
  let mejor = hex;
  let mejorMargen = -Infinity;
  for (let paso = 1; paso <= 100; paso++) {
    const l = l0 + direccion * paso * 0.01;
    if (l < 0 || l > 1) break;
    const c = rgbAHex(hslARgb([h, s, l]));
    if (cumple(c)) return c;
    // Guardamos el que menos lejos se queda, por si nos comemos el tope.
    const margen = Math.min(...exigencias.map((e) => contraste(c, e.fondo) - e.minimo));
    if (margen > mejorMargen) {
      mejorMargen = margen;
      mejor = c;
    }
  }
  return mejor;
}

/** Blanco de la app y su contrario. El `oro` ya usa este casi-negro. */
export const BLANCO = "#ffffff";
export const NEGRO_TINTA = "#15130c";

/**
 * Color de texto legible SOBRE un fondo sólido (la etiqueta de un botón
 * primario). Devuelve también si hizo falta forzar.
 *
 * Cualquier color tiene 4.5:1 contra el blanco o contra el negro salvo una
 * franja estrechísima de luminancia intermedia; para esa franja se recurre
 * al negro puro, que siempre la cubre.
 */
export function textoSobre(fondo: string, minimo = 4.5): string {
  const blanco = contraste(BLANCO, fondo);
  const tinta = contraste(NEGRO_TINTA, fondo);
  if (blanco >= minimo || tinta >= minimo) return blanco >= tinta ? BLANCO : NEGRO_TINTA;
  return contraste("#000000", fondo) >= contraste(BLANCO, fondo) ? "#000000" : BLANCO;
}

/** `rgba()` a partir de un hex, para los lavados translúcidos del fondo. */
export function conAlfa(hex: string, alfa: number): string {
  const [r, g, b] = hexARgb(hex).map(Math.round);
  return `rgba(${r}, ${g}, ${b}, ${alfa})`;
}

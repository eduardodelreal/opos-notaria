/** Nombre del parámetro que arrastra "a dónde volver" por el flujo de acceso. */
export const PARAM_DESTINO = "siguiente";

/**
 * Sanea el destino al que se redirige después de entrar.
 *
 * Solo se admiten rutas internas. Sin esto, un `?siguiente=https://otro.sitio`
 * convertiría la página de acceso en un redirector abierto y regalado para
 * hacer phishing con nuestro dominio delante.
 */
export function rutaSegura(
  valor: string | null | undefined,
  porDefecto = "/",
): string {
  if (!valor) return porDefecto;
  // "//evil.com" y "/\evil.com" los interpretan los navegadores como absolutas.
  if (!valor.startsWith("/") || valor.startsWith("//") || valor.startsWith("/\\"))
    return porDefecto;
  return valor;
}

/**
 * Cargador para poder ejecutar las pruebas contra el código real.
 *
 * Los módulos del proyecto son TypeScript con imports sin extensión
 * (`../data/types`), que es lo que espera el bundler de Next pero no el
 * resolvedor de Node. En vez de duplicar la lógica del store en la prueba
 * —que es justo lo que haría que la prueba pasara mientras la app falla—,
 * se enseña a Node a resolver esos imports y se le deja quitar los tipos
 * (`--experimental-strip-types`, ya estable en Node 22).
 *
 *   node --experimental-strip-types --import ./pruebas/cargador.mjs pruebas/modelo.mjs
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(pathToFileURL(new URL("./resolutor.mjs", import.meta.url).pathname));

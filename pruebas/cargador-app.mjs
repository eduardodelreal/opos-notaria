/**
 * Cargador para las pruebas que ejecutan rutas de la app (`app/api/**`).
 * Como `pruebas/cargador.mjs`, pero con el alias `@/` y el doble de
 * `server-only`. Ver `pruebas/resolutor-app.mjs`.
 *
 *   node --experimental-strip-types --import ./pruebas/cargador-app.mjs pruebas/ia-proveedor.mjs
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(pathToFileURL(new URL("./resolutor-app.mjs", import.meta.url).pathname));

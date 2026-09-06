/**
 * Resolutor para ejecutar CÓDIGO DE LA APP (rutas de `app/api/**`) fuera de
 * Next, sin bundler.
 *
 * Añade dos cosas al resolutor normal:
 *
 *  · El alias `@/…`, que en la app resuelve Next con `tsconfig.json` y que
 *    aquí hay que resolver a mano contra la raíz del proyecto.
 *  · Un doble vacío para `server-only`. Ese módulo no existe en
 *    `node_modules`: lo inyecta el bundler de Next, y su gracia es hacer
 *    fallar el BUILD si alguien importa un fichero de servidor desde el
 *    cliente. Fuera de Next no hay nada que vigilar, así que se sustituye
 *    por un módulo vacío. La disciplina real la sigue comprobando
 *    `next build`, que es donde importa.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve as resolveBase } from "./resolutor.mjs";

const RAIZ = new URL("../", import.meta.url);
const EXTENSIONES = [".ts", ".tsx", "/index.ts", "/index.tsx", ".mjs", ".js"];
const VACIO = new URL("./vacio.mjs", import.meta.url).href;

export async function resolve(especificador, contexto, siguiente) {
  if (especificador === "server-only") {
    return { url: VACIO, shortCircuit: true };
  }

  if (especificador.startsWith("@/")) {
    const relativo = especificador.slice(2);
    const base = new URL(relativo, RAIZ);
    if (existsSync(fileURLToPath(base))) {
      return { url: base.href, shortCircuit: true };
    }
    for (const ext of EXTENSIONES) {
      const intento = new URL(relativo + ext, RAIZ);
      if (existsSync(fileURLToPath(intento))) {
        return { url: intento.href, shortCircuit: true };
      }
    }
    throw new Error(`No se pudo resolver el alias ${especificador}`);
  }

  return resolveBase(especificador, contexto, siguiente);
}

// Para que `node --import` funcione también apuntando aquí directamente.
export const RAIZ_PROYECTO = pathToFileURL(fileURLToPath(RAIZ)).href;

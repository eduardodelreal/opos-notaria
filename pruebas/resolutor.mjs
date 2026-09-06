import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EXTENSIONES = [".ts", ".tsx", "/index.ts", "/index.tsx", ".mjs", ".js"];

/** Resuelve `../data/types` a `../data/types.ts`, que es lo que hay en disco. */
export async function resolve(especificador, contexto, siguiente) {
  if (especificador.startsWith(".") && contexto.parentURL) {
    const base = new URL(especificador, contexto.parentURL);
    if (!existsSync(fileURLToPath(base))) {
      for (const ext of EXTENSIONES) {
        const intento = new URL(especificador + ext, contexto.parentURL);
        if (existsSync(fileURLToPath(intento))) {
          // Sin `format`: que Node decida por la extensión y quite los tipos.
          return { url: intento.href, shortCircuit: true };
        }
      }
    }
  }
  return siguiente(especificador, contexto);
}

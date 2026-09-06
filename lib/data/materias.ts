import type { Materia } from "./types";
import { uid } from "../utils/id";

/** Las cinco materias clásicas de Notarías, sin id: el id lo pone la siembra. */
const PLANTILLA: Omit<Materia, "id" | "orden" | "actualizado">[] = [
  {
    nombre: "Derecho Civil",
    abrev: "CIV",
    color: "#c94152",
    ejercicio: 1,
    descripcion:
      "El bloque grande. Persona, reales, obligaciones, contratos, familia y sucesiones.",
  },
  {
    nombre: "Derecho Mercantil",
    abrev: "MER",
    color: "#c9a227",
    ejercicio: 2,
    descripcion:
      "Empresario, sociedades, contratos mercantiles, títulos valores y concursal.",
  },
  {
    nombre: "Derecho Hipotecario",
    abrev: "HIP",
    color: "#3f93c4",
    ejercicio: 2,
    descripcion:
      "Registro de la Propiedad, principios hipotecarios y hipoteca.",
  },
  {
    nombre: "Derecho Fiscal",
    abrev: "FIS",
    color: "#46a35c",
    ejercicio: 3,
    descripcion: "ITP y AJD, ISD, IVA, IRPF y las obligaciones fiscales del notario.",
  },
  {
    nombre: "Derecho Notarial",
    abrev: "NOT",
    color: "#9b7bd4",
    ejercicio: 3,
    descripcion:
      "Organización del notariado, documento público, actas y jurisdicción voluntaria.",
  },
];

/**
 * Siembra las materias iniciales con ids nuevos.
 *
 * Es una función y no una constante a propósito: si los ids fuesen fijos,
 * todos los opositores compartirían la materia `civil` y las filas chocarían
 * en cuanto dos cuentas subieran su temario. Cada instalación genera los
 * suyos.
 */
export function materiasIniciales(): Materia[] {
  const ahora = Date.now();
  return PLANTILLA.map((m, i) => ({ ...m, id: uid(), orden: i, actualizado: ahora }));
}

/**
 * ¿Es una materia tal y como salió de la siembra, sin que nadie la tocara?
 *
 * Lo pregunta la primera sincronización (docs/sincronizacion.md §9.3): si el
 * opositor instala la app en dos aparatos antes de crear la cuenta, acaba
 * con diez materias, cinco de cada. Las que siguen siendo idénticas a la
 * plantilla y no tienen ni un tema colgando no son trabajo de nadie y se
 * pueden descartar; las que ha editado o usado, no se tocan.
 */
export function esMateriaSembrada(m: Materia): boolean {
  return PLANTILLA.some(
    (p) =>
      p.nombre === m.nombre &&
      p.abrev === m.abrev &&
      p.color === m.color &&
      p.ejercicio === m.ejercicio &&
      p.descripcion === m.descripcion,
  );
}

/** Orden estable de las materias. La posición en el array ya no manda. */
export function materiasOrdenadas(materias: Materia[]): Materia[] {
  return [...materias].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
}

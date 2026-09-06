import type { Materia } from "./types";

export const MATERIAS: Materia[] = [
  {
    id: "civil",
    nombre: "Derecho Civil",
    abrev: "CIV",
    color: "#c94152",
    ejercicio: 1,
    descripcion:
      "El bloque grande. Persona, reales, obligaciones, contratos, familia y sucesiones.",
  },
  {
    id: "mercantil",
    nombre: "Derecho Mercantil",
    abrev: "MER",
    color: "#c9a227",
    ejercicio: 2,
    descripcion:
      "Empresario, sociedades, contratos mercantiles, títulos valores y concursal.",
  },
  {
    id: "hipotecario",
    nombre: "Derecho Hipotecario",
    abrev: "HIP",
    color: "#3f93c4",
    ejercicio: 2,
    descripcion:
      "Registro de la Propiedad, principios hipotecarios y hipoteca.",
  },
  {
    id: "fiscal",
    nombre: "Derecho Fiscal",
    abrev: "FIS",
    color: "#46a35c",
    ejercicio: 3,
    descripcion: "ITP y AJD, ISD, IVA, IRPF y las obligaciones fiscales del notario.",
  },
  {
    id: "notarial",
    nombre: "Derecho Notarial",
    abrev: "NOT",
    color: "#9b7bd4",
    ejercicio: 3,
    descripcion:
      "Organización del notariado, documento público, actas y jurisdicción voluntaria.",
  },
];

export const MATERIA_POR_ID = Object.fromEntries(
  MATERIAS.map((m) => [m.id, m]),
) as Record<string, Materia>;

import type { Epigrafe } from "./types";
import { uid } from "../utils/id";

/* ============================================================
   Importador de programa
   El opositor pega el programa oficial tal cual (del BOE, del PDF
   del preparador o de su Excel) y sacamos numero + titulo. No
   inventamos temas: si la linea no tiene numero, se numera por
   posicion a partir del ultimo tema existente.
   ============================================================ */

export interface TemaImportado {
  numero: number;
  titulo: string;
  /** Marcado cuando el numero venia explicito en el texto pegado. */
  numeroExplicito: boolean;
}

/**
 * "Tema 12.- El usufructo" / "12. El usufructo" / "12 El usufructo" /
 * "Tema 3.— La nacionalidad". Los separadores se repiten porque los PDF
 * del BOE combinan punto y raya ("3.—") y hay que comerse los dos.
 */
const RE_NUMERADO =
  /^\s*(?:tema\s*)?(\d{1,3})\s*(?:[.\-–—)º]\s*)*(.+?)\s*$/i;

export function parsearListaTemas(
  texto: string,
  numeroInicial = 1,
): TemaImportado[] {
  const lineas = texto
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 1);

  const salida: TemaImportado[] = [];
  let siguiente = numeroInicial;

  for (const linea of lineas) {
    // Descartamos encabezados sueltos del PDF ("PROGRAMA", "CIVIL", numeros de pagina)
    if (/^\d{1,3}$/.test(linea)) continue;
    if (linea.length < 4 && !/\d/.test(linea)) continue;

    const m = linea.match(RE_NUMERADO);
    if (m && m[2] && m[2].length >= 3) {
      const numero = Number(m[1]);
      salida.push({ numero, titulo: limpiarTitulo(m[2]), numeroExplicito: true });
      siguiente = numero + 1;
    } else {
      salida.push({
        numero: siguiente,
        titulo: limpiarTitulo(linea),
        numeroExplicito: false,
      });
      siguiente += 1;
    }
  }

  return salida;
}

function limpiarTitulo(t: string): string {
  return t
    .replace(/\s*\.{2,}\s*\d*$/, "") // "Titulo ......... 34" de indices con puntos guia
    .replace(/\s*[–—-]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/* ============================================================
   Autoparser de epigrafes
   Detecta la numeracion que usa el opositor en SU tema y parte el
   texto por ella. Probamos varios estilos y nos quedamos con el
   que mas encaja: es mas fiable que imponer un formato.
   ============================================================ */

interface Estilo {
  id: string;
  re: RegExp;
  /** Descarta falsos positivos como "1.500 euros" o "art. 34". */
  valida?: (marca: string, resto: string) => boolean;
}

const ESTILOS: Estilo[] = [
  {
    id: "romano",
    re: /^\s*([IVXLCDM]{1,7})\s*[.)–—-]\s*(.+)$/,
    valida: (m) => /^[IVXLCDM]+$/.test(m),
  },
  {
    id: "arabigo",
    re: /^\s*(\d{1,2}(?:\.\d{1,2})*)\s*[.)–—-]\s*(.+)$/,
    valida: (_m, resto) => !/^\d/.test(resto.trim()),
  },
  {
    id: "letra",
    re: /^\s*([a-zA-Z])\s*[.)]\s*(.+)$/,
  },
  {
    id: "guion",
    re: /^\s*[•·–—*§-]\s+(.+)$/,
  },
];

export interface EpigrafeParseado {
  titulo: string;
  texto: string;
}

/**
 * Parte el texto de un tema en epigrafes.
 * Devuelve [] si no encuentra una estructura fiable: en ese caso la UI
 * ofrece meter los epigrafes a mano en vez de inventarse un troceado.
 */
export function parsearEpigrafes(texto: string): EpigrafeParseado[] {
  const lineas = texto.split(/\r?\n/);
  let mejor: { estilo: Estilo; indices: number[] } | null = null;

  for (const estilo of ESTILOS) {
    const indices: number[] = [];
    for (let i = 0; i < lineas.length; i++) {
      const linea = lineas[i];
      if (!linea.trim()) continue;
      const m = linea.match(estilo.re);
      if (!m) continue;
      const marca = estilo.id === "guion" ? "-" : m[1];
      const resto = estilo.id === "guion" ? m[1] : m[2];
      if (estilo.valida && !estilo.valida(marca, resto)) continue;
      if (resto.trim().length < 3) continue;
      indices.push(i);
    }
    if (indices.length >= 2 && (!mejor || indices.length > mejor.indices.length)) {
      mejor = { estilo, indices };
    }
  }

  if (!mejor) return [];

  const { estilo, indices } = mejor;
  const salida: EpigrafeParseado[] = [];

  for (let k = 0; k < indices.length; k++) {
    const desde = indices[k];
    const hasta = k + 1 < indices.length ? indices[k + 1] : lineas.length;
    const m = lineas[desde].match(estilo.re)!;
    const cabecera = (estilo.id === "guion" ? m[1] : m[2]).trim();

    // El titulo del epigrafe es la primera frase de la cabecera; el resto
    // es ya cuerpo del epigrafe.
    const corte = cabecera.search(/[.;:]\s/);
    const titulo =
      corte > 8 && corte < 140 ? cabecera.slice(0, corte).trim() : cabecera;
    const restoCabecera =
      corte > 8 && corte < 140 ? cabecera.slice(corte + 1).trim() : "";

    const cuerpo = [restoCabecera, ...lineas.slice(desde + 1, hasta)]
      .join("\n")
      .trim();

    salida.push({ titulo: recortar(titulo, 180), texto: cuerpo });
  }

  return salida;
}

function recortar(t: string, max: number): string {
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export function aEpigrafes(parseados: EpigrafeParseado[]): Epigrafe[] {
  return parseados.map((p, i) => ({
    id: uid("epi"),
    orden: i + 1,
    titulo: p.titulo,
    texto: p.texto || undefined,
  }));
}

/** Numero de palabras: sirve para estimar el tiempo de cante. */
export function palabras(texto?: string): number {
  if (!texto) return 0;
  return texto.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Minutos estimados de cante. 130 palabras/min es el ritmo tipico de
 * un cante de oposicion: rapido, pero articulado.
 */
export function minutosEstimados(texto?: string): number {
  return Math.round((palabras(texto) / 130) * 10) / 10;
}

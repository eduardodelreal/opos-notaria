import type { Articulo, Epigrafe, Tema } from "./types";
import { vivos } from "./vivos";

/* ============================================================
   Artículos: troceado de lo pegado, citas y índice cruzado

   Tres cosas distintas que conviene no confundir, porque la tentación de
   fundirlas en una sola función es lo que acaba inventándose datos:

     1. `parsearArticulos` trocea un BLOQUE PEGADO del Código o de los
        apuntes del preparador. Ahí está el texto íntegro, así que de ahí
        salen número, rúbrica (cuando se puede) y contenido.
     2. `extraerCitas` busca en el texto YA ESCRITO de los epígrafes las
        menciones de pasada ("art. 1255 CC", "arts. 1088 y ss."). De una
        mención solo salen número y cuerpo legal: la rúbrica y el contenido
        NO están ahí, y rellenarlos sería escribirle al opositor un artículo
        que él no ha leído.
     3. `indiceCruzado` cruza los artículos dados de alta con el temario:
        "el 1255 CC te sale también en los temas 67 y 95". Eso —las
        conexiones entre temas— es lo que más pregunta el tribunal.

   Todo aquí es función pura y NINGUNA se llama desde un selector de
   Zustand: devuelven arrays nuevos, y un array nuevo por render es el
   bucle infinito de siempre (React #185). Quien las use las envuelve en
   `useMemo`, igual que `temasOrdenados`.
   ============================================================ */

/* ---------------------------------------------------- cuerpos legales -- */

/**
 * Los cuerpos legales que se citan en el programa de Notarías, con las
 * formas en las que el opositor los escribe de verdad.
 *
 * Existe por una razón muy concreta: `CC`, `C.C.` y `Código Civil` son el
 * mismo cuerpo, y si no se normalizan, el índice cruzado parte el 1255 en
 * tres artículos distintos y no cruza nada. La lista no pretende ser
 * exhaustiva —`normalizarCuerpo` sabe qué hacer con lo que no está— sino
 * cubrir lo que se repite cien veces al día.
 */
export const CUERPOS: { abrev: string; nombre: string; alias: string[] }[] = [
  { abrev: "CC", nombre: "Código Civil", alias: ["cc", "c civil", "cod civil", "codigo civil"] },
  { abrev: "LH", nombre: "Ley Hipotecaria", alias: ["lh", "ley hipotecaria"] },
  { abrev: "RH", nombre: "Reglamento Hipotecario", alias: ["rh", "reglamento hipotecario"] },
  {
    abrev: "CCom",
    nombre: "Código de Comercio",
    alias: ["ccom", "c com", "c de c", "cod com", "codigo de comercio", "codigo comercio"],
  },
  {
    abrev: "LSC",
    nombre: "Ley de Sociedades de Capital",
    alias: ["lsc", "trlsc", "ley de sociedades de capital", "ley de sociedades"],
  },
  { abrev: "LN", nombre: "Ley del Notariado", alias: ["ln", "ley del notariado"] },
  { abrev: "RN", nombre: "Reglamento Notarial", alias: ["rn", "reglamento notarial"] },
  {
    abrev: "LEC",
    nombre: "Ley de Enjuiciamiento Civil",
    alias: ["lec", "ley de enjuiciamiento civil"],
  },
  { abrev: "CE", nombre: "Constitución Española", alias: ["ce", "constitucion", "constitucion espanola"] },
  { abrev: "LC", nombre: "Ley Concursal", alias: ["lc", "trlc", "ley concursal"] },
  {
    abrev: "LAU",
    nombre: "Ley de Arrendamientos Urbanos",
    alias: ["lau", "ley de arrendamientos urbanos"],
  },
  { abrev: "LPH", nombre: "Ley de Propiedad Horizontal", alias: ["lph", "ley de propiedad horizontal"] },
  {
    abrev: "LJV",
    nombre: "Ley de Jurisdicción Voluntaria",
    alias: ["ljv", "ley de jurisdiccion voluntaria"],
  },
  { abrev: "LGT", nombre: "Ley General Tributaria", alias: ["lgt", "ley general tributaria"] },
  { abrev: "CP", nombre: "Código Penal", alias: ["cp", "codigo penal", "cod penal"] },
];

/** Sin tildes, sin puntos, sin dobles espacios y en minúsculas. */
function plano(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const POR_ALIAS = new Map<string, string>();
for (const c of CUERPOS) {
  POR_ALIAS.set(plano(c.abrev), c.abrev);
  POR_ALIAS.set(plano(c.nombre), c.abrev);
  for (const a of c.alias) POR_ALIAS.set(plano(a), c.abrev);
}

/**
 * Deja un cuerpo legal en su forma canónica: `C.C.`, `cc` y `Código Civil`
 * devuelven los tres `CC`.
 *
 * Lo que no reconoce NO se descarta: una abreviatura que parece una
 * abreviatura (mayúsculas, con o sin puntos) se conserva en mayúsculas y
 * sin puntos, porque el opositor cita leyes que no están en la lista y su
 * `LMV` tiene que seguir cruzando con su `L.M.V.`. Lo que ni siquiera lo
 * parece devuelve cadena vacía: mejor sin cuerpo que con uno inventado.
 */
export function normalizarCuerpo(bruto: string | undefined): string {
  if (!bruto) return "";
  const limpio = bruto.trim();
  if (!limpio) return "";
  const conocido = POR_ALIAS.get(plano(limpio));
  if (conocido) return conocido;
  const siglas = limpio.replace(/[.\s]/g, "");
  if (/^[A-ZÑ]{2,8}$/.test(siglas)) return siglas;
  return "";
}

/**
 * Deja un número de artículo en su forma canónica.
 *
 * El punto de los millares se quita (`1.255` → `1255`) y el del apartado se
 * respeta (`9.1` sigue siendo `9.1`): se distinguen por el tamaño del grupo
 * de la derecha, que en los millares son siempre tres dígitos. Sin esto, el
 * mismo artículo escrito de las dos maneras son dos artículos distintos y
 * el índice cruzado no cruza nada.
 */
export function normalizarNumero(bruto: string | undefined): string {
  if (!bruto) return "";
  let n = bruto
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[º°ª]/g, "")
    .replace(/[.,;:)\]]+$/, "");
  // Millares: 1.255 → 1255, 1.255.000 → 1255000. Se repite porque un número
  // puede llevar más de un separador.
  let previo = "";
  while (previo !== n) {
    previo = n;
    n = n.replace(/^(\d{1,3})\.(\d{3})\b/, "$1$2");
  }
  return n.replace(/\s*(bis|ter|qu[aá]ter|quinquies|sexies|septies|octies)/, " $1").trim();
}

/**
 * Clave con la que dos artículos son "el mismo artículo".
 *
 * Un artículo sin cuerpo no se cruza con los que sí lo tienen: el 34 a
 * secas puede ser el de la Ley Hipotecaria o el de cualquier otra cosa, y
 * cruzarlo con el 34 LH sería decidir por el opositor.
 */
export function claveArticulo(cuerpo: string | undefined, numero: string | undefined): string {
  return `${normalizarCuerpo(cuerpo)}|${normalizarNumero(numero)}`;
}

/* -------------------------------------------- troceado del bloque pegado -- */

export interface ArticuloParseado {
  cuerpo: string;
  numero: string;
  /** Vacío cuando no se puede distinguir con fiabilidad de la rúbrica. */
  titulo: string;
  contenido: string;
}

const ORDINALES = "bis|ter|qu[aá]ter|quinquies|sexies|septies|octies";

/**
 * "Artículo 1255.", "Art. 34 LH -", "ARTÍCULO 1.255 bis:".
 *
 * El cuerpo legal en la cabecera es opcional y solo se acepta si son
 * mayúsculas: en "Artículo 34 El tercero…" la palabra que sigue al número
 * es el texto de la ley, no una abreviatura.
 */
const RE_CABECERA = new RegExp(
  String.raw`^\s*(?:art[íi]culos?|arts?)\b\.?\s*` +
    String.raw`(\d{1,4}(?:\.\d{1,3})*)\s*` +
    String.raw`(?:(${ORDINALES})\b\.?\s*)?` +
    String.raw`(?:\b([A-ZÑ][A-ZÑ.]{1,7})\b\.?\s*)?` +
    String.raw`(?:[.\-–—:)]\s*)*(.*)$`,
  "i",
);

/**
 * La misma cabecera sin la palabra "artículo": "104 LH — Hipoteca de
 * máximo". Es como vienen muchos apuntes de preparador, que dan el artículo
 * por sobreentendido.
 *
 * Aquí el cuerpo legal NO es opcional, y es lo que hace que la forma sea
 * fiable: sin él, "3. Concepto y caracteres" —una línea de índice de
 * epígrafes— se leería como el artículo 3, y el opositor acabaría con medio
 * temario dado de alta como articulado.
 */
const RE_CABECERA_SUELTA = new RegExp(
  String.raw`^\s*(\d{1,4}(?:\.\d{1,3})*)\s*` +
    String.raw`(?:(${ORDINALES})\b\.?\s*)?` +
    String.raw`([A-Za-zÑñ.]{2,6})\b\.?\s*` +
    String.raw`(?:[.\-–—:)]\s*)*(.*)$`,
  "",
);

interface Cabecera {
  digitos: string;
  ordinal?: string;
  siglas?: string;
  resto: string;
}

/**
 * Lee la cabecera de un artículo, si la línea lo es. Devuelve `null` —y no
 * un artículo a medias— para todo lo demás: una cabecera dudosa es texto
 * del artículo anterior, no un artículo nuevo.
 */
function leerCabecera(linea: string): Cabecera | null {
  const m = linea.match(RE_CABECERA);
  if (m) {
    return { digitos: m[1], ordinal: m[2], siglas: m[3], resto: m[4] ?? "" };
  }
  const s = linea.match(RE_CABECERA_SUELTA);
  // El cuerpo tiene que ser uno reconocible o una abreviatura como tal: sin
  // esa comprobación esta forma se traga cualquier lista numerada.
  if (s && cuerpoEstricto(s[3])) {
    return { digitos: s[1], ordinal: s[2], siglas: s[3], resto: s[4] ?? "" };
  }
  return null;
}

/** Cuerpo legal solo si es uno conocido o unas siglas indiscutibles. */
function cuerpoEstricto(token: string | undefined): string {
  if (!token) return "";
  const conocido = POR_ALIAS.get(plano(token));
  if (conocido) return conocido;
  const siglas = token.replace(/\./g, "");
  return /^[A-ZÑ]{2,5}$/.test(siglas) ? siglas : "";
}

/** Longitud por encima de la cual una línea ya no puede ser una rúbrica. */
const RUBRICA_MAX = 80;

/**
 * ¿Puede este texto ser la rúbrica del artículo, sin jugársela?
 *
 * El criterio es deliberadamente estrecho. "Artículo 1255. Los contratantes
 * pueden establecer los pactos…" y "Artículo 1255. Libertad de pacto" tienen
 * exactamente la misma forma, así que lo único que los separa es que una
 * rúbrica es corta, empieza en mayúscula y NO termina en puntuación de
 * frase. Todo lo que no cumpla las tres cosas se queda sin rúbrica y la
 * pone el opositor: una rúbrica inventada es peor que un hueco, porque el
 * hueco se ve y la invención se estudia.
 */
function pareceRubrica(texto: string): boolean {
  const t = texto.trim();
  if (t.length < 3 || t.length > RUBRICA_MAX) return false;
  if (/[.;:,]$/.test(t)) return false;
  if (!/^[«"'¿¡A-ZÁÉÍÓÚÑ]/.test(t)) return false;
  return true;
}

/**
 * Trocea un bloque de artículos pegado tal cual.
 *
 * Devuelve `[]` si no encuentra ni una cabecera de artículo, igual que
 * `parsearEpigrafes` con los epígrafes: sin estructura fiable se dice que
 * no se ha encontrado nada y la interfaz ofrece meterlos a mano, en vez de
 * partir el texto por donde caiga.
 *
 * `cuerpoPorDefecto` es el cuerpo legal que el opositor haya indicado al
 * pegar ("esto es todo del Código Civil"); solo se usa para los artículos
 * cuya cabecera no lo lleve.
 */
export function parsearArticulos(
  texto: string,
  cuerpoPorDefecto = "",
): ArticuloParseado[] {
  const lineas = texto.split(/\r?\n/);
  const cabeceras: { linea: number; cabecera: Cabecera }[] = [];
  for (let i = 0; i < lineas.length; i++) {
    const cabecera = leerCabecera(lineas[i]);
    if (cabecera) cabeceras.push({ linea: i, cabecera });
  }
  if (!cabeceras.length) return [];

  const porDefecto = normalizarCuerpo(cuerpoPorDefecto);
  const salida: ArticuloParseado[] = [];

  for (let k = 0; k < cabeceras.length; k++) {
    const desde = cabeceras[k].linea;
    const hasta = k + 1 < cabeceras.length ? cabeceras[k + 1].linea : lineas.length;
    const { digitos, ordinal, siglas, resto } = cabeceras[k].cabecera;

    const numero = normalizarNumero(ordinal ? `${digitos} ${ordinal}` : digitos);
    if (!numero) continue;

    const cuerpo = normalizarCuerpo(siglas) || porDefecto;
    const cola = lineas.slice(desde + 1, hasta);

    let titulo = "";
    let cabezaSobrante = (resto ?? "").trim();

    if (cabezaSobrante) {
      // La rúbrica va en la misma línea que el número. Solo se acepta si
      // además hay cuerpo del artículo debajo: si no lo hay, ese texto
      // corto ES el artículo, no su rúbrica.
      if (pareceRubrica(cabezaSobrante) && cola.some((l) => l.trim())) {
        titulo = cabezaSobrante;
        cabezaSobrante = "";
      }
    } else {
      // La cabecera termina en el número y la rúbrica va en su propia
      // línea. Mismo criterio, y tiene que quedar texto por debajo.
      const j = cola.findIndex((l) => l.trim());
      if (j >= 0 && pareceRubrica(cola[j]) && cola.slice(j + 1).some((l) => l.trim())) {
        titulo = cola[j].trim();
        cola.splice(0, j + 1);
      }
    }

    const contenido = [cabezaSobrante, ...cola].join("\n").trim();
    salida.push({ cuerpo, numero, titulo, contenido });
  }

  return salida;
}

/* --------------------------------------------------- citas de pasada -- */

export interface CitaArticulo {
  cuerpo: string;
  numero: string;
  /** La cita era "arts. 1088 y ss.": el número es el primero de una serie. */
  siguientes: boolean;
  /** Cuántas veces aparece en el texto analizado. */
  veces: number;
  /** Id del epígrafe donde se vio por primera vez, si venía de uno. */
  epigrafeId?: string;
}

const RE_CITA = new RegExp(String.raw`\b(?:art[íi]culos?|arts?)\b\.?\s*`, "gi");
const RE_NUMERO_CITA = new RegExp(
  String.raw`^(\d{1,4}(?:\.\d{1,3})*)\s*(${ORDINALES})?\b`,
  "i",
);
const RE_SEPARADOR = /^\s*(?:,|;|\by\b|\be\b|\bo\b|\bó\b)\s*/i;
const RE_SIGUIENTES = /^\s*(?:y\s+)?(?:ss\b\.?|siguientes\b)/i;

// Los alias, de más largo a más corto: "Código de Comercio" tiene que ganar
// a "Código", y "CCom" a "CC".
const ALIAS_ORDENADOS = [...POR_ALIAS.keys()].sort((a, b) => b.length - a.length);

/**
 * Lee el cuerpo legal que sigue a los números de una cita, si lo hay.
 * Devuelve también cuánto texto ha consumido, que es lo que permite seguir
 * escaneando sin releer lo mismo.
 */
function leerCuerpo(resto: string): { cuerpo: string; largo: number } {
  const m = resto.match(/^(\s*(?:de\s+(?:la|los|las|el)\s+|del\s+|de\s+)?)(.{0,44})/i);
  if (!m) return { cuerpo: "", largo: 0 };
  const antesala = m[1].length;
  const ventana = m[2];
  const llano = plano(ventana);
  for (const alias of ALIAS_ORDENADOS) {
    // El alias tiene que empezar donde empieza la ventana y terminar en
    // frontera de palabra: "cc" no puede salir de "ccaa".
    if (!llano.startsWith(alias)) continue;
    const siguiente = llano.charAt(alias.length);
    if (siguiente && /[a-z0-9]/.test(siguiente)) continue;
    // `plano` colapsa espacios y convierte puntos en espacios, así que la
    // longitud del alias no sirve para avanzar: se mide sobre el original.
    const crudo = ventana.match(new RegExp(`^.{${alias.length}}[.\\s]*`));
    return { cuerpo: POR_ALIAS.get(alias)!, largo: antesala + (crudo?.[0].length ?? alias.length) };
  }
  // Una abreviatura que no está en la lista pero lo parece: se respeta.
  const siglas = ventana.match(/^([A-ZÑ][A-ZÑ]{1,7}|(?:[A-ZÑ]\.){2,5})(?![a-zñáéíóú])/);
  if (!siglas) return { cuerpo: "", largo: 0 };
  return { cuerpo: normalizarCuerpo(siglas[1]), largo: antesala + siglas[0].length };
}

/**
 * "104 LH" a secas, sin la palabra "artículo" delante. Es la elipsis de
 * siempre: "el art. 1857 CC y el 104 LH".
 *
 * Solo cuenta si detrás va un cuerpo legal reconocible, que es lo que la
 * distingue de "1.500 euros" o "30 días". Sin esa condición, medio texto
 * del tema se convertiría en citas.
 */
const RE_CITA_ELIPTICA = new RegExp(
  String.raw`(\d{1,4}(?:\.\d{1,3})*)\s*(${ORDINALES})?\s+([A-Za-zÑñ.]{2,6})\b`,
  "gi",
);

/**
 * Busca en un texto corrido las menciones de artículos.
 *
 * De aquí SOLO salen número y cuerpo, que es lo único que una mención
 * contiene. La rúbrica y el texto del artículo no están en "art. 1255 CC" y
 * no se inventan: el alta que esto propone nace con esos dos campos vacíos
 * y los rellena el opositor pegando el artículo.
 *
 * Las citas se devuelven agrupadas por artículo y en el orden en que
 * aparecen, que es el orden en el que tiene sentido revisarlas.
 */
export function extraerCitas(texto: string, epigrafeId?: string): CitaArticulo[] {
  if (!texto) return [];
  const salida: CitaArticulo[] = [];
  const indice = new Map<string, CitaArticulo>();
  /** Tramos del texto que ya ha consumido la primera pasada. */
  const leidos: [number, number][] = [];

  const anotar = (cuerpo: string, numero: string, siguientes: boolean) => {
    if (!numero) return;
    const clave = claveArticulo(cuerpo, numero);
    const ya = indice.get(clave);
    if (ya) {
      ya.veces += 1;
      ya.siguientes = ya.siguientes || siguientes;
      return;
    }
    const cita: CitaArticulo = {
      cuerpo: normalizarCuerpo(cuerpo),
      numero: normalizarNumero(numero),
      siguientes,
      veces: 1,
      epigrafeId,
    };
    indice.set(clave, cita);
    salida.push(cita);
  };

  RE_CITA.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_CITA.exec(texto))) {
    let pos = m.index + m[0].length;
    // "arts. 1088, 1089 y ss. CC" es UNA cita con varios números y un solo
    // cuerpo al final: se leen todos los números antes de buscarlo.
    const numeros: string[] = [];
    let siguientes = false;

    for (;;) {
      const n = texto.slice(pos).match(RE_NUMERO_CITA);
      if (!n) break;
      numeros.push(n[2] ? `${n[1]} ${n[2]}` : n[1]);
      pos += n[0].length;

      const ss = texto.slice(pos).match(RE_SIGUIENTES);
      if (ss) {
        siguientes = true;
        pos += ss[0].length;
        break;
      }
      const sep = texto.slice(pos).match(RE_SEPARADOR);
      if (!sep) break;
      // Solo se sigue si tras el separador viene otro número: en "art. 1255
      // y la doctrina" la "y" no encadena nada.
      if (!RE_NUMERO_CITA.test(texto.slice(pos + sep[0].length))) break;
      pos += sep[0].length;
    }

    if (!numeros.length) continue;
    const { cuerpo, largo } = leerCuerpo(texto.slice(pos));
    for (let i = 0; i < numeros.length; i++) {
      // El "y ss." solo cuelga del último número de la serie.
      anotar(cuerpo, numeros[i], siguientes && i === numeros.length - 1);
    }
    leidos.push([m.index, pos + largo]);
    // Se retoma el escaneo detrás de lo consumido, para no releer los
    // números como si fueran una cita nueva.
    RE_CITA.lastIndex = Math.max(RE_CITA.lastIndex, pos + largo);
  }

  // Segunda pasada para las elípticas, saltando lo que ya se ha leído: si no,
  // el "1857 CC" de "art. 1857 CC" se contaría dos veces.
  RE_CITA_ELIPTICA.lastIndex = 0;
  let e: RegExpExecArray | null;
  while ((e = RE_CITA_ELIPTICA.exec(texto))) {
    const desde = e.index;
    if (leidos.some(([a, b]) => desde >= a && desde < b)) continue;
    const cuerpo = cuerpoEstricto(e[3]);
    if (!cuerpo) continue;
    anotar(cuerpo, e[2] ? `${e[1]} ${e[2]}` : e[1], false);
  }

  return salida;
}

/** Las citas de todos los epígrafes de un tema, con el epígrafe de origen. */
export function citasDeTema(tema: Tema): CitaArticulo[] {
  const salida: CitaArticulo[] = [];
  const indice = new Map<string, CitaArticulo>();
  for (const e of vivos(tema.epigrafes)) {
    for (const cita of extraerCitas(e.texto ?? "", e.id)) {
      const clave = claveArticulo(cita.cuerpo, cita.numero);
      const ya = indice.get(clave);
      if (ya) {
        ya.veces += cita.veces;
        ya.siguientes = ya.siguientes || cita.siguientes;
        continue;
      }
      indice.set(clave, cita);
      salida.push(cita);
    }
  }
  return salida;
}

/**
 * Qué artículos citados en el texto del tema NO están todavía dados de
 * alta en él. Es la lista que se le ofrece al opositor: "esto lo nombras y
 * no lo tienes guardado".
 */
export function articulosPropuestos(tema: Tema, articulos: Articulo[]): CitaArticulo[] {
  const ya = new Set(
    vivos(articulos)
      .filter((a) => a.temaId === tema.id)
      .map((a) => claveArticulo(a.cuerpo, a.numero)),
  );
  return citasDeTema(tema).filter((c) => !ya.has(claveArticulo(c.cuerpo, c.numero)));
}

/* ------------------------------------------------------ índice cruzado -- */

/** De dónde sale que este artículo aparece en este tema. */
export type FuenteAparicion = "articulo" | "cita";

export interface Aparicion {
  temaId: string;
  /** Número del tema en su materia. Es como el opositor los nombra. */
  numeroTema: number;
  tituloTema: string;
  /** `articulo` si está dado de alta ahí; `cita` si solo se menciona. */
  fuente: FuenteAparicion;
}

/**
 * Índice `cuerpo|numero → temas en los que aparece`.
 *
 * Cruza las dos fuentes porque las dos cuentan: un artículo dado de alta en
 * el tema 67 y citado de pasada en el 95 sale en los dos, marcado de
 * distinta manera. El alta gana a la cita cuando concurren en el mismo
 * tema; dentro de cada artículo, los temas van por número.
 *
 * Es una función pura y cara: se llama una vez por temario, nunca dentro de
 * un selector de Zustand (React #185).
 */
export function indiceCruzado(
  articulos: Articulo[],
  temas: Tema[],
): Map<string, Aparicion[]> {
  const vivosTemas = temas.filter((t) => t.borrado == null);
  const fichaTema = new Map(vivosTemas.map((t) => [t.id, t]));
  const indice = new Map<string, Map<string, Aparicion>>();

  const anotar = (clave: string, temaId: string, fuente: FuenteAparicion) => {
    const tema = fichaTema.get(temaId);
    if (!tema) return;
    let porTema = indice.get(clave);
    if (!porTema) {
      porTema = new Map();
      indice.set(clave, porTema);
    }
    const ya = porTema.get(temaId);
    // Un alta pisa a una cita, nunca al revés: si el artículo está guardado
    // en ese tema, decir "solo lo mencionas" sería falso.
    if (ya && !(ya.fuente === "cita" && fuente === "articulo")) return;
    porTema.set(temaId, {
      temaId,
      numeroTema: tema.numero,
      tituloTema: tema.titulo,
      fuente,
    });
  };

  for (const a of vivos(articulos)) {
    anotar(claveArticulo(a.cuerpo, a.numero), a.temaId, "articulo");
  }
  for (const t of vivosTemas) {
    for (const cita of citasDeTema(t)) {
      anotar(claveArticulo(cita.cuerpo, cita.numero), t.id, "cita");
    }
  }

  const salida = new Map<string, Aparicion[]>();
  for (const [clave, porTema] of indice) {
    salida.set(
      clave,
      [...porTema.values()].sort((a, b) => a.numeroTema - b.numeroTema),
    );
  }
  return salida;
}

/**
 * En qué OTROS temas aparece este artículo. El suyo propio se excluye: la
 * pregunta es "¿dónde más me sale esto?".
 *
 * `ref` es un artículo o cualquier cosa con cuerpo y número, para poder
 * preguntar también por una cita que todavía no se ha dado de alta.
 */
export function temasDeArticulo(
  ref: { cuerpo?: string; numero?: string; temaId?: string },
  articulos: Articulo[],
  temas: Tema[],
): Aparicion[] {
  const clave = claveArticulo(ref.cuerpo, ref.numero);
  if (!normalizarNumero(ref.numero)) return [];
  const todas = indiceCruzado(articulos, temas).get(clave) ?? [];
  return ref.temaId ? todas.filter((a) => a.temaId !== ref.temaId) : todas;
}

/**
 * Cómo se nombra un artículo en una línea: "artículo 1255 CC". Sin cuerpo
 * se queda en "artículo 1255", que es exactamente lo que se sabe de él.
 *
 * Lo usan las etiquetas accesibles de los botones ("Borrar artículo 1255
 * CC"), así que se escribe entero y no abreviado: un lector de pantalla
 * leyendo "art." dice "art".
 */
export function etiquetaArticulo(a: { cuerpo?: string; numero?: string }): string {
  const numero = normalizarNumero(a.numero) || (a.numero ?? "").trim();
  if (!numero) return "artículo";
  const cuerpo = normalizarCuerpo(a.cuerpo) || (a.cuerpo ?? "").trim();
  return cuerpo ? `artículo ${numero} ${cuerpo}` : `artículo ${numero}`;
}

/* ------------------------------------------------ lecturas de un tema -- */

/**
 * Los artículos vivos de un tema, ya ordenados. `epigrafeId` filtra dentro
 * del tema; con `null` devuelve los que todavía no cuelgan de ninguno.
 *
 * Igual que todo lo de este fichero: no es un selector. Devuelve un array
 * nuevo, así que va dentro de un `useMemo` (React #185).
 */
export function articulosDeTema(
  articulos: Articulo[],
  temaId: string,
  epigrafeId?: string | null,
): Articulo[] {
  const suyos = vivos(articulos).filter((a) => {
    if (a.temaId !== temaId) return false;
    if (epigrafeId === undefined) return true;
    return epigrafeId === null ? !a.epigrafeId : a.epigrafeId === epigrafeId;
  });
  return articulosOrdenados(suyos);
}

export interface GrupoArticulos {
  /** El epígrafe del grupo; ausente en el de los artículos sin asignar. */
  epigrafe?: Epigrafe;
  articulos: Articulo[];
}

/**
 * Reparte los artículos de un tema entre sus epígrafes, en el orden del
 * temario, y deja al final los que no cuelgan de ninguno.
 *
 * Van al final y no al principio porque el tema se lee de arriba abajo
 * siguiendo sus epígrafes: lo que está sin archivar es una tarea
 * pendiente, no el arranque del tema. Cuando no hay más grupos —lo normal
 * justo después de pegar un bloque sin elegir epígrafe— es el único, y
 * entonces no necesita ni cabecera.
 *
 * Un artículo que apunta a un epígrafe que ya no está (borrado, o de otro
 * tema) cae también aquí: es preferible enseñarlo suelto a perderlo de
 * vista.
 */
export function agruparPorEpigrafe(
  articulos: Articulo[],
  epigrafes: Epigrafe[],
): GrupoArticulos[] {
  const grupos = new Map<string, Articulo[]>();
  const sueltos: Articulo[] = [];
  const conocidos = new Set(epigrafes.map((e) => e.id));

  for (const a of vivos(articulos)) {
    if (a.epigrafeId && conocidos.has(a.epigrafeId)) {
      const lista = grupos.get(a.epigrafeId);
      if (lista) lista.push(a);
      else grupos.set(a.epigrafeId, [a]);
    } else {
      sueltos.push(a);
    }
  }

  const salida: GrupoArticulos[] = epigrafes.map((e) => ({
    epigrafe: e,
    articulos: articulosOrdenados(grupos.get(e.id) ?? []),
  }));
  salida.push({ articulos: articulosOrdenados(sueltos) });
  return salida;
}

/**
 * Orden con el que se listan los artículos de un epígrafe: manda `orden`,
 * que es el que decide el opositor, y el número solo desempata.
 *
 * Como `temasOrdenados`, NO es un selector: devuelve un array nuevo.
 */
export function articulosOrdenados(articulos: Articulo[]): Articulo[] {
  return [...articulos].sort((a, b) => {
    if (a.orden !== b.orden) return a.orden - b.orden;
    return compararNumeros(a.numero, b.numero);
  });
}

/** "9.1" antes que "9.10", y "1255" antes que "1255 bis". */
export function compararNumeros(a: string, b: string): number {
  const pa = normalizarNumero(a).split(/[.\s]/);
  const pb = normalizarNumero(b).split(/[.\s]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    const numerico = Number.isFinite(na) && Number.isFinite(nb);
    if (numerico) {
      if (na !== nb) return na - nb;
      continue;
    }
    const sa = pa[i] ?? "";
    const sb = pb[i] ?? "";
    if (sa !== sb) return sa < sb ? -1 : 1;
  }
  return 0;
}

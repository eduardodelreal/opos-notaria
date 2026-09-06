import type {
  Acento,
  Densidad,
  FuenteTemas,
  OrdenTemas,
  Perfil,
  Tono,
  VistaPrograma,
} from "./types";
import {
  conAlfa,
  contraste,
  empujarHasta,
  moverLuz,
  normalizarHex,
  textoSobre,
} from "./color";

/* ============================================================
   Apariencia: del perfil a variables CSS

   El sistema de diseño ya es de tokens (app/globals.css): Tailwind los
   consume con `@theme inline` y los dos temas se cambian reescribiendo
   variables. Personalizar es, por tanto, escribir unas pocas variables
   más en `<html>`; no hay un segundo sistema de estilos ni clases
   `dark:` duplicadas.

   Este módulo es la ÚNICA fuente de esas variables y no toca el DOM: lo
   aplica components/Proveedor.tsx y lo replica, tal cual, el guion
   antiparpadeo de app/layout.tsx leyéndolo de localStorage. Que el
   cálculo esté en un solo sitio es lo que permite que el guion del `head`
   sea tonto —copiar pares clave/valor— y no tenga que saber de color.

   Dos invariantes que no se pueden romper:

     1. Con el perfil por defecto, `variablesApariencia()` devuelve
        EXACTAMENTE los valores que ya están escritos en globals.css. La
        app de siempre es la app por defecto, hasta el último dígito.
        Lo comprueba pruebas/modelo.mjs leyendo el propio CSS.
     2. Ninguna combinación elegible deja texto ilegible. Los acentos con
        nombre están medidos; el color libre se corrige solo.
   ============================================================ */

/* ------------------------------------------------------------------ tonos -- */

/**
 * Lo que este módulo necesita saber de cada tono base. Es un ESPEJO de
 * app/globals.css, no la fuente: el CSS sigue mandando en la pantalla.
 * pruebas/modelo.mjs lee el CSS y compara, así que si alguien cambia un
 * fondo y se olvida de aquí, la prueba se pone roja en vez de dejarnos
 * calculando contrastes contra un fondo que ya no existe.
 */
export interface DefinicionTono {
  id: Tono;
  nombre: string;
  descripcion: string;
  /** Clase que se le pone a `<html>`. El oscuro es el `:root` pelado. */
  clase: string;
  bg: string;
  surface: string;
  /** Alfa del lavado `--lacre-soft` en este tono. */
  alfaSuave: number;
  /** Valores del lacre de la casa en este tono, tal cual están en el CSS. */
  lacre: string;
  lacreBright: string;
}

export const TONOS: DefinicionTono[] = [
  {
    id: "dark",
    nombre: "Oscuro",
    descripcion: "Tinta profunda. El de siempre",
    clase: "",
    bg: "#08090c",
    surface: "#12151b",
    alfaSuave: 0.14,
    lacre: "#a82f3c",
    lacreBright: "#c94152",
  },
  {
    id: "light",
    nombre: "Claro",
    descripcion: "Papel blanco de despacho",
    clase: "light",
    bg: "#f6f4ef",
    surface: "#ffffff",
    alfaSuave: 0.1,
    lacre: "#9c2733",
    lacreBright: "#b8323f",
  },
  {
    id: "sepia",
    nombre: "Sepia",
    descripcion: "Papel cálido, para leer temas durante horas",
    clase: "sepia",
    bg: "#f2ebdc",
    surface: "#fdf9f0",
    alfaSuave: 0.1,
    lacre: "#98242f",
    lacreBright: "#b02f3c",
  },
];

export function tono(id: Tono): DefinicionTono {
  return TONOS.find((t) => t.id === id) ?? TONOS[0];
}

/* ---------------------------------------------------------------- acentos -- */

export interface DefinicionAcento {
  id: Acento;
  nombre: string;
  descripcion: string;
  /**
   * Color del que se parte. `null` en `personal` (lo pone el opositor) y
   * en `lacre`, que no se genera: son los valores literales del CSS.
   */
  semilla: string | null;
}

/**
 * La paleta con nombre.
 *
 * Son cinco y no quince a propósito: cada uno es una decisión de dirección
 * de arte que sigue cuadrando con el latón y con el registro jurídico de la
 * app (docs/decisiones.md). Un selector de color a pelo como única opción
 * habría sido más "libre" y peor: la mayoría de los colores que se eligen a
 * ojo sobre un fondo casi negro no se leen.
 */
export const ACENTOS: DefinicionAcento[] = [
  {
    id: "lacre",
    nombre: "Lacre",
    descripcion: "El rojo notarial de la casa",
    semilla: null,
  },
  { id: "tinta", nombre: "Tinta", descripcion: "Azul de escritura", semilla: "#2f6fb0" },
  { id: "jade", nombre: "Jade", descripcion: "Verde sobrio", semilla: "#2f8f63" },
  {
    id: "cardeno",
    nombre: "Cárdeno",
    descripcion: "Morado de toga",
    semilla: "#7b57c4",
  },
  { id: "cobre", nombre: "Cobre", descripcion: "Naranja quemado", semilla: "#c2662a" },
  {
    id: "personal",
    nombre: "El tuyo",
    descripcion: "Color libre, corregido si no se lee",
    semilla: null,
  },
];

export function acento(id: Acento): DefinicionAcento {
  return ACENTOS.find((a) => a.id === id) ?? ACENTOS[0];
}

/** Color de partida por defecto del acento libre: el lacre, para no asustar. */
export const ACENTO_PERSONAL_INICIAL = "#a82f3c";

/* --------------------------------------------------- mínimos de contraste -- */

/**
 * Los suelos que se le exigen a un acento generado.
 *
 * No son los 4.5:1 de AA para todo, y conviene decir por qué en vez de
 * fingirlo: `--lacre` se usa sobre todo como SUPERFICIE (relleno del botón
 * primario, bordes, puntos de gráfica), y para eso el umbral de la WCAG 2.1
 * es 3:1 (1.4.11, contraste de elementos no textuales). `--lacre-bright` sí
 * se usa como TEXTO en varios sitios, así que a ese se le exige 4.5:1
 * contra el fondo y 4:1 contra la superficie de las tarjetas.
 *
 * El lacre de la casa se queda como está (2.97:1 contra el fondo oscuro):
 * es la marca, no la elige el usuario, y tocarlo cambiaría la app de hoy.
 * Es decir, lo que el opositor puede elegir es siempre igual o MÁS legible
 * que lo que ya había.
 */
export const MINIMO_SOLIDO = 3;
export const MINIMO_TEXTO_FONDO = 4.5;
export const MINIMO_TEXTO_SUPERFICIE = 4;
export const MINIMO_ETIQUETA = 4.5;

export interface PaletaAcento {
  lacre: string;
  lacreBright: string;
  lacreSoft: string;
  /** Color de la etiqueta encima del sólido (el texto del botón primario). */
  lacreFg: string;
}

/**
 * Genera la familia del acento para un tono, corrigiendo la luminosidad
 * hasta que cumple los mínimos.
 *
 * Sobre fondo oscuro se destaca ACLARANDO y sobre papel OSCURECIENDO, así
 * que la dirección del empuje la marca el tono. Si el color que ha elegido
 * el opositor ya cumple, sale exactamente el suyo: la corrección no es un
 * "filtro de marca", es una red de seguridad.
 */
export function paletaAcento(semilla: string, id: Tono): PaletaAcento {
  const t = tono(id);
  const oscuro = id === "dark";
  const direccion: 1 | -1 = oscuro ? 1 : -1;

  const solido = empujarHasta(
    normalizarHex(semilla) ?? ACENTO_PERSONAL_INICIAL,
    [
      { fondo: t.bg, minimo: MINIMO_SOLIDO },
      { fondo: t.surface, minimo: MINIMO_SOLIDO },
    ],
    direccion,
  );

  // El estado de hover y el uso como texto. Se separa del sólido en la
  // misma dirección en la que el CSS ya lo hacía (más luz en los dos
  // tonos) y después se le exige el mínimo de texto, que sobre papel puede
  // obligar a devolverlo hacia el sólido.
  const brillo = empujarHasta(
    moverLuz(solido, oscuro ? 0.1 : 0.08),
    [
      { fondo: t.bg, minimo: MINIMO_TEXTO_FONDO },
      { fondo: t.surface, minimo: MINIMO_TEXTO_SUPERFICIE },
    ],
    direccion,
  );

  return {
    lacre: solido,
    lacreBright: brillo,
    lacreSoft: conAlfa(solido, t.alfaSuave),
    lacreFg: textoSobre(solido, MINIMO_ETIQUETA),
  };
}

/** La familia del acento efectiva de un perfil, generada o literal. */
export function paletaDe(perfil: Perfil): PaletaAcento {
  const t = tono(perfil.tema);
  const def = acento(perfil.acento);

  if (def.id === "lacre") {
    // Los valores del CSS, sin pasar por el generador: es la única forma de
    // que el perfil por defecto pinte exactamente la app de siempre.
    return {
      lacre: t.lacre,
      lacreBright: t.lacreBright,
      lacreSoft: conAlfa(t.lacre, t.alfaSuave),
      lacreFg: "#ffffff",
    };
  }

  const semilla =
    def.id === "personal"
      ? (normalizarHex(perfil.acentoPersonal) ?? ACENTO_PERSONAL_INICIAL)
      : (def.semilla ?? ACENTO_PERSONAL_INICIAL);

  return paletaAcento(semilla, perfil.tema);
}

/* --------------------------------------------------- tipografía y cuerpo -- */

/** Cuerpo del texto de los temas, en píxeles. 17px = 1.0625rem, el de siempre. */
export const TAMANO_TEMA_MINIMO = 15;
export const TAMANO_TEMA_MAXIMO = 24;
export const TAMANO_TEMA_INICIAL = 17;

/** Escala de la retícula en modo compacto (Tailwind: `--spacing`). */
export const ESPACIADO_NORMAL = "0.25rem";
export const ESPACIADO_COMPACTO = "0.215rem";

/* ------------------------------------------------------------- resultado -- */

/** Todas las variables que este módulo puede escribir, para poder limpiarlas. */
export const CLAVES_APARIENCIA = [
  "--lacre",
  "--lacre-bright",
  "--lacre-soft",
  "--lacre-fg",
  "--tema-fuente",
  "--tema-cuerpo",
] as const;

export interface Apariencia {
  /** Clases de `<html>`: el tono y, si toca, la densidad. */
  clases: string[];
  vars: Record<string, string>;
  /** Color de la barra del navegador, para `<meta name="theme-color">`. */
  themeColor: string;
}

/**
 * Todo lo que hay que aplicarle a `<html>` para que la app se vea como el
 * opositor la ha pedido. Puro: no toca el DOM ni lee localStorage.
 */
export function apariencia(perfil: Perfil): Apariencia {
  const t = tono(perfil.tema);
  const p = paletaDe(perfil);

  const clases: string[] = [];
  if (t.clase) clases.push(t.clase);
  if (perfil.densidad === "compacta") clases.push("compacta");

  return {
    clases,
    vars: {
      "--lacre": p.lacre,
      "--lacre-bright": p.lacreBright,
      "--lacre-soft": p.lacreSoft,
      "--lacre-fg": p.lacreFg,
      // La interfaz nunca cambia de tipografía: solo el texto de los temas,
      // que es lo que se lee durante horas. La sans de la interfaz vale
      // perfectamente como alternativa y evita cargar una tercera familia.
      "--tema-fuente":
        perfil.fuenteTemas === "sans" ? "var(--font-ui)" : "var(--font-serif)",
      // En rem y no en px: si el opositor ha subido el tamaño base de su
      // navegador (que es lo que hace media oposición a partir de los 40),
      // el texto del tema tiene que subir con él.
      "--tema-cuerpo": `${redondear(perfil.tamanoTema / 16)}rem`,
    },
    themeColor: t.bg,
  };
}

/** Sin decimales largos: `1.0625rem` es exactamente los 17px de siempre. */
function redondear(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/* ------------------------------------------------------- saneado de datos -- */

const TONOS_VALIDOS = new Set<string>(TONOS.map((t) => t.id));
const ACENTOS_VALIDOS = new Set<string>(ACENTOS.map((a) => a.id));
const FUENTES: FuenteTemas[] = ["serif", "sans"];
const DENSIDADES: Densidad[] = ["normal", "compacta"];
const VISTAS: VistaPrograma[] = ["mural", "lista"];

export const ORDENES: { id: OrdenTemas; label: string; pista: string }[] = [
  {
    id: "numero",
    label: "Por número",
    pista: "Materia y número, como el programa impreso",
  },
  {
    id: "estado",
    label: "Por estado",
    pista: "Primero lo que peor está: oxidados, sin empezar…",
  },
  {
    id: "urgencia",
    label: "Por urgencia de repaso",
    pista: "Primero lo que hace más que no tocas",
  },
  {
    id: "tiempo",
    label: "Por tiempo invertido",
    pista: "Primero los temas a los que menos horas les has echado",
  },
  {
    id: "nota",
    label: "Por nota de cante",
    pista: "Primero los peor cantados; los que no has cantado, al final",
  },
];

const ORDENES_VALIDOS = new Set<string>(ORDENES.map((o) => o.id));

export function esTono(v: unknown): v is Tono {
  return typeof v === "string" && TONOS_VALIDOS.has(v);
}
export function esAcento(v: unknown): v is Acento {
  return typeof v === "string" && ACENTOS_VALIDOS.has(v);
}
export function esFuenteTemas(v: unknown): v is FuenteTemas {
  return FUENTES.includes(v as FuenteTemas);
}
export function esDensidad(v: unknown): v is Densidad {
  return DENSIDADES.includes(v as Densidad);
}
export function esVistaPrograma(v: unknown): v is VistaPrograma {
  return VISTAS.includes(v as VistaPrograma);
}
export function esOrdenTemas(v: unknown): v is OrdenTemas {
  return typeof v === "string" && ORDENES_VALIDOS.has(v);
}

/** Recorta el cuerpo del texto al rango que el esquema acepta. */
export function acotarTamanoTema(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return TAMANO_TEMA_INICIAL;
  return Math.min(TAMANO_TEMA_MAXIMO, Math.max(TAMANO_TEMA_MINIMO, Math.round(n)));
}

/* ------------------------------------------------------------ diagnóstico -- */

/**
 * Lo que la pantalla de Ajustes le enseña al opositor cuando elige un color
 * libre: si ha habido que corregirlo y con qué contraste queda.
 *
 * Se le dice, no se le esconde: alguien que elige un amarillo flúor sobre
 * papel tiene derecho a saber que la app lo ha oscurecido para que se lea.
 */
export interface Veredicto {
  /** El color tal y como va a pintarse. */
  aplicado: string;
  /** true si no era legible y se ha corregido. */
  corregido: boolean;
  /** Contraste del sólido contra el fondo, ya corregido. */
  contrasteFondo: number;
  /** Contraste del color como texto contra el fondo. */
  contrasteTexto: number;
}

export function veredictoAcento(semilla: string, id: Tono): Veredicto {
  const t = tono(id);
  const pedido = normalizarHex(semilla) ?? ACENTO_PERSONAL_INICIAL;
  const p = paletaAcento(pedido, id);
  return {
    aplicado: p.lacre,
    corregido: p.lacre !== pedido,
    contrasteFondo: contraste(p.lacre, t.bg),
    contrasteTexto: contraste(p.lacreBright, t.bg),
  };
}

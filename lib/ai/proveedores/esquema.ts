/* ============================================================
   Traducir nuestros JSON Schema al subconjunto que acepta OpenAI

   Esta es la diferencia REAL más gorda entre los dos proveedores, y no se
   arregla cambiando los prompts (que se quedan como están): se arregla
   aquí.

   Anthropic acepta el esquema tal cual lo escribimos en las rutas.
   OpenAI, con `strict: true` —que es lo que da la garantía de forma, no
   una sugerencia—, solo admite un SUBCONJUNTO de JSON Schema y **rechaza
   la petición con un 400** si te sales. Tres reglas suyas chocan con lo
   que ya teníamos escrito:

     1. `additionalProperties: false` es OBLIGATORIO en todos los objetos.
        Nosotros ya lo poníamos, pero no se puede dar por hecho.

     2. `required` tiene que listar TODAS las propiedades. No hay campos
        opcionales. El truco que documenta OpenAI para emularlos es
        declararlos anulables: `"type": ["string", "null"]`. Nos afecta en
        `comparar-cante`, donde `cita` no era obligatoria; con OpenAI
        llegará como `null` cuando el modelo no tenga cita, que es
        exactamente lo mismo que antes era "campo ausente" y la interfaz
        ya trata como falsy.

     3. Las palabras clave de restricción por tipo NO están soportadas:
        `minimum`/`maximum`/`multipleOf` en números, `minItems`/`maxItems`/
        `uniqueItems` en arrays, `minLength`/`maxLength`/`pattern`/`format`
        en cadenas. Nuestro esquema de comparación usa
        `minimum: 0, maximum: 100` en la cobertura.

   Sobre el punto 3 hay documentación contradictoria: la tabla de
   limitaciones (Azure OpenAI, que documenta el mismo subconjunto) las
   lista como no soportadas, mientras que alguna página de OpenAI las da
   por buenas. Con esa duda, la decisión conservadora es la única sensata:
   si las dejamos y NO están soportadas, la petición falla entera con un
   400 y el opositor se queda sin análisis; si las quitamos y sí lo
   estaban, perdemos una garantía dura sobre un número. Así que se quitan
   y se vuelcan al `description`, que el modelo sí lee. Un 0-100 fuera de
   rango es un defecto cosmético; un 400 apaga la función.
   ============================================================ */

/** Palabras clave de restricción que OpenAI puede rechazar en modo estricto. */
const RESTRICCIONES = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "propertyNames",
  "patternProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contains",
  "minContains",
  "maxContains",
  "default",
  "examples",
] as const;

type Nodo = Record<string, unknown>;

/** Lo que se pierde al quitar una restricción, dicho en español para el modelo. */
function frase(clave: string, valor: unknown): string | null {
  switch (clave) {
    case "minimum":
      return `Valor mínimo: ${valor}.`;
    case "maximum":
      return `Valor máximo: ${valor}.`;
    case "exclusiveMinimum":
      return `Mayor que ${valor}.`;
    case "exclusiveMaximum":
      return `Menor que ${valor}.`;
    case "multipleOf":
      return `Múltiplo de ${valor}.`;
    case "minLength":
      return `Al menos ${valor} caracteres.`;
    case "maxLength":
      return `Como mucho ${valor} caracteres.`;
    case "pattern":
      return `Debe encajar con la expresión regular ${valor}.`;
    case "format":
      return `Formato: ${valor}.`;
    case "minItems":
      return `Al menos ${valor} elementos.`;
    case "maxItems":
      return `Como mucho ${valor} elementos.`;
    case "uniqueItems":
      return valor ? "Sin elementos repetidos." : null;
    default:
      return null;
  }
}

function esObjetoPlano(v: unknown): v is Nodo {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Añade el tipo `null` al que ya tenga, para emular un campo opcional. */
function anulable(nodo: Nodo): Nodo {
  const tipo = nodo.type;
  if (typeof tipo === "string") return { ...nodo, type: [tipo, "null"] };
  if (Array.isArray(tipo) && !tipo.includes("null")) {
    return { ...nodo, type: [...tipo, "null"] };
  }
  // Sin `type` (por ejemplo un `anyOf`) se añade la rama nula.
  if (Array.isArray(nodo.anyOf)) {
    return { ...nodo, anyOf: [...nodo.anyOf, { type: "null" }] };
  }
  return nodo;
}

/**
 * Devuelve una copia del esquema válida para `strict: true` de OpenAI.
 * No muta la entrada: los esquemas de las rutas son constantes de módulo y
 * se reutilizan en cada petición, también con el otro proveedor.
 */
export function aEsquemaEstricto(entrada: Nodo): Nodo {
  const salida: Nodo = {};
  const notas: string[] = [];

  for (const [clave, valor] of Object.entries(entrada)) {
    if ((RESTRICCIONES as readonly string[]).includes(clave)) {
      const nota = frase(clave, valor);
      if (nota) notas.push(nota);
      continue;
    }
    salida[clave] = valor;
  }

  // Las restricciones perdidas se le dicen al modelo en prosa, que es lo
  // único que queda cuando no se pueden imponer por esquema.
  if (notas.length) {
    const previo = typeof salida.description === "string" ? `${salida.description} ` : "";
    salida.description = `${previo}${notas.join(" ")}`.trim();
  }

  // Ramas recursivas.
  if (esObjetoPlano(salida.items)) salida.items = aEsquemaEstricto(salida.items);
  for (const rama of ["anyOf", "allOf", "oneOf"] as const) {
    if (Array.isArray(salida[rama])) {
      salida[rama] = (salida[rama] as unknown[]).map((n) =>
        esObjetoPlano(n) ? aEsquemaEstricto(n) : n,
      );
    }
  }
  if (esObjetoPlano(salida.$defs)) {
    const defs: Nodo = {};
    for (const [k, v] of Object.entries(salida.$defs)) {
      defs[k] = esObjetoPlano(v) ? aEsquemaEstricto(v) : v;
    }
    salida.$defs = defs;
  }

  if (esObjetoPlano(salida.properties)) {
    const requeridas = new Set(
      Array.isArray(salida.required) ? (salida.required as string[]) : [],
    );
    const propiedades: Nodo = {};
    for (const [nombre, sub] of Object.entries(salida.properties)) {
      if (!esObjetoPlano(sub)) {
        propiedades[nombre] = sub;
        continue;
      }
      const adaptada = aEsquemaEstricto(sub);
      // Lo que no era obligatorio pasa a serlo, pero anulable: es el modo
      // que documenta OpenAI para tener campos opcionales en modo estricto.
      propiedades[nombre] = requeridas.has(nombre) ? adaptada : anulable(adaptada);
    }
    salida.properties = propiedades;
    salida.required = Object.keys(propiedades);
    salida.additionalProperties = false;
  }

  return salida;
}

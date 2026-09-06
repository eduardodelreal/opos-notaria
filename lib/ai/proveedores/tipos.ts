/* ============================================================
   El contrato entre las rutas y el proveedor de IA

   Este fichero NO toca claves ni red: es solo la forma de lo que la app
   le pide a un modelo. Por eso no lleva `server-only` (las
   implementaciones sí). Está escrito con lo que la app necesita de
   verdad —tres operaciones, ni una más— y no con lo que ofrece un SDK
   concreto:

     · `conversacion`  el chat, en streaming.
     · `estructurada`  una respuesta que cumple un JSON Schema.
     · `texto`         una respuesta de texto corrido (plan, dictamen).

   Todo lo que sea peculiar de una API —cómo se pide la salida
   estructurada, cómo se llama el tope de tokens, qué eventos emite el
   streaming, cómo se declara una caché de prefijo— se queda DENTRO de
   la implementación. Las rutas no vuelven a saber de quién es la API.
   ============================================================ */

export type NombreProveedor = "anthropic" | "openai";

/** Un turno de la conversación. `rol` en español para no mezclar dialectos. */
export interface MensajeIA {
  rol: "user" | "assistant";
  texto: string;
}

/**
 * El esquema de una respuesta estructurada.
 *
 * `nombre` solo lo usa OpenAI (su `text.format` lo exige y valida contra
 * `[a-zA-Z0-9_-]{1,64}`); Anthropic no lo pide y lo ignora. Se pone en el
 * contrato porque un campo obligatorio de uno de los dos proveedores tiene
 * que viajar desde la ruta, no inventarse en el adaptador.
 */
export interface EsquemaSalida {
  nombre: string;
  schema: Record<string, unknown>;
}

export interface PeticionIA {
  /**
   * El system prompt. Es estable a propósito (`lib/ai/prompts.ts`) para que
   * se cachee: Anthropic lo marca con `cache_control` explícito y OpenAI
   * cachea los prefijos largos solo. Eso lo resuelve cada adaptador.
   */
  sistema: string;
  mensajes: MensajeIA[];
  /** Tope de tokens de SALIDA. Cada API le pone un nombre distinto. */
  maxTokens: number;
  /** Para cortar la llamada si el opositor cierra la pestaña. */
  senal?: AbortSignal;
}

export interface PeticionEstructurada extends PeticionIA {
  esquema: EsquemaSalida;
}

export interface RespuestaIA {
  /** El texto (o el JSON crudo, en `estructurada`). */
  texto: string;
  /**
   * El modelo declinó responder. Los dos proveedores lo señalan de forma
   * distinta —Anthropic con `stop_reason: "refusal"`, OpenAI con un bloque
   * de contenido `refusal`— y aquí llega ya normalizado.
   */
  rechazado: boolean;
}

/**
 * Una respuesta en streaming.
 *
 * `trozos` son los fragmentos de texto ya extraídos del evento que toque en
 * cada API. `huboRechazo()` solo tiene valor DESPUÉS de agotar `trozos`,
 * porque hasta que no termina la respuesta no se sabe.
 */
export interface FlujoIA {
  trozos: AsyncIterable<string>;
  huboRechazo(): boolean;
  /** Corta la llamada al proveedor: no se siguen pagando tokens. */
  abortar(): void;
}

export interface ProveedorIA {
  nombre: NombreProveedor;
  modelo: string;
  conversacion(peticion: PeticionIA): FlujoIA;
  estructurada(peticion: PeticionEstructurada): Promise<RespuestaIA>;
  texto(peticion: PeticionIA): Promise<RespuestaIA>;
}

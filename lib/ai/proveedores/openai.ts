import "server-only";
import OpenAI from "openai";
import type { Response as RespuestaOpenAI } from "openai/resources/responses/responses";
import { aEsquemaEstricto } from "./esquema";
import type {
  FlujoIA,
  PeticionEstructurada,
  PeticionIA,
  ProveedorIA,
  RespuestaIA,
} from "./tipos";

/* ============================================================
   El proveedor alternativo: OpenAI

   POR QUÉ LA RESPONSES API Y NO `chat.completions`
   ------------------------------------------------
   Las dos saben hacer lo que necesitamos (streaming, JSON Schema estricto
   y texto), así que la decisión no es de capacidades sino de encaje y de
   futuro:

     · Es la API que OpenAI recomienda para integraciones nuevas y la que
       recibe primero lo de los modelos de razonamiento actuales
       (`reasoning`, `text.verbosity`). `chat.completions` sigue viva, pero
       en modo mantenimiento.
     · Encaja pieza a pieza con lo que ya hacía la app: `instructions` es
       exactamente nuestro system prompt estable, `input` el historial,
       `text.format` el JSON Schema y `max_output_tokens` el tope. Con
       `chat.completions` el system prompt sería un mensaje más dentro del
       array, y la traducción desde el contrato sería más artificial.
     · En `chat.completions` el tope de tokens cambió de nombre para los
       modelos de razonamiento (`max_tokens` → `max_completion_tokens`, y
       el viejo lo rechazan). En Responses hay un solo nombre que vale
       siempre, así que no hay que adivinar de qué familia es el modelo
       que el opositor haya puesto en `OPENAI_MODEL`.

   Lo que se pierde con esta elección, dicho claro: `OPENAI_BASE_URL`
   solo sirve para servicios que hablen la Responses API. Los pasarelas
   compatibles-con-OpenAI que solo implementan `/chat/completions`
   (Groq, OpenRouter, llama.cpp…) no valen AQUÍ. Sí valen para la
   transcripción, que es otro dialecto y sigue siendo libre.

   OTRAS DIFERENCIAS REALES CON ANTHROPIC, Y CÓMO SE RESUELVEN
   -----------------------------------------------------------
   · Caché de prefijo: en Anthropic se marca con `cache_control`; en
     OpenAI es automática para prefijos largos y no se declara nada. No
     hay nada que traducir: los prompts estables siguen siendo lo correcto
     en los dos sitios. Se manda `prompt_cache_key` para que las llamadas
     de un mismo tipo caigan en la misma partición de caché.
   · `store`: la Responses API guarda las respuestas en OpenAI **por
     defecto** (30 días) para poder encadenarlas. Aquí se manda
     `store: false` a propósito: la app manda el historial entero en cada
     turno, no necesita estado en el servidor, y docs/ia.md promete que lo
     que se envía se envía y ya está.
   · El tope de tokens INCLUYE los de razonamiento. Un tope corto puede
     agotarse razonando y devolver una respuesta `incomplete` con texto
     vacío; eso aquí se convierte en un error legible en vez de en un
     JSON vacío.
   · El rechazo no es un `stop_reason`: es un bloque de contenido de tipo
     `refusal` dentro del mensaje.
   ============================================================ */

/**
 * Modelo por defecto. `gpt-5.6-sol` es el buque insignia para trabajo
 * profesional complejo, que es lo que hay aquí: textos jurídicos largos y
 * correcciones con criterio. Alternativas razonables por si el gasto
 * aprieta o sobra: `gpt-5.6-terra` (bastante más barato) y `gpt-6-astra`
 * (el más capaz). Se cambia con OPENAI_MODEL sin tocar código.
 */
export const MODELO_POR_DEFECTO = "gpt-5.6-sol";

/** Error con `status` para que `errorApi()` lo traduzca como los del SDK. */
function fallo(mensaje: string, status = 502): Error {
  const e = new Error(mensaje);
  (e as { status?: number }).status = status;
  return e;
}

/**
 * Saca de la respuesta el texto y si hubo rechazo. Se recorre `output` a
 * mano en vez de usar el atajo `output_text` del SDK porque también hay
 * que ver los bloques `refusal`, y porque en los modelos de razonamiento
 * `output` trae además ítems `reasoning` que no son respuesta.
 */
function leer(r: RespuestaOpenAI): RespuestaIA {
  let texto = "";
  let rechazado = false;

  for (const item of r.output ?? []) {
    if (item.type !== "message") continue;
    for (const parte of item.content ?? []) {
      if (parte.type === "output_text") texto += parte.text;
      else if (parte.type === "refusal") rechazado = true;
    }
  }

  if (!texto.trim() && !rechazado) {
    if (r.status === "incomplete") {
      const motivo = r.incomplete_details?.reason;
      throw fallo(
        motivo === "max_output_tokens"
          ? "El modelo se ha quedado sin tokens de salida antes de escribir nada. " +
            "En OpenAI el tope incluye los tokens de razonamiento: prueba con un " +
            "modelo menos razonador en OPENAI_MODEL."
          : `El modelo ha devuelto una respuesta incompleta (${motivo ?? "sin motivo"}).`,
      );
    }
    if (r.status === "failed") {
      throw fallo(r.error?.message || "El proveedor ha marcado la respuesta como fallida.");
    }
  }

  return { texto: texto.trim(), rechazado };
}

export function crearProveedorOpenAI(modelo: string): ProveedorIA {
  const cliente = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    // Sin variable, el SDK apunta a api.openai.com. Con ella se puede
    // apuntar a Azure OpenAI o a un servidor propio que hable Responses.
    ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
  });

  const comun = (p: PeticionIA, cache: string) => ({
    model: modelo,
    instructions: p.sistema,
    input: p.mensajes.map((m) => ({ role: m.rol, content: m.texto })),
    max_output_tokens: p.maxTokens,
    store: false,
    prompt_cache_key: `opos-notaria-${cache}`,
  });

  return {
    nombre: "openai",
    modelo,

    async texto(p: PeticionIA): Promise<RespuestaIA> {
      const r = await cliente.responses.create(comun(p, "texto"), { signal: p.senal });
      return leer(r);
    },

    async estructurada(p: PeticionEstructurada): Promise<RespuestaIA> {
      const r = await cliente.responses.create(
        {
          ...comun(p, p.esquema.nombre),
          text: {
            format: {
              type: "json_schema",
              name: p.esquema.nombre,
              // El esquema hay que traducirlo: ver lib/ai/proveedores/esquema.ts.
              schema: aEsquemaEstricto(p.esquema.schema),
              strict: true,
            },
          },
        },
        { signal: p.senal },
      );
      return leer(r);
    },

    conversacion(p: PeticionIA): FlujoIA {
      const flujo = cliente.responses.stream(comun(p, "chat"), { signal: p.senal });
      let rechazado = false;

      async function* trozos(): AsyncGenerator<string> {
        for await (const evento of flujo) {
          // El equivalente del `text_delta` de Anthropic. Los demás eventos
          // (creación, ítems de razonamiento, anotaciones) no se pintan.
          if (evento.type === "response.output_text.delta") yield evento.delta;
        }
        const final = await flujo.finalResponse();
        rechazado = leer(final).rechazado;
      }

      return {
        trozos: trozos(),
        huboRechazo: () => rechazado,
        abortar: () => flujo.abort(),
      };
    },
  };
}

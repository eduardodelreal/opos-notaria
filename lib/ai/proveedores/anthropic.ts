import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  FlujoIA,
  PeticionEstructurada,
  PeticionIA,
  ProveedorIA,
  RespuestaIA,
} from "./tipos";

/* ============================================================
   El proveedor de siempre: Anthropic (Claude)

   Es la implementación de referencia y la que tienen delante los prompts
   de `lib/ai/prompts.ts`. Aquí no hay nada nuevo respecto a lo que hacían
   las rutas antes de existir el adaptador; solo está recogido en un sitio.

   Dos cosas propias de esta API que el contrato esconde:

     · El system prompt va como bloque con `cache_control: ephemeral`. La
       caché de prefijo de Anthropic es EXPLÍCITA: si no marcas el bloque,
       no se cachea. Por eso los prompts son estables (sin fechas ni ids)
       y la ficha del opositor viaja en el mensaje de usuario.
     · La salida estructurada se pide con `output_config.format`, que lleva
       `schema` y no admite `nombre`: se ignora el del contrato.
   ============================================================ */

export const MODELO_POR_DEFECTO = "claude-opus-5";

/** El texto plano de una respuesta: los bloques que no son texto se caen. */
function textoDe(mensaje: Anthropic.Message): string {
  return mensaje.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export function crearProveedorAnthropic(modelo: string): ProveedorIA {
  // Un cliente por proceso: reaprovecha las conexiones. La clave la lee el
  // SDK de ANTHROPIC_API_KEY.
  const cliente = new Anthropic();

  const comun = (p: PeticionIA) => ({
    model: modelo,
    max_tokens: p.maxTokens,
    system: [
      {
        type: "text" as const,
        text: p.sistema,
        cache_control: { type: "ephemeral" as const },
      },
    ],
    messages: p.mensajes.map((m) => ({ role: m.rol, content: m.texto })),
  });

  return {
    nombre: "anthropic",
    modelo,

    async texto(p: PeticionIA): Promise<RespuestaIA> {
      const r = await cliente.messages.create(comun(p), { signal: p.senal });
      // Los clasificadores de seguridad pueden declinar (HTTP 200 con
      // stop_reason "refusal"). Con contenido jurídico es improbable, pero
      // si pasa hay que decirlo y no devolver una respuesta vacía.
      return { texto: textoDe(r), rechazado: r.stop_reason === "refusal" };
    },

    async estructurada(p: PeticionEstructurada): Promise<RespuestaIA> {
      const r = await cliente.messages.create(
        {
          ...comun(p),
          output_config: {
            format: { type: "json_schema", schema: p.esquema.schema },
          },
        },
        { signal: p.senal },
      );
      return { texto: textoDe(r), rechazado: r.stop_reason === "refusal" };
    },

    conversacion(p: PeticionIA): FlujoIA {
      const flujo = cliente.messages.stream(comun(p));
      let rechazado = false;

      async function* trozos(): AsyncGenerator<string> {
        for await (const evento of flujo) {
          if (
            evento.type === "content_block_delta" &&
            evento.delta.type === "text_delta"
          ) {
            yield evento.delta.text;
          }
        }
        // El motivo de parada solo se conoce al final del stream.
        const final = await flujo.finalMessage();
        rechazado = final.stop_reason === "refusal";
      }

      return {
        trozos: trozos(),
        huboRechazo: () => rechazado,
        abortar: () => flujo.abort(),
      };
    },
  };
}

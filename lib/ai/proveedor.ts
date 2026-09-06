import "server-only";
import { crearProveedorAnthropic, MODELO_POR_DEFECTO as MODELO_ANTHROPIC } from "./proveedores/anthropic";
import { crearProveedorOpenAI, MODELO_POR_DEFECTO as MODELO_OPENAI } from "./proveedores/openai";
import type { NombreProveedor, ProveedorIA } from "./proveedores/tipos";

/* ============================================================
   Quién atiende la IA en esta instalación

   Este fichero es el ÚNICO que mira las variables de entorno de las
   claves, y por eso lleva `server-only`: si alguien lo importa desde un
   componente de cliente, el build falla. Las rutas piden
   `proveedorActivo()` y no vuelven a saber de quién es la API.

   Cómo se elige:

     1. `IA_PROVEEDOR` manda siempre. Vale `anthropic` u `openai`. Si trae
        cualquier otra cosa NO se adivina nada: se responde con un error
        que dice qué se ha leído y qué valores hay. Un proveedor mal
        escrito que "cae" silenciosamente al otro es peor que un error.
     2. Sin esa variable, se deduce de la clave que haya: `ANTHROPIC_API_KEY`
        → Anthropic, `OPENAI_API_KEY` → OpenAI.
     3. Con las DOS claves y sin variable manda Anthropic, porque es lo que
        hacía la app hasta hoy y porque los prompts están afinados contra
        Claude (docs/ia.md). Para invertirlo, `IA_PROVEEDOR=openai`.
     4. Sin ninguna clave, la IA está apagada y se dice: 503 explicado,
        igual que siempre, y el resto de la app funciona entera.

   El modelo sale de `ANTHROPIC_MODEL` / `OPENAI_MODEL`, cada uno con su
   valor por defecto en el fichero del proveedor.
   ============================================================ */

export type { NombreProveedor, ProveedorIA } from "./proveedores/tipos";

/** Motivo por el que no hay proveedor, con su mensaje ya redactado. */
export interface SinProveedor {
  ok: false;
  error: "sin_clave" | "proveedor_desconocido";
  mensaje: string;
  estado: number;
}

export interface ConProveedor {
  ok: true;
  proveedor: ProveedorIA;
  nombre: NombreProveedor;
  modelo: string;
}

const NOMBRES: NombreProveedor[] = ["anthropic", "openai"];

function pedido(): string {
  return (process.env.IA_PROVEEDOR ?? "").trim().toLowerCase();
}

function hayClaveDe(nombre: NombreProveedor): boolean {
  return Boolean(
    nombre === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY,
  );
}

function modeloDe(nombre: NombreProveedor): string {
  return nombre === "anthropic"
    ? process.env.ANTHROPIC_MODEL || MODELO_ANTHROPIC
    : process.env.OPENAI_MODEL || MODELO_OPENAI;
}

/**
 * Qué proveedor toca, o por qué no hay ninguno. No se cachea el resultado
 * entre llamadas para que un cambio de variables en un reinicio caliente
 * se note; lo que sí se cachea es el cliente del SDK, que es lo caro.
 */
export function elegido(): NombreProveedor | SinProveedor {
  const marcado = pedido();

  if (marcado) {
    if (!(NOMBRES as string[]).includes(marcado)) {
      return {
        ok: false,
        error: "proveedor_desconocido",
        estado: 500,
        mensaje:
          `IA_PROVEEDOR vale "${marcado}" y no es un proveedor conocido. ` +
          `Los valores válidos son: ${NOMBRES.join(", ")}. ` +
          "Corrígelo o quita la variable para que se deduzca de la clave que tengas puesta.",
      };
    }
    const nombre = marcado as NombreProveedor;
    if (!hayClaveDe(nombre)) {
      return {
        ok: false,
        error: "sin_clave",
        estado: 503,
        mensaje:
          `IA_PROVEEDOR=${nombre}, pero falta su clave ` +
          `(${nombre === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"}). ` +
          "Ponla en .env.local y reinicia el servidor. El resto de la app funciona sin ella.",
      };
    }
    return nombre;
  }

  const deducido = NOMBRES.find(hayClaveDe);
  if (deducido) return deducido;

  return {
    ok: false,
    error: "sin_clave",
    estado: 503,
    mensaje:
      "No hay ninguna clave de IA configurada. Copia .env.example a .env.local, pon " +
      "ANTHROPIC_API_KEY o OPENAI_API_KEY y reinicia el servidor. El resto de la app " +
      "funciona sin ella.",
  };
}

/**
 * Los clientes de los SDK se crean una vez por proceso y por modelo:
 * reaprovechan conexiones y no hay razón para rehacerlos en cada petición.
 */
const cacheados = new Map<string, ProveedorIA>();

function instanciar(nombre: NombreProveedor, modelo: string): ProveedorIA {
  const llave = `${nombre}:${modelo}`;
  let p = cacheados.get(llave);
  if (!p) {
    p =
      nombre === "anthropic"
        ? crearProveedorAnthropic(modelo)
        : crearProveedorOpenAI(modelo);
    cacheados.set(llave, p);
  }
  return p;
}

/** Lo que llaman las rutas: el proveedor listo, o el motivo de que no haya. */
export function proveedorActivo(): ConProveedor | SinProveedor {
  const elección = elegido();
  if (typeof elección !== "string") return elección;
  const modelo = modeloDe(elección);
  return {
    ok: true,
    proveedor: instanciar(elección, modelo),
    nombre: elección,
    modelo,
  };
}

/** ¿Se puede llamar al modelo? Lo usa `/api/ai/estado` para encender botones. */
export function hayClave(): boolean {
  return typeof elegido() === "string";
}

/** El nombre del proveedor activo, o "" si no hay. Solo informativo. */
export function proveedorConfigurado(): NombreProveedor | "" {
  const e = elegido();
  return typeof e === "string" ? e : "";
}

/** El modelo que se usaría, o "" si no hay proveedor. */
export function modeloActivo(): string {
  const e = elegido();
  return typeof e === "string" ? modeloDe(e) : "";
}

/**
 * Respuesta uniforme cuando no se puede llamar al modelo. Mantiene el
 * contrato de antes —`{ error, mensaje }` y 503 sin clave— y añade el 500
 * del proveedor mal escrito, que es un fallo de configuración distinto.
 */
export function sinClave(motivo?: SinProveedor): Response {
  const m = motivo ?? { ...(elegido() as SinProveedor) };
  return Response.json({ error: m.error, mensaje: m.mensaje }, { status: m.estado });
}

/**
 * Traduce un error del SDK a una respuesta en español. Vale para los dos:
 * tanto `Anthropic.APIError` como `OpenAI.APIError` traen `status` y
 * `message`.
 */
export function errorApi(e: unknown) {
  const err = e as { status?: number; message?: string };
  const status = err?.status ?? 500;
  const mensaje =
    status === 401
      ? "La clave de la API no es válida."
      : status === 429
        ? "Has superado el límite de peticiones. Prueba en unos segundos."
        : err?.message || "Error inesperado llamando al modelo.";
  return Response.json({ error: "api", mensaje }, { status });
}

/** Respuesta uniforme cuando el modelo declina responder. */
export function rechazo(): Response {
  return Response.json(
    { error: "rechazo", mensaje: "El modelo no ha podido procesar esta petición." },
    { status: 422 },
  );
}

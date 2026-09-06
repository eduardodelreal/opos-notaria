/**
 * Prueba de extremo a extremo de la capa de IA, sin claves y sin salir a
 * internet.
 *
 * Qué demuestra: que las rutas de `app/api/ai/*` hablan de verdad el
 * protocolo de cada proveedor. Se levantan DOS servidores de mentira en
 * localhost —uno que habla la Responses API de OpenAI y el dialecto
 * `/audio/transcriptions`, y otro que habla la Messages API de
 * Anthropic—, se apuntan los SDK a ellos con sus variables de URL base y
 * se ejecutan los manejadores reales de las rutas.
 *
 * Se comprueban las dos direcciones:
 *   · lo que SALE: que la petición que recibe el proveedor es la correcta
 *     (esquema traducido al modo estricto, `store: false`, el system prompt
 *     en `instructions`, el tope de tokens con su nombre);
 *   · lo que ENTRA: que el streaming llega entero y con su centinela de
 *     fin, que el JSON estructurado cumple el esquema que pidió la ruta y
 *     que la transcripción vuelve como texto.
 *
 * Y la degradación: sin ninguna clave, 503 explicado; con `IA_PROVEEDOR`
 * mal escrito, un error que dice qué pasa.
 *
 * Qué NO demuestra: que OpenAI o Anthropic de verdad acepten estas
 * peticiones. Eso solo lo dice una clave real. Lo que sí se ha hecho es
 * copiar la forma exacta de sus APIs (los SDK oficiales validan bastante
 * de lo que reciben, así que un evento inventado aquí reventaría).
 *
 * Uso:
 *   node --experimental-strip-types --import ./pruebas/cargador-app.mjs \
 *        pruebas/ia-proveedor.mjs
 */

import assert from "node:assert/strict";
import http from "node:http";

import { FIN_RESPUESTA } from "../lib/ai/protocolo.ts";

/* ============================================================
   Andamiaje
   ============================================================ */

let fallos = 0;
let hechas = 0;

async function prueba(nombre, fn) {
  hechas += 1;
  try {
    await fn();
    console.log(`  ok  ${nombre}`);
  } catch (e) {
    fallos += 1;
    console.log(`  FAIL ${nombre}\n       ${e.message}`);
  }
}

function leerCuerpo(req) {
  return new Promise((resolve) => {
    const trozos = [];
    req.on("data", (t) => trozos.push(t));
    req.on("end", () => resolve(Buffer.concat(trozos)));
  });
}

function escuchar(servidor) {
  return new Promise((resolve) => {
    servidor.listen(0, "127.0.0.1", () => resolve(servidor.address().port));
  });
}

/* ============================================================
   Un validador de JSON Schema mínimo

   Solo el subconjunto que usan nuestros esquemas: tipos, required,
   additionalProperties, properties, items, enum y los rangos numéricos.
   Sirve para lo que hace falta aquí: comprobar que lo que devuelve la
   ruta encaja con el esquema que la ruta pidió, en vez de fiarse.
   ============================================================ */
function valida(esquema, valor, ruta = "raíz") {
  const errores = [];
  const tipos = Array.isArray(esquema.type) ? esquema.type : [esquema.type];
  const tipoDe = (v) =>
    v === null
      ? "null"
      : Array.isArray(v)
        ? "array"
        : Number.isInteger(v)
          ? "integer"
          : typeof v === "number"
            ? "number"
            : typeof v;

  if (esquema.type) {
    const t = tipoDe(valor);
    const vale = tipos.some((e) => e === t || (e === "number" && t === "integer"));
    if (!vale) errores.push(`${ruta}: se esperaba ${tipos.join("|")} y llegó ${t}`);
  }
  if (esquema.enum && !esquema.enum.includes(valor)) {
    errores.push(`${ruta}: "${valor}" no está en el enum`);
  }
  if (typeof valor === "number") {
    if (esquema.minimum !== undefined && valor < esquema.minimum) {
      errores.push(`${ruta}: ${valor} < ${esquema.minimum}`);
    }
    if (esquema.maximum !== undefined && valor > esquema.maximum) {
      errores.push(`${ruta}: ${valor} > ${esquema.maximum}`);
    }
  }
  if (Array.isArray(valor) && esquema.items) {
    valor.forEach((v, i) => errores.push(...valida(esquema.items, v, `${ruta}[${i}]`)));
  }
  if (valor && typeof valor === "object" && !Array.isArray(valor) && esquema.properties) {
    for (const req of esquema.required ?? []) {
      if (!(req in valor)) errores.push(`${ruta}: falta la propiedad obligatoria "${req}"`);
    }
    if (esquema.additionalProperties === false) {
      for (const k of Object.keys(valor)) {
        if (!(k in esquema.properties)) errores.push(`${ruta}: propiedad de más "${k}"`);
      }
    }
    for (const [k, sub] of Object.entries(esquema.properties)) {
      if (k in valor && valor[k] !== null) {
        errores.push(...valida(sub, valor[k], `${ruta}.${k}`));
      }
    }
  }
  return errores;
}

/** Recorre un esquema y devuelve las claves que aparecen en cualquier nivel. */
function clavesDe(nodo, vistas = new Set()) {
  if (!nodo || typeof nodo !== "object") return vistas;
  if (Array.isArray(nodo)) {
    nodo.forEach((n) => clavesDe(n, vistas));
    return vistas;
  }
  for (const [k, v] of Object.entries(nodo)) {
    vistas.add(k);
    clavesDe(v, vistas);
  }
  return vistas;
}

/** Comprueba, en todos los niveles, las reglas del modo estricto de OpenAI. */
function revisaEstricto(nodo, ruta = "raíz", errores = []) {
  if (!nodo || typeof nodo !== "object") return errores;
  if (Array.isArray(nodo)) {
    nodo.forEach((n, i) => revisaEstricto(n, `${ruta}[${i}]`, errores));
    return errores;
  }
  if (nodo.properties) {
    if (nodo.additionalProperties !== false) {
      errores.push(`${ruta}: falta additionalProperties:false`);
    }
    const props = Object.keys(nodo.properties);
    const req = nodo.required ?? [];
    for (const p of props) {
      if (!req.includes(p)) errores.push(`${ruta}: "${p}" no está en required`);
    }
  }
  for (const [k, v] of Object.entries(nodo)) revisaEstricto(v, `${ruta}.${k}`, errores);
  return errores;
}

/* ============================================================
   Servidor falso 1: OpenAI (Responses API + /audio/transcriptions)
   ============================================================ */

const recibidoOpenAI = [];
/** Se puede trucar desde una prueba para simular respuestas raras. */
const guionOpenAI = { texto: null, jsonEstructurado: null, rechazar: false };

const TEXTO_STREAM = [
  "Vas justo de tiempo en el tema 47. ",
  "Lo primero es el epígrafe de la responsabilidad hipotecaria: ",
  "te dejaste el 1911 CC y el tribunal eso lo pregunta.",
];

const ANALISIS_VALIDO = {
  titular: "Buen ritmo, pero te comes el tercer epígrafe.",
  diagnostico:
    "Has cantado el tema en 21 minutos, dos por encima del objetivo, y el tiempo se te va en la introducción. Respecto a los dos cantes anteriores mejoras en fluidez pero repites la misma laguna.",
  fortalezas: ["Clasificación de los derechos reales, impecable."],
  mejoras: [
    { que: "Epígrafe 3: responsabilidad hipotecaria", como: "Cántalo suelto tres veces seguidas mañana.", prioridad: "alta" },
    { que: "Introducción demasiado larga", como: "Recórtala a 90 segundos cronometrados.", prioridad: "media" },
  ],
  focoProximaSesion: "Epígrafe 3, cantado en voz alta y cronometrado.",
  epigrafesCriticos: ["Responsabilidad hipotecaria"],
};

function sse(res, evento) {
  res.write(`event: ${evento.type}\ndata: ${JSON.stringify(evento)}\n\n`);
}

function respuestaOpenAI(cuerpo, texto, estado = "completed") {
  return {
    id: "resp_falsa_1",
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: estado,
    error: null,
    incomplete_details: null,
    instructions: cuerpo.instructions ?? null,
    model: cuerpo.model,
    output: [
      {
        id: "msg_falsa_1",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: texto, annotations: [] }],
      },
    ],
    parallel_tool_calls: false,
    tool_choice: "auto",
    tools: [],
    usage: { input_tokens: 1200, output_tokens: 300, total_tokens: 1500 },
  };
}

const servidorOpenAI = http.createServer(async (req, res) => {
  const cuerpoCrudo = await leerCuerpo(req);

  if (req.url.endsWith("/audio/transcriptions")) {
    const texto = cuerpoCrudo.toString("latin1");
    recibidoOpenAI.push({
      ruta: "audio",
      auth: req.headers.authorization,
      multipart: texto,
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        text: "Tema cuarenta y siete. La hipoteca. Concepto y caracteres.",
        duration: 742.5,
      }),
    );
    return;
  }

  const cuerpo = JSON.parse(cuerpoCrudo.toString("utf8"));
  recibidoOpenAI.push({ ruta: "responses", auth: req.headers.authorization, cuerpo });

  // Con `text.format` la respuesta es el JSON estructurado; si no, texto.
  const esEstructurada = cuerpo.text?.format?.type === "json_schema";
  const texto = esEstructurada
    ? JSON.stringify(guionOpenAI.jsonEstructurado ?? ANALISIS_VALIDO)
    : (guionOpenAI.texto ?? TEXTO_STREAM.join(""));

  if (!cuerpo.stream) {
    const r = respuestaOpenAI(cuerpo, texto);
    if (guionOpenAI.rechazar) {
      // Así señala OpenAI que declina: una parte de contenido `refusal`,
      // no un `stop_reason` como en Anthropic.
      r.output[0].content = [{ type: "refusal", refusal: "No puedo ayudar con eso." }];
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(r));
    return;
  }

  // Streaming: la secuencia real de eventos de la Responses API. El SDK la
  // valida (exige que el ítem y la parte de contenido existan antes de los
  // deltas), así que esto no se puede "simplificar" y seguir pasando.
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const vacia = { ...respuestaOpenAI(cuerpo, ""), status: "in_progress" };
  vacia.output = [];
  let n = 0;
  sse(res, { type: "response.created", sequence_number: n++, response: vacia });
  sse(res, { type: "response.in_progress", sequence_number: n++, response: vacia });
  sse(res, {
    type: "response.output_item.added",
    sequence_number: n++,
    output_index: 0,
    item: { id: "msg_falsa_1", type: "message", status: "in_progress", role: "assistant", content: [] },
  });
  sse(res, {
    type: "response.content_part.added",
    sequence_number: n++,
    item_id: "msg_falsa_1",
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: "", annotations: [] },
  });
  const trozos = guionOpenAI.texto ? [guionOpenAI.texto] : TEXTO_STREAM;
  for (const trozo of trozos) {
    sse(res, {
      type: "response.output_text.delta",
      sequence_number: n++,
      item_id: "msg_falsa_1",
      output_index: 0,
      content_index: 0,
      delta: trozo,
      logprobs: [],
    });
  }
  const completo = trozos.join("");
  sse(res, {
    type: "response.output_text.done",
    sequence_number: n++,
    item_id: "msg_falsa_1",
    output_index: 0,
    content_index: 0,
    text: completo,
    logprobs: [],
  });
  sse(res, {
    type: "response.content_part.done",
    sequence_number: n++,
    item_id: "msg_falsa_1",
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: completo, annotations: [] },
  });
  sse(res, {
    type: "response.output_item.done",
    sequence_number: n++,
    output_index: 0,
    item: {
      id: "msg_falsa_1",
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: completo, annotations: [] }],
    },
  });
  sse(res, {
    type: "response.completed",
    sequence_number: n++,
    response: respuestaOpenAI(cuerpo, completo),
  });
  res.end();
});

/* ============================================================
   Servidor falso 2: Anthropic (Messages API)
   ============================================================ */

const recibidoAnthropic = [];

const servidorAnthropic = http.createServer(async (req, res) => {
  const cuerpo = JSON.parse((await leerCuerpo(req)).toString("utf8"));
  recibidoAnthropic.push({ cuerpo, apiKey: req.headers["x-api-key"] });

  const esEstructurada = Boolean(cuerpo.output_config?.format);
  const texto = esEstructurada ? JSON.stringify(ANALISIS_VALIDO) : TEXTO_STREAM.join("");

  if (!cuerpo.stream) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "msg_falsa_1",
        type: "message",
        role: "assistant",
        model: cuerpo.model,
        content: [{ type: "text", text: texto }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1200, output_tokens: 300 },
      }),
    );
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  sse(res, {
    type: "message_start",
    message: {
      id: "msg_falsa_1",
      type: "message",
      role: "assistant",
      model: cuerpo.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 0 },
    },
  });
  sse(res, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  for (const trozo of TEXTO_STREAM) {
    sse(res, {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: trozo },
    });
  }
  sse(res, { type: "content_block_stop", index: 0 });
  sse(res, {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 300 },
  });
  sse(res, { type: "message_stop" });
  res.end();
});

/* ============================================================
   Arranque
   ============================================================ */

const puertoOpenAI = await escuchar(servidorOpenAI);
const puertoAnthropic = await escuchar(servidorAnthropic);

process.env.OPENAI_BASE_URL = `http://127.0.0.1:${puertoOpenAI}/v1`;
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${puertoAnthropic}`;
process.env.OPENAI_API_KEY = "sk-falsa-openai";
process.env.ANTHROPIC_API_KEY = "sk-falsa-anthropic";
process.env.OPENAI_MODEL = "gpt-5.6-sol";
process.env.ANTHROPIC_MODEL = "claude-opus-5";
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
delete process.env.TRANSCRIPCION_API_KEY;
delete process.env.TRANSCRIPCION_URL;

// Las rutas se importan DESPUÉS de fijar el entorno: el cliente del SDK se
// crea en la primera llamada y ahí es donde lee la URL base.
const { POST: chat } = await import("../app/api/ai/chat/route.ts");
const { POST: analisis } = await import("../app/api/ai/analisis-cante/route.ts");
const { POST: comparar } = await import("../app/api/ai/comparar-cante/route.ts");
const { POST: transcribir } = await import("../app/api/ai/transcribir/route.ts");
const { POST: plan } = await import("../app/api/ai/plan/route.ts");
const { GET: estado } = await import("../app/api/ai/estado/route.ts");
const { aEsquemaEstricto } = await import("../lib/ai/proveedores/esquema.ts");

const post = (cuerpo) =>
  new Request("http://localhost/api/ai/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });

const FICHA = "Ficha del opositor: 12 temas de alta, 28 h/semana, nota media 5,4.";
const DETALLE = "Cante del tema 47, 21 minutos, dos lagunas en el epígrafe 3.";

async function texto(res) {
  const trozos = [];
  const lector = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    trozos.push(dec.decode(value, { stream: true }));
  }
  return trozos.join("");
}

/* ============================================================
   1. OpenAI
   ============================================================ */

console.log("\n— OpenAI (Responses API) —");
process.env.IA_PROVEEDOR = "openai";

await prueba("el chat llega entero y termina con el centinela de fin", async () => {
  recibidoOpenAI.length = 0;
  const res = await chat(
    post({
      mensajes: [{ rol: "user", texto: "¿Qué hago hoy?" }],
      ficha: FICHA,
      estilo: "directo",
    }),
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/plain/);
  const salida = await texto(res);
  assert.ok(salida.endsWith(FIN_RESPUESTA), "la respuesta no acaba en el centinela");
  assert.equal(salida.slice(0, -1), TEXTO_STREAM.join(""), "el texto llegó incompleto");
});

await prueba("la petición de chat sale con la forma de la Responses API", async () => {
  const { cuerpo, auth } = recibidoOpenAI.at(-1);
  assert.equal(auth, "Bearer sk-falsa-openai");
  assert.equal(cuerpo.stream, true);
  assert.equal(cuerpo.model, "gpt-5.6-sol");
  assert.equal(cuerpo.max_output_tokens, 16000, "el tope va en max_output_tokens");
  assert.equal(cuerpo.store, false, "no se debe guardar la respuesta en OpenAI");
  assert.ok(
    cuerpo.instructions.startsWith("Eres preparador de la oposición a Notarías"),
    "el system prompt tiene que ir en `instructions`, intacto",
  );
  assert.equal(cuerpo.input.length, 1);
  assert.equal(cuerpo.input[0].role, "user");
  assert.ok(
    cuerpo.input[0].content.includes("<ficha_del_opositor>"),
    "la ficha viaja en el mensaje de usuario, no en el system prompt",
  );
  assert.ok(!("max_tokens" in cuerpo), "max_tokens es de la otra API");
  assert.ok(!("system" in cuerpo), "`system` es de Anthropic");
});

await prueba("el análisis devuelve JSON que cumple el esquema de la ruta", async () => {
  const res = await analisis(post({ detalleCante: DETALLE, ficha: FICHA, estilo: "directo" }));
  assert.equal(res.status, 200);
  const datos = await res.json();
  assert.equal(datos.modelo, "gpt-5.6-sol");
  const esquema = recibidoOpenAI.at(-1).cuerpo.text.format.schema;
  const errores = valida(esquema, datos.analisis);
  assert.deepEqual(errores, [], `el JSON no cumple el esquema: ${errores.join("; ")}`);
});

await prueba("el esquema sale traducido al modo estricto de OpenAI", async () => {
  const formato = recibidoOpenAI.at(-1).cuerpo.text.format;
  assert.equal(formato.type, "json_schema");
  assert.equal(formato.strict, true);
  assert.equal(formato.name, "analisis_cante");
  const problemas = revisaEstricto(formato.schema);
  assert.deepEqual(problemas, [], `esquema no estricto: ${problemas.join("; ")}`);
});

await prueba("comparar-cante: `cita` opcional pasa a required y anulable", async () => {
  const res = await comparar(post({ comparacion: "TEMA…\n\nCANTE…", estilo: "directo" }));
  assert.equal(res.status, 200);
  const esquema = recibidoOpenAI.at(-1).cuerpo.text.format.schema;
  const omision = esquema.properties.omisiones.items;
  assert.ok(omision.required.includes("cita"), "`cita` tiene que estar en required");
  assert.deepEqual(
    omision.properties.cita.type,
    ["string", "null"],
    "un campo antes opcional tiene que quedar anulable",
  );
  // Y las restricciones numéricas no soportadas no viajan.
  const claves = clavesDe(esquema);
  for (const prohibida of ["minimum", "maximum", "minItems", "maxItems", "pattern"]) {
    assert.ok(!claves.has(prohibida), `"${prohibida}" no debería viajar a OpenAI`);
  }
  // Pero la restricción no se pierde del todo: queda dicha en el texto.
  assert.match(esquema.properties.cobertura.description, /mínimo: 0|máximo: 100/i);
});

await prueba("la transcripción usa la clave de OpenAI sin configurar otra", async () => {
  const forma = new FormData();
  forma.append("audio", new Blob([new Uint8Array(2048)], { type: "audio/webm" }), "cante.webm");
  forma.append("pista", "Tema 47. La hipoteca.");
  const res = await transcribir(
    new Request("http://localhost/api/ai/transcribir", { method: "POST", body: forma }),
  );
  assert.equal(res.status, 200);
  const datos = await res.json();
  assert.match(datos.transcripcion.texto, /hipoteca/i);
  assert.equal(datos.transcripcion.segundos, 743);
  const audio = recibidoOpenAI.filter((r) => r.ruta === "audio").at(-1);
  assert.equal(audio.auth, "Bearer sk-falsa-openai", "debe heredar la clave de OpenAI");
  assert.match(audio.multipart, /name="model"[\s\S]*whisper-1/);
  assert.match(audio.multipart, /name="language"[\s\S]*es/);
  assert.match(audio.multipart, /filename="cante\.webm"/);
});

await prueba("/api/ai/estado dice quién atiende", async () => {
  const res = await estado(new Request("http://localhost/api/ai/estado"));
  const d = await res.json();
  assert.equal(d.disponible, true);
  assert.equal(d.proveedor, "openai");
  assert.equal(d.modelo, "gpt-5.6-sol");
  assert.equal(d.transcripcion, true);
});

await prueba("el plan (respuesta de texto) vuelve entero", async () => {
  const res = await plan(post({ ficha: FICHA, instrucciones: "El jueves no puedo." }));
  assert.equal(res.status, 200);
  const datos = await res.json();
  assert.equal(datos.plan, TEXTO_STREAM.join(""));
  assert.equal(datos.modelo, "gpt-5.6-sol");
  const { cuerpo } = recibidoOpenAI.at(-1);
  assert.equal(cuerpo.stream, undefined, "el plan no va en streaming");
  assert.equal(cuerpo.max_output_tokens, 16000);
  assert.ok(!cuerpo.text, "sin esquema no se manda text.format");
  assert.ok(cuerpo.input[0].content.includes("El jueves no puedo."));
});

await prueba("un rechazo de OpenAI sale como 422 y no como texto vacío", async () => {
  guionOpenAI.rechazar = true;
  try {
    const res = await plan(post({ ficha: FICHA }));
    assert.equal(res.status, 422);
    const d = await res.json();
    assert.equal(d.error, "rechazo");
  } finally {
    guionOpenAI.rechazar = false;
  }
});

/* ============================================================
   2. Anthropic (que la refactorización no se lo haya llevado por delante)
   ============================================================ */

console.log("\n— Anthropic (Messages API) —");
process.env.IA_PROVEEDOR = "anthropic";

await prueba("el chat sigue funcionando contra Anthropic", async () => {
  recibidoAnthropic.length = 0;
  const res = await chat(
    post({ mensajes: [{ rol: "user", texto: "¿Qué hago hoy?" }], ficha: FICHA }),
  );
  const salida = await texto(res);
  assert.ok(salida.endsWith(FIN_RESPUESTA));
  assert.equal(salida.slice(0, -1), TEXTO_STREAM.join(""));
  const { cuerpo } = recibidoAnthropic.at(-1);
  assert.equal(cuerpo.max_tokens, 16000, "aquí el tope sí se llama max_tokens");
  assert.equal(cuerpo.system[0].cache_control.type, "ephemeral", "la caché va marcada");
  assert.ok(!("instructions" in cuerpo), "`instructions` es de la otra API");
});

await prueba("el análisis con Anthropic manda el esquema SIN tocar", async () => {
  const res = await analisis(post({ detalleCante: DETALLE, ficha: FICHA }));
  assert.equal(res.status, 200);
  const datos = await res.json();
  assert.equal(datos.modelo, "claude-opus-5");
  const { cuerpo } = recibidoAnthropic.at(-1);
  assert.equal(cuerpo.output_config.format.type, "json_schema");
  assert.equal(
    cuerpo.output_config.format.schema.properties.mejoras.items.required.length,
    3,
    "el esquema de Anthropic no se traduce: va tal cual",
  );
  const errores = valida(cuerpo.output_config.format.schema, datos.analisis);
  assert.deepEqual(errores, []);
});

await prueba("el plan con Anthropic vuelve entero", async () => {
  const res = await plan(post({ ficha: FICHA }));
  assert.equal(res.status, 200);
  const datos = await res.json();
  assert.equal(datos.plan, TEXTO_STREAM.join(""));
  assert.equal(datos.modelo, "claude-opus-5");
  const { cuerpo } = recibidoAnthropic.at(-1);
  assert.equal(cuerpo.max_tokens, 16000);
  assert.ok(!cuerpo.output_config, "sin esquema no se manda output_config");
});

/* ============================================================
   3. Degradación
   ============================================================ */

console.log("\n— Degradación —");

await prueba("sin ninguna clave: 503 explicado y nada de red", async () => {
  delete process.env.IA_PROVEEDOR;
  const anth = process.env.ANTHROPIC_API_KEY;
  const oai = process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const res = await chat(post({ mensajes: [{ rol: "user", texto: "hola" }], ficha: FICHA }));
    assert.equal(res.status, 503);
    const d = await res.json();
    assert.equal(d.error, "sin_clave");
    assert.match(d.mensaje, /ANTHROPIC_API_KEY o OPENAI_API_KEY/);

    const e = await (await estado(new Request("http://localhost/api/ai/estado"))).json();
    assert.equal(e.disponible, false);
    assert.equal(e.proveedor, "");
    assert.equal(e.transcripcion, false, "sin clave de OpenAI tampoco hay transcripción");
  } finally {
    process.env.ANTHROPIC_API_KEY = anth;
    process.env.OPENAI_API_KEY = oai;
  }
});

await prueba("IA_PROVEEDOR con un valor desconocido: error claro", async () => {
  process.env.IA_PROVEEDOR = "gemini";
  const res = await chat(post({ mensajes: [{ rol: "user", texto: "hola" }], ficha: FICHA }));
  assert.equal(res.status, 500);
  const d = await res.json();
  assert.equal(d.error, "proveedor_desconocido");
  assert.match(d.mensaje, /"gemini"/);
  assert.match(d.mensaje, /anthropic, openai/);
  delete process.env.IA_PROVEEDOR;
});

await prueba("IA_PROVEEDOR=openai sin su clave: lo dice por su nombre", async () => {
  process.env.IA_PROVEEDOR = "openai";
  const oai = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const res = await chat(post({ mensajes: [{ rol: "user", texto: "hola" }], ficha: FICHA }));
    assert.equal(res.status, 503);
    const d = await res.json();
    assert.match(d.mensaje, /OPENAI_API_KEY/);
  } finally {
    process.env.OPENAI_API_KEY = oai;
    delete process.env.IA_PROVEEDOR;
  }
});

await prueba("la clave de OpenAI NO viaja a un transcriptor de terceros", async () => {
  process.env.TRANSCRIPCION_URL = "https://api.groq.com/openai/v1";
  try {
    const { hayTranscripcion, claveTranscripcion } = await import("../lib/ai/transcripcion.ts");
    assert.equal(claveTranscripcion(), undefined);
    assert.equal(hayTranscripcion(), false);
  } finally {
    delete process.env.TRANSCRIPCION_URL;
  }
});

/* ============================================================
   4. La traducción de esquemas, en aislado
   ============================================================ */

console.log("\n— Traducción de esquemas —");

await prueba("aEsquemaEstricto no muta el esquema de entrada", async () => {
  const entrada = {
    type: "object",
    required: ["a"],
    properties: { a: { type: "string" }, b: { type: "integer", minimum: 0, maximum: 100 } },
  };
  const copia = JSON.parse(JSON.stringify(entrada));
  aEsquemaEstricto(entrada);
  assert.deepEqual(entrada, copia, "el esquema original no se puede tocar");
});

await prueba("aEsquemaEstricto conserva enum y anida bien", async () => {
  const salida = aEsquemaEstricto({
    type: "object",
    required: [],
    properties: {
      lista: {
        type: "array",
        minItems: 2,
        items: { type: "object", required: ["x"], properties: { x: { type: "string", enum: ["a", "b"] } } },
      },
    },
  });
  assert.deepEqual(salida.properties.lista.type, ["array", "null"]);
  assert.ok(!("minItems" in salida.properties.lista));
  assert.match(salida.properties.lista.description, /Al menos 2 elementos/);
  assert.deepEqual(salida.properties.lista.items.properties.x.enum, ["a", "b"]);
  assert.equal(salida.properties.lista.items.additionalProperties, false);
});

/* ============================================================
   Cierre
   ============================================================ */

servidorOpenAI.close();
servidorAnthropic.close();

console.log(`\n${hechas - fallos}/${hechas} pruebas ok`);
process.exit(fallos ? 1 : 0);

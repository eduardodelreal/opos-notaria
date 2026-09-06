# Las funciones de IA

Cómo está montada la capa de IA, qué se envía y por qué se ha decidido así.
Todo el código relevante está en `lib/ai/*` y `app/api/ai/*`.

---

## Con qué modelo se habla (`lib/ai/proveedor.ts`)

La app **no está casada con un proveedor**. Habla con Anthropic (Claude) o
con OpenAI, y las rutas no saben con cuál: piden `proveedorActivo()` y
llaman a tres operaciones —`conversacion` (streaming), `estructurada`
(JSON Schema) y `texto`— definidas en `lib/ai/proveedores/tipos.ts`.
Cada implementación (`proveedores/anthropic.ts`, `proveedores/openai.ts`)
se traga las diferencias de su API.

### Cómo se elige

| Situación | Quién atiende |
|---|---|
| `IA_PROVEEDOR=anthropic` | Anthropic. Si falta su clave, 503 diciéndolo por su nombre |
| `IA_PROVEEDOR=openai` | OpenAI. Ídem |
| Sin `IA_PROVEEDOR`, solo `ANTHROPIC_API_KEY` | Anthropic |
| Sin `IA_PROVEEDOR`, solo `OPENAI_API_KEY` | OpenAI |
| Sin `IA_PROVEEDOR`, **las dos claves** | Anthropic (es lo de antes, y los prompts están afinados para Claude) |
| Sin ninguna clave | La IA se apaga: **503** con `{ error: "sin_clave" }` y el resto de la app entera |
| `IA_PROVEEDOR` con cualquier otra cosa | **500** con `{ error: "proveedor_desconocido" }`, diciendo qué se ha leído y qué valores hay |

Lo último importa: un proveedor mal escrito **no** cae en silencio al
otro. Un `IA_PROVEEDOR=chatgpt` que "funciona" cobrando en Anthropic es
peor que un error.

### Las variables

| Variable | Para qué |
|---|---|
| `IA_PROVEEDOR` | `anthropic` u `openai`. Vacía: se deduce de las claves |
| `ANTHROPIC_API_KEY` | Clave de Anthropic |
| `ANTHROPIC_MODEL` | Por defecto `claude-opus-5` |
| `OPENAI_API_KEY` | Clave de OpenAI. También vale para la transcripción |
| `OPENAI_MODEL` | Por defecto `gpt-5.6-sol` |
| `OPENAI_BASE_URL` | Otra URL base (Azure OpenAI, pasarela propia). Tiene que hablar la **Responses API** |

### Volver a Anthropic

Poner `IA_PROVEEDOR=anthropic` (o quitar `OPENAI_API_KEY`) y reiniciar. Ya
está: no hay estado guardado en ningún sitio que dependa del proveedor, y
los análisis y comparaciones ya guardados se siguen leyendo igual porque
la forma la fija nuestro JSON Schema, no el proveedor. Lo único que queda
apuntado del proveedor es el campo `modelo` que devuelven las rutas y que
se guarda junto a cada análisis, que es informativo.

### Por qué la Responses API y no `chat.completions`

Las dos saben hacerlo. Se eligió Responses porque:

- Es la API que OpenAI recomienda para integraciones nuevas y donde los
  modelos de razonamiento actuales exponen sus mandos (`reasoning`,
  `text.verbosity`). `chat.completions` sigue viva, pero en mantenimiento.
- Encaja pieza a pieza con lo que la app ya hacía: `instructions` es el
  system prompt estable, `input` el historial, `text.format` el JSON
  Schema, `max_output_tokens` el tope. Con `chat.completions` el system
  prompt sería un mensaje más del array.
- En `chat.completions` el tope cambió de nombre para los modelos de
  razonamiento (`max_tokens` → `max_completion_tokens`, y el viejo lo
  rechazan). En Responses hay un solo nombre, así que da igual qué familia
  de modelo ponga el opositor en `OPENAI_MODEL`.

**El precio**: `OPENAI_BASE_URL` solo vale para servicios que hablen la
Responses API. Las pasarelas compatibles-con-OpenAI que solo implementan
`/chat/completions` (Groq, OpenRouter, llama.cpp) **no valen aquí**. Sí
valen para la transcripción, que es otro dialecto y sigue siendo libre.

Se manda además `store: false`: la Responses API guarda las respuestas 30
días por defecto, y esta app manda el historial entero en cada turno, así
que no necesita estado del lado de OpenAI.

---

## Qué cambia de verdad si usas OpenAI

Honestamente: **los prompts están afinados contra Claude** y no se han
reescrito por proveedor (son de dominio, no de API). Lo que cabe esperar:

- **El tono.** Las tres personalidades (`directo`, `equilibrado`,
  `amable`) se calibraron leyendo respuestas de Claude. `directo`, que es
  el que va por defecto, tiende a salir algo más suave con GPT; y las
  instrucciones de "no des consejos genéricos" o "no uses tablas" las
  cumplen los dos, pero no con la misma disciplina.
- **La longitud.** "Dos o tres párrafos como mucho" se respeta peor. Si te
  salen respuestas largas, el sitio para ajustarlo es `text.verbosity` en
  el adaptador, no el prompt.
- **Los campos opcionales del JSON.** En modo estricto OpenAI no admite
  propiedades opcionales, así que el adaptador las convierte en
  obligatorias-pero-anulables. En la práctica: la `cita` de una omisión
  llega como `null` en vez de no llegar. La interfaz ya lo trataba igual.
- **Las restricciones numéricas del esquema** (la cobertura de 0 a 100)
  dejan de ir como esquema y van dichas en la descripción. Un valor fuera
  de rango es improbable pero ya no es imposible.
- **El tope de tokens incluye el razonamiento.** Con un modelo muy
  razonador y los topes actuales (8.000 para los análisis, 16.000 para
  chat, plan y dictamen), una respuesta puede agotarse razonando; eso sale
  como un error legible, no como un JSON vacío.
- **La caché.** En Anthropic la marcamos con `cache_control`; en OpenAI es
  automática para prefijos largos. En los dos casos por eso los system
  prompts no llevan fechas ni ids.
- **El precio y la velocidad** son otros. Ver la tabla de modelos de cada
  casa antes de dejar `OPENAI_MODEL` en su valor por defecto.

Lo que **no** cambia: el flujo, las rutas, la forma del JSON que se guarda
junto a cada cante, la degradación sin clave y el centinela de fin de
respuesta del chat.

---

## Principio: un preparador, no un chatbot

La diferencia entre esta app y pegar tus dudas en un chat genérico es la
**ficha del opositor**. En cada llamada el modelo recibe el estado real de
este usuario, así que responde con sus temas y sus números.

Si te pregunta *"¿qué estudio esta semana?"*, no puede contestar "organiza tu
tiempo": tiene delante que lleva 11 días sin tocar Hipotecario, que el tema 47
lleva 9 horas con nota media 4,5 y que su ritmo no llega a la convocatoria.

---

## La ficha (`lib/ai/contexto.ts`)

`construirFicha()` genera un documento en **texto plano** (no JSON: ocupa la
mitad de tokens y el modelo lo lee mejor) con:

- Perfil: nombre, oposición, fecha de inicio, examen objetivo, preparador,
  objetivo semanal y minutos de tribunal por tema.
- Estado del programa: recuento por estado, avance ponderado, horas totales,
  semanales y de hoy, racha, número de cantes y nota media.
- Ritmo proyectado y si llega o no a la fecha de examen.
- Avance, horas y nota por materia, ordenado de peor a mejor.
- Temas pasados de su fecha de repaso, con días sin tocar.
- Temas con muchas horas y mala nota (el aviso de método).
- Epígrafes que falla de forma recurrente, agregados de todos los cantes.
- Los últimos seis cantes con duración, nota y feedback.

Si el usuario no tiene temas de alta, la ficha lo dice explícitamente para que
el modelo no invente contexto.

`construirDetalleCante()` añade, para el análisis individual: desglose por
epígrafe con tiempos y fallos marcados en vivo, y los cinco cantes anteriores
del mismo tema para que haya comparativa real.

---

## Dónde va la ficha: en el mensaje, nunca en el system prompt

```ts
system: [{ type: "text", text: sistemaChat(estilo), cache_control: { type: "ephemeral" } }]
messages: [...historial, { role: "user", content: `<ficha_del_opositor>…</ficha_del_opositor>\n\n${pregunta}` }]
```

Los system prompts (`lib/ai/prompts.ts`) son **deliberadamente estables**: no
llevan fechas, ni ids, ni nada que cambie entre llamadas. Así el prefijo se
cachea y solo la ficha —que cambia en cada turno— paga tokens completos.

Meter la ficha en el system prompt invalidaría la caché en cada mensaje.

---

## Los endpoints

| Ruta | Modo | Salida |
|---|---|---|
| `POST /api/ai/analisis-cante` | no streaming | JSON estructurado |
| `POST /api/ai/comparar-cante` | no streaming | JSON estructurado |
| `POST /api/ai/transcribir` | no streaming | `{ transcripcion }` · **otro endpoint** |
| `POST /api/ai/chat` | **streaming** | `text/plain` en chunks |
| `POST /api/ai/plan` | no streaming | texto |
| `POST /api/ai/keypoints` | no streaming | JSON estructurado |
| `POST /api/ai/dictamen` | no streaming | texto |
| `GET /api/ai/estado` | — | `{ disponible, proveedor, modelo, transcripcion, motorTranscripcion, requiereSesion, sesion }` |

### Quién puede llamar (`lib/ai/guardia.ts`)

Cada llamada de esas cuesta dinero de verdad: tokens de Anthropic y, en
`/transcribir`, minutos del proveedor de audio. Hasta ahora lo único que
había delante era CORS, y **CORS no protege un endpoint**: solo le dice al
navegador de otra pestaña que no lea la respuesta. Un `curl` al dominio de
Railway no manda `Origin` y entraba sin más.

La regla es la misma degradación gradual que usa el resto de la app:

> **Si el servidor que atiende la IA tiene Supabase configurado, sus rutas
> exigen sesión válida. Si no lo tiene, siguen abiertas.**

Así el desarrollo en local y el despliegue de un solo opositor —que no
montan Supabase— funcionan exactamente igual que antes, sin muro ninguno.

- La comprobación es de verdad: `usuarioDePeticion()` (`lib/supabase/ruta.ts`)
  verifica la **firma** del JWT con `getClaims()`, no lo decodifica y se fía.
- La credencial viaja en la cabecera `Authorization: Bearer <access_token>`,
  porque estas llamadas salen a **otro dominio** (Netlify → Railway) y ahí el
  navegador no manda las cookies de sesión. En el navegador la pone
  `llamarIA()`/`pedirIA()` (`lib/ai/hooks.ts`), que son la única puerta por
  la que se llama a `/api/ai/*`; ninguna pantalla hace `fetch` por su cuenta.
- Sin sesión se responde **401** con `{ error: "sin_sesion" }` **antes de
  leer el cuerpo**: no se gasta un céntimo. La respuesta lleva sus cabeceras
  CORS, o el navegador la bloquearía y el opositor vería un error de red
  opaco en vez del mensaje.
- `GET /api/ai/estado` es la **única** que sigue abierta, a propósito: no
  gasta dinero, la interfaz la necesita justo para saber que hace falta
  iniciar sesión, y es el healthcheck de Railway (`railway.json`), que no
  tiene credenciales. Publica `requiereSesion` (este servidor pide sesión) y
  `sesion` (además, la credencial que ha llegado vale aquí). Lo segundo
  delata el caso feo de que la web y la API apunten a proyectos de Supabase
  distintos.

En la interfaz, `useIA()` deriva de eso dos banderas: `bloqueado` (hace falta
sesión y no la hay) y `listo` (hay clave y, si hace falta, sesión). Los
botones miran `listo`, y `AvisoIA`/`NotaIA` (`components/AvisoIA.tsx`) dicen
en español cuál de los dos motivos es y ofrecen el enlace de entrar. Nada
queda pulsable para fallar después.

### Lo que esto NO protege

Conviene decirlo claro, porque es fácil leer "autenticación" y entender
"seguro":

- **No hay límite de gasto por usuario.** Cualquiera con cuenta en el
  proyecto de Supabase puede llamar tantas veces como quiera, y el importe lo
  paga quien despliega. Si algún día se abren registros al público hará falta
  además un contador por usuario y por ventana de tiempo (y, probablemente,
  cortar el registro abierto en Supabase).
- **No hay límite por IP ni protección anti-abuso** más allá de exigir una
  sesión.
- **No cambia quién ve qué datos**: eso lo siguen decidiendo las políticas
  RLS de Supabase (`db/schema.sql`).
- **Sin Supabase configurado no protege nada**, por diseño. Un despliegue
  público con `ANTHROPIC_API_KEY` y sin Supabase tiene las rutas abiertas al
  que sepa la URL, igual que antes. Si el despliegue es público, configura
  Supabase.

### Salida estructurada

El análisis de cante, la comparación y los keypoints piden JSON Schema de
verdad, no "devuélveme JSON" en el prompt. La forma está garantizada, se
puede tipar y se guarda tal cual junto al cante para pintarla como tarjeta.

Cada API lo pide a su manera, y de eso se encarga el adaptador:

| | Anthropic | OpenAI |
|---|---|---|
| Dónde va | `output_config.format` | `text.format` |
| Nombre del esquema | no lleva | obligatorio (`name`) |
| Campos opcionales | se admiten | **no**: hay que ponerlos en `required` y hacerlos anulables |
| `minimum`/`maximum`, `minItems`… | se admiten | mejor no mandarlos |

La traducción está en `lib/ai/proveedores/esquema.ts`, con el porqué de cada
regla escrito ahí. La decisión discutible es la última: sobre si OpenAI
acepta hoy las restricciones numéricas hay documentación contradictoria, y
entre "si sobran, la petición falla entera con un 400" y "si faltan, se
pierde una garantía sobre un número", se ha elegido quitarlas y volcarlas
al `description`, que el modelo sí lee.

### Streaming en el chat

El chat pide `conversacion()` al proveedor y reenvía los trozos de texto
por un `ReadableStream`. Los eventos de los que salen esos trozos no son
los mismos —`content_block_delta`/`text_delta` en Anthropic,
`response.output_text.delta` en OpenAI— pero eso se queda en el adaptador.
`cancel()` aborta la llamada al modelo cuando el usuario cierra la pestaña
o pulsa parar: no se sigue pagando por tokens que nadie va a leer.

El centinela de fin de respuesta (`lib/ai/protocolo.ts`) es el mismo con
los dos proveedores, y se emite solo cuando el flujo ha terminado bien.

---

## Audio: qué acepta de verdad la API de Anthropic

**No acepta audio.** Esto se comprobó contra la documentación antes de
escribir una línea de la transcripción, y conviene dejarlo escrito porque es
justo la clase de cosa que uno da por hecha:

- Los bloques de contenido de la Messages API son `text`, `image`
  (`image/jpeg`, `image/png`, `image/gif`, `image/webp`), `document`
  (`application/pdf` y `text/plain`), `search_result`, `thinking`,
  `tool_use`/`tool_result` y `container_upload`. **No hay bloque de audio**,
  ni `media_type` de audio en ninguna fuente.
- La Files API admite esos mismos tipos (PDF → `document`, imágenes →
  `image`) y datasets para el *code execution tool* (`container_upload`).
  Los únicos audios que aparecen en su documentación son ficheros que el
  modelo **genera** dentro del sandbox y se descargan después, no entradas.
- No existe ningún endpoint de transcripción en la API.

Mandar un `webm` en base64 disfrazado de `document` no funciona: la petición
se rechaza. Y fingir que sí para "cumplir" habría sido peor que no hacerlo.

**Con OpenAI la foto cambia a medias.** OpenAI sí tiene transcripción, pero
en **otro endpoint** (`POST /audio/transcriptions`), no en la Responses API
que usa el adaptador de texto. Así que el reparto sigue siendo exactamente
el mismo; lo único que cambia es que, si ya hay `OPENAI_API_KEY`, **no hace
falta configurar una segunda clave**: `lib/ai/transcripcion.ts` la hereda y
llama a Whisper con ella.

Con un matiz que importa y que está escrito en el código: la clave heredada
**solo** se manda si `TRANSCRIPCION_URL` está vacía. Si el opositor apunta la
transcripción a Groq o a un `whisper.cpp` de su casa, ahí no viaja su clave
de OpenAI —una credencial solo va al servicio que la emitió— y tiene que
poner `TRANSCRIPCION_API_KEY`.

### Qué se ha hecho en su lugar

Se parte en dos, cada mitad donde aporta:

1. **Transcribir** (audio → texto) lo hace un servicio compatible con el
   dialecto `POST /audio/transcriptions` de OpenAI: `lib/ai/transcripcion.ts`
   y la ruta `/api/ai/transcribir`. Ese dialecto lo hablan OpenAI (Whisper),
   Groq (`whisper-large-v3`), faster-whisper y `whisper.cpp` servido en
   local, así que el opositor puede elegir proveedor —o no salir de su
   máquina— cambiando `TRANSCRIPCION_URL`. Se le manda una **pista** con el
   título del tema y sus epígrafes: sin ella el transcriptor destroza los
   tecnicismos jurídicos, y lo que escribe mal se cuenta luego como una
   laguna que nunca existió.
2. **Comparar** (texto contra texto) lo hace Claude, en
   `/api/ai/comparar-cante`, con salida estructurada. Aquí sí aporta: recibe
   el texto del tema por epígrafes, el guion cronometrado del cante y la
   transcripción, y devuelve qué se saltó, con la cita literal del temario
   que lo respalda.

Alternativa descartada: **Web Speech API** en el navegador. Es gratis y no
necesita proveedor, pero (a) solo la implementan de verdad Chrome y Safari,
(b) en Chrome manda el audio a los servidores de Google igualmente, (c)
solo transcribe en directo, así que habría que escuchar **durante** el
cante —un segundo consumidor del micrófono y un reconocedor que se corta
cada pocos segundos y hay que reiniciar—, y la regla del modo cante es que
nada puede estorbar al cante. Queda anotada por si algún día interesa como
respaldo sin clave.

### Sin proveedor de transcripción

Se graba, se guarda y se reproduce igual. Los botones de transcribir y
comparar salen apagados con el motivo escrito: hace falta un proveedor
compatible con Whisper, y con `OPENAI_API_KEY` ya vale. Es la misma
degradación honesta que el resto de la app sin clave de IA.

---

## El tono

Tres estilos (`directo`, `equilibrado`, `amable`) que cambian un párrafo del
system prompt. Se elige en Ajustes. Cada estilo genera un prefijo distinto pero
estable, así que cada uno tiene su propia caché.

El estilo por defecto es `directo`: un preparador de notarías con quince
opositores y cuarenta minutos no da rodeos.

---

## Reglas que el prompt impone al modelo

- Español de España, tuteando.
- Concreto: nombra el epígrafe, el artículo, el minuto. Prohibido "repasa más".
- Distingue falta de horas (cantidad) de mal método (calidad).
- Prioriza: si hay cinco cosas mal, dice cuál primero y por qué.
- **No inventa datos**: si la ficha no da para una afirmación, lo dice.
- **No cita preceptos como verdad verificada**: avisa de que se contraste con
  el temario. Un artículo mal citado en una oposición se paga caro.
- El foco de la próxima sesión es **una sola cosa**, ejecutable hoy.

---

## Privacidad

- La clave vive solo en el servidor (`ANTHROPIC_API_KEY` u `OPENAI_API_KEY`).
  Nunca llega al navegador: los ficheros que las leen importan `server-only`,
  así que el build falla si alguien los arrastra al cliente.
- Con OpenAI se manda `store: false`, para que las respuestas no se queden
  guardadas 30 días en su lado, que es lo que hace la Responses API por
  defecto.
- Se envía la ficha descrita arriba. **No** se envía el texto completo de los
  temas, salvo cuando el usuario pide expresamente extraer keypoints de un tema,
  corregir un dictamen o comparar un cante con el texto del tema.
- El **audio** solo sale del navegador si el opositor pulsa "Transcribir", y va
  al proveedor de transcripción configurado, que puede ser su propia máquina.
  La grabación se guarda siempre en local; a Supabase sube únicamente si hay
  sesión iniciada, a un bucket privado donde cada uno solo ve su carpeta.
- Sin clave, no sale nada del navegador y la app funciona entera menos estas
  cinco funciones, que lo avisan en pantalla.
- Si la instalación tiene Supabase, las rutas de IA solo atienden a quien ha
  iniciado sesión, y el servidor sabe **quién** llama (el `sub` del token).
  No se guarda registro de las llamadas: se usa para dejar pasar, nada más.

---

## Errores

`lib/ai/proveedor.ts` centraliza el manejo, y vale para los dos proveedores
porque los dos SDK traen `status` y `message` en sus errores:

- Sin sesión, cuando la instalación la exige → `401` con
  `{ error: "sin_sesion" }`, antes de tocar nada.
- Sin clave → `503` con `{ error: "sin_clave" }` y el mensaje de cómo
  configurarla, nombrando la variable que falta.
- `IA_PROVEEDOR` desconocido → `500` con `{ error: "proveedor_desconocido" }`.
- `401` → "la clave no es válida". `429` → "prueba en unos segundos".
- Rechazo del modelo → `422` con mensaje claro en vez de un JSON vacío. Con
  contenido jurídico es improbable, pero se contempla. Cada proveedor lo
  señala a su manera (`stop_reason: "refusal"` en Anthropic, un bloque de
  contenido `refusal` en OpenAI) y el adaptador lo normaliza.
- Con OpenAI, una respuesta `incomplete` por tope de tokens agotado
  razonando → `502` diciéndolo con esas palabras, no un JSON vacío.
- Si el modelo devuelve JSON inválido → `502` con el texto crudo para depurar.

## Nota sobre `fallbacks` (solo Anthropic)

La guía recomienda activar el parámetro `fallbacks` de servidor en llamadas a
`claude-opus-5`. La versión del SDK que usamos (`@anthropic-ai/sdk@0.72.1`) aún
no expone ese parámetro, así que en su lugar se comprueba `stop_reason` y se
devuelve un error legible. Cuando se actualice el SDK, es un añadido de dos
líneas en `lib/ai/proveedores/anthropic.ts`.

---

## Cómo se prueba esto sin claves

`pruebas/ia-proveedor.mjs` levanta dos servidores de mentira en localhost
—uno que habla la Responses API de OpenAI y el dialecto
`/audio/transcriptions`, otro que habla la Messages API de Anthropic—,
apunta los SDK a ellos con `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` y
ejecuta los manejadores **reales** de las rutas:

```
npm run prueba:ia
```

Comprueba las dos direcciones: que la petición que sale tiene la forma de
cada API (esquema traducido, `store: false`, el system prompt en su sitio,
el tope con su nombre) y que lo que entra es lo esperado (streaming entero
con su centinela, JSON validado contra el esquema que pidió la ruta,
transcripción). Y la degradación: sin clave, 503; con `IA_PROVEEDOR` mal
escrito, 500 explicado.

Lo que esa prueba **no** demuestra: que OpenAI y Anthropic acepten de verdad
estas peticiones. Eso solo lo dice una clave real contra el servicio real.

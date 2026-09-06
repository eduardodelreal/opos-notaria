# Las funciones de IA

Cómo está montada la capa de IA, qué se envía y por qué se ha decidido así.
Todo el código relevante está en `lib/ai/*` y `app/api/ai/*`.

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
| `POST /api/ai/analisis-cante` | no streaming | JSON estructurado (`output_config.format`) |
| `POST /api/ai/comparar-cante` | no streaming | JSON estructurado |
| `POST /api/ai/transcribir` | no streaming | `{ transcripcion }` · **no es Anthropic** |
| `POST /api/ai/chat` | **streaming** | `text/plain` en chunks |
| `POST /api/ai/plan` | no streaming | texto |
| `POST /api/ai/keypoints` | no streaming | JSON estructurado |
| `POST /api/ai/dictamen` | no streaming | texto |
| `GET /api/ai/estado` | — | `{ disponible, modelo, transcripcion, motorTranscripcion }` |

### Salida estructurada

El análisis de cante y los keypoints usan `output_config.format` con JSON
Schema, no "devuélveme JSON" en el prompt. La forma está garantizada, se puede
tipar y se guarda tal cual junto al cante para pintarla como tarjeta.

### Streaming en el chat

El chat usa `client.messages.stream()` y reenvía los `text_delta` por un
`ReadableStream`. `cancel()` aborta la llamada al modelo cuando el usuario
cierra la pestaña o pulsa parar: no se sigue pagando por tokens que nadie va
a leer.

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
comparar salen apagados con el motivo escrito: *"la API de Anthropic no
acepta audio; hace falta un proveedor compatible con Whisper"*. Es la misma
degradación honesta que el resto de la app sin `ANTHROPIC_API_KEY`.

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

- La clave vive solo en el servidor (`ANTHROPIC_API_KEY`). Nunca llega al
  navegador.
- Se envía la ficha descrita arriba. **No** se envía el texto completo de los
  temas, salvo cuando el usuario pide expresamente extraer keypoints de un tema,
  corregir un dictamen o comparar un cante con el texto del tema.
- El **audio** solo sale del navegador si el opositor pulsa "Transcribir", y va
  al proveedor de transcripción configurado, que puede ser su propia máquina.
  La grabación se guarda siempre en local; a Supabase sube únicamente si hay
  sesión iniciada, a un bucket privado donde cada uno solo ve su carpeta.
- Sin clave, no sale nada del navegador y la app funciona entera menos estas
  cinco funciones, que lo avisan en pantalla.

---

## Errores

`lib/ai/client.ts` centraliza el manejo:

- Sin clave → `503` con mensaje explicando cómo configurarla.
- `401` → "la clave no es válida". `429` → "prueba en unos segundos".
- `stop_reason === "refusal"` → mensaje claro en vez de un JSON vacío. Con
  contenido jurídico es improbable, pero se contempla.
- Si el modelo devuelve JSON inválido → `502` con el texto crudo para depurar.

## Nota sobre `fallbacks`

La guía recomienda activar el parámetro `fallbacks` de servidor en llamadas a
`claude-opus-5`. La versión del SDK que usamos (`@anthropic-ai/sdk@0.72.1`) aún
no expone ese parámetro, así que en su lugar se comprueba `stop_reason` y se
devuelve un error legible. Cuando se actualice el SDK, es un añadido de dos
líneas en `lib/ai/client.ts`.

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

## Los cinco endpoints

| Ruta | Modo | Salida |
|---|---|---|
| `POST /api/ai/analisis-cante` | no streaming | JSON estructurado (`output_config.format`) |
| `POST /api/ai/chat` | **streaming** | `text/plain` en chunks |
| `POST /api/ai/plan` | no streaming | texto |
| `POST /api/ai/keypoints` | no streaming | JSON estructurado |
| `POST /api/ai/dictamen` | no streaming | texto |
| `GET /api/ai/estado` | — | `{ disponible, modelo }` |

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
  temas, salvo cuando el usuario pide expresamente extraer keypoints de un tema
  o corregir un dictamen.
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

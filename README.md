# opos-notaria

Aplicación web para **preparar la oposición a Notarías**: programa, cantes cronometrados epígrafe a epígrafe, repaso espaciado, simulacros y un preparador con IA que analiza tus cantes y habla contigo con tus datos delante.

Funciona **sin configurar nada**: `pnpm install && pnpm dev`. Todo se guarda en tu navegador. La IA es opcional y se activa poniendo una clave.

---

## Índice

1. [Qué hace](#qué-hace)
2. [Arrancar en local](#arrancar-en-local)
3. [Cómo se usa](#cómo-se-usa)
4. [Las funciones de IA](#las-funciones-de-ia)
5. [Arquitectura](#arquitectura)
6. [Modelo de datos](#modelo-de-datos)
7. [Estructura del repo](#estructura-del-repo)
8. [Estado y siguientes pasos](#estado-y-siguientes-pasos)
9. [Convenciones](#convenciones)

---

## Qué hace

### Programa

- **Los temas los das de alta tú.** No hay programa precargado: cada convocatoria y cada preparador tienen su lista.
- **Importación masiva**: pegas el programa entero (una línea por tema) y lo trocea. Reconoce `1.`, `12 `, `Tema 3.—`, `8)` y respeta tus números; lo que no venga numerado se numera correlativamente.
- **Materias editables**: vienen las cinco clásicas de Notarías (Civil, Mercantil, Hipotecario, Fiscal, Notarial) como punto de partida — renómbralas, cámbiales el color, bórralas o añade las tuyas.
- **Autoparser de epígrafes**: pegas el texto de un tema y detecta cómo lo numeras (`I.`, `1.`, `a)`, guiones) para trocearlo. Si no encuentra estructura fiable lo dice, en vez de inventarse un troceado.
- **El Mural**: una celda por tema, coloreada por su estado real de hoy. De un vistazo sabes dónde estás.

### Estados

`Sin empezar` → `Estudiando` → `Cantable` → `Dominado`, y **`Oxidado`** automático: un tema dominado que lleva más de N días sin tocarse se pinta en rojo aunque en base de datos siga dominado. El mural no miente.

### Cronos

- Estudio, repaso y cante se miden por separado — son métricas distintas.
- **Horas efectivas**: se auto-pausa tras 6 minutos sin actividad. Las horas que cuenta esta app son horas reales, no horas de silla.
- Cronómetro flotante que sigue contando navegues donde navegues, y que **sobrevive a recargas** (se recalcula desde los timestamps, no desde un contador en memoria).
- Bloques libres o de 25/50/90 min, objetivo semanal, racha y mapa de calor tipo GitHub.

### Cantes

El corazón del producto.

- **Modo cante a pantalla completa**: fondo limpio, crono grande, solo el título del epígrafe que estás cantando y el siguiente en gris.
- `Espacio` avanza y cierra el tiempo del epígrafe anterior. `1-4` marcan **laguna, titubeo, orden o dato erróneo** sin romper el ritmo. `Esc` termina.
- Barra de tiempo contra el objetivo del tribunal, que se pone roja al pasarse.
- Al terminar: resumen con desglose por epígrafe **comparado contra tu cante anterior del mismo tema** (barra gris debajo), nota 0-10, si fue con preparador y su feedback.
- Historial por tema con la evolución de la nota.

**Graba el cante y te dice qué te saltaste.** Opcional y desactivable: el permiso del micrófono se pide antes de empezar, nunca a media recitación, y si no hay micrófono el cante va exactamente igual. La grabación se guarda en este dispositivo (IndexedDB), se reproduce con capítulos por epígrafe y, si tienes cuenta, sube sola a un bucket privado cuando haya red. Con un servicio de transcripción configurado se transcribe, y entonces viene lo que no tiene nadie: **la comparación con el texto de tu tema**, que te dice qué artículo no citaste, qué requisito de la lista te comiste y qué epígrafe recitaste a medias, **con la cita literal de tu temario que lo respalda**.

### Repaso espaciado

No es Anki: **la unidad es el tema**, no la carta. El intervalo sale de cuatro variables reales —estado, dificultad que tú declaras, nota media de cante y vueltas dadas—, así que un tema dominado con nota 9 y cuatro vueltas aguanta cinco semanas y uno cantable con un 5 vuelve en menos de una.

Además, **keypoints**: los datos sueltos que se caen en el cante (artículos, plazos, listas de requisitos) con su propio drill y su SM-2 simplificado.

### Simulacros

- **Bombo de cante**: sorteo real de N temas. Puedes excluir lo cantado en los últimos 14 días y **cargar el bombo hacia tus temas flojos** (más papeletas para oxidados y notas bajas). Luego pones nota tema a tema.
- **Dictamen**: supuesto propio o generado por IA, reloj de 4 h y corrección con la rúbrica del ejercicio.

### Estadísticas

Horas totales y por semana, avance ponderado del programa, radar de esfuerzo por materia, evolución de la nota de cante, mapa de calor anual y dos avisos que valen por todo el resto:

- **Temas donde el problema es el método**: horas por encima de tu media sin que la nota suba. No es falta de tiempo.
- **Epígrafes que fallas una y otra vez**, agregados de todos tus cantes.

Y una **proyección honesta**: a tu ritmo de las últimas 8 semanas, cuántas semanas te quedan y si llegas a la fecha de examen que hayas fijado.

### La app a tu gusto

Vas a pasar años delante de esta pantalla, así que se ajusta. Todo desde
**Ajustes → Apariencia**, con vista previa: el cambio se aplica al instante, no
hay que guardar y adivinar.

- **Fondo**: oscuro, claro o **sepia** (papel cálido, para leer temas durante horas).
- **Acento**: lacre, tinta, jade, cárdeno, cobre o **el color que quieras**. El
  latón dorado no se toca: es lo que hace que siga siendo la misma app. Si el
  color libre no se lee sobre el fondo, la app **le corrige la luminosidad y te
  lo dice**; ninguna combinación elegible deja texto ilegible.
- **Texto de los temas**: serif o sans, y el cuerpo de 15 a 24 px. Solo cambia
  el texto que estudias; la interfaz se queda como está.
- **Densidad**: normal o compacta.
- **Orden de los temas**: por número, estado, urgencia de repaso, tiempo
  invertido o nota de cante. Vale en el programa, el cante, el crono y el repaso.
- **Orden de las materias**: con las flechas de Programa → Materias.

Todo esto vive en tu perfil, así que **viaja entre dispositivos** como el resto
del expediente. Y los valores por defecto son la app de siempre: quien no toca
nada, no nota nada.

---

## Arrancar en local

Requisitos: **Node 20+**.

```bash
git clone https://github.com/eduardodelreal/opos-notaria.git
cd opos-notaria
pnpm install          # o npm install
pnpm dev              # http://localhost:3000
```

Ya está. No hace falta base de datos ni cuenta de nada.

### Activar la IA (opcional)

```bash
cp .env.example .env.local
# pon UNA de las dos claves:
#   ANTHROPIC_API_KEY=sk-ant-...   (https://console.anthropic.com)
#   OPENAI_API_KEY=sk-...          (https://platform.openai.com)
# con las dos puestas manda IA_PROVEEDOR; ver docs/ia.md
pnpm dev
```

Sin clave la app funciona **entera**; solo se apagan los botones de IA, que lo avisan en pantalla en vez de fallar.

Para transcribir los cantes hace falta **otro** proveedor, porque la API de
Anthropic no acepta audio (el porqué, con la comprobación, en
[docs/ia.md](docs/ia.md)). Se configura con `TRANSCRIPCION_API_KEY` y, si no
usas OpenAI, `TRANSCRIPCION_URL` y `TRANSCRIPCION_MODELO`. Sin eso se graba,
se guarda y se escucha igual.

```bash
pnpm build      # build de producción
pnpm typecheck  # tsc --noEmit
```

---

## Cómo se usa

1. **Programa → Añadir temas.** Elige materia, pega tu lista, revisa la previsualización, importa.
2. **Abre un tema → Pegar tema y trocear.** Pega el texto y quedan los epígrafes con su texto y su tiempo estimado de cante.
3. **Cantar.** Espacio para avanzar, 1-4 para marcar fallos. Al final, nota y feedback.
4. **Panel.** Cada mañana te dice qué urge repasar y si estás sobre-invirtiendo en un tema que no mejora.

---

## Las funciones de IA

Todas viven en `app/api/ai/*` y llaman a la API de Anthropic **desde el servidor** (la clave nunca llega al navegador). Modelo por defecto: `claude-opus-5`.

| Función | Qué hace | Ruta |
|---|---|---|
| **Análisis de cante** | Compara el cante con los anteriores del mismo tema y con tu ficha completa. Devuelve titular, diagnóstico, fortalezas, mejoras priorizadas, epígrafes críticos y **una sola cosa** en la que centrar la próxima sesión. Salida estructurada, se guarda junto al cante. | `/api/ai/analisis-cante` |
| **Chat con el preparador** | Conversación en streaming. En cada mensaje recibe tu ficha actualizada, así que responde con tus temas y tus números, no con generalidades. | `/api/ai/chat` |
| **Plan semanal** | Reparte la semana entre temas nuevos, repaso y cante, partiendo de las horas que **realmente** haces. | `/api/ai/plan` |
| **Keypoints** | Extrae datos memorizables del texto de un tema. Se revisan antes de guardar; solo trabaja con el texto que le das. | `/api/ai/keypoints` |
| **Dictamen** | Genera supuestos y corrige el tuyo con rúbrica de 5 apartados. | `/api/ai/dictamen` |
| **Comparación del cante con el tema** | Recibe la transcripción de lo que dijiste y el texto de tus epígrafes, y devuelve **qué te saltaste**: artículos no citados, requisitos que faltan, epígrafes incompletos, cada uno con la cita literal del temario. Salida estructurada, se guarda junto al cante. | `/api/ai/comparar-cante` |
| **Transcripción del cante** | **No es Anthropic**: su API no acepta audio. Va a un servicio compatible con Whisper que configuras tú (OpenAI, Groq o `whisper.cpp` en tu propia máquina). Sin él, grabar y escuchar el cante funciona igual. Ver [docs/ia.md](docs/ia.md). | `/api/ai/transcribir` |

### Personalización

La **ficha del opositor** (`lib/ai/contexto.ts`) es lo que convierte esto en un preparador y no en un chatbot. En cada llamada se manda tu estado real: temas y estados, horas totales y semanales, racha, avance por materia, temas pasados de fecha de repaso, temas con muchas horas y mala nota, epígrafes que fallas de forma recurrente, últimos cantes y ritmo proyectado.

Se manda como texto en el **mensaje de usuario**, nunca en el system prompt: así el prefijo (system + historial) se mantiene cacheado entre turnos y solo la ficha paga tokens completos.

El **tono** se ajusta en Ajustes (`directo` / `equilibrado` / `amable`) y cambia el system prompt.

### Qué se envía

Se envía la ficha descrita arriba. **No** se envía el texto completo de tus temas, salvo cuando pides expresamente extraer keypoints de un tema o corregir un dictamen. Sin clave, no sale nada de tu navegador.

---

## Arquitectura

```
┌──────────────────────────────────────────┐
│  Next.js 15 (App Router) + React 19      │
│                                          │
│  UI (client) ──── Zustand ──── IndexedDB │  ← todo el estado vive aquí
│      │                                   │
│      └── fetch ──► /api/ai/* (server)    │
└───────────────────────┬──────────────────┘
                        │  clave de IA (solo servidor)
                        ▼
        Anthropic (claude-opus-5) u OpenAI (gpt-5.6-sol)
```

**Offline-first a propósito.** El opositor estudia en bibliotecas con wifi malo: si se pierde un cante, se pierde el usuario. Todo se escribe primero en IndexedDB y la app funciona entera sin red (salvo la IA). `db/schema.sql` tiene el esquema Postgres/Supabase con RLS listo para cuando toque sincronizar: la nube será una réplica, no la fuente de verdad.

Detalles que importan:

- **Sin librería de gráficas.** Los cinco gráficos son SVG a medida (`components/graficos.tsx`): el estilo es el de la app y no cargamos 90 kB para pintar barras.
- **Sin `next/font`.** Las fuentes se cargan por `<link>` con stack de respaldo, así el build no depende de que Google Fonts esté accesible.
- **Diseño por tokens CSS.** Los tres tonos (oscuro, claro y sepia) se cambian reescribiendo variables, no duplicando clases. La personalización del opositor es un puñado de variables más sobre `<html>`, calculadas en un único sitio (`lib/data/apariencia.ts`) y replicadas tal cual por el guion antiparpadeo del `head`.
- **La legibilidad no se negocia.** El acento libre pasa por una corrección de contraste WCAG medida de verdad (`lib/data/color.ts`): si no se lee sobre el fondo elegido, se le ajusta la luminosidad hasta que se lee.

---

## Modelo de datos

Definido en `lib/data/types.ts`. La decisión estructural es que **todo cuelga del epígrafe, no del tema**: los cantes, los fallos y los tiempos se agregan hacia arriba. Eso es lo que permite decir *"siempre fallas el epígrafe 3 del tema 47"* en vez de *"el tema 47 se te da mal"*.

| Entidad | Para qué |
|---|---|
| `Perfil` | Datos del opositor, objetivos y reglas (min/tema, días de óxido, tono de la IA). |
| `Materia`, `Tema`, `Epigrafe` | El programa, todo dado de alta por el usuario. |
| `ProgresoTema` | Estado, segundos, dificultad, vueltas, nota media, próximo repaso. |
| `Sesion` | Cada tramo cronometrado, con su tipo. |
| `Cante` | Desglose por epígrafe con tiempos y fallos, nota, feedback, análisis de IA y, si se grabó, la ficha del audio (el binario va aparte, en `lib/audio/`), su transcripción y la comparación con el texto del tema. |
| `KeyPoint` | Dato memorizable con su propio SRS. |
| `Nota`, `Simulacro`, `MensajeChat` | Notas libres, simulacros y el hilo del chat. |

Toda la lógica de repaso y estadística está en `lib/data/srs.ts`, aislada de la UI y sin dependencias.

---

## Estructura del repo

```
opos-notaria/
├── app/
│   ├── page.tsx              # Panel
│   ├── programa/             # Mural, alta e importación de temas
│   ├── tema/[id]/            # Ficha: epígrafes, cantes, keypoints, notas
│   ├── cante/                # Selector de tema
│   │   └── vivo/             # Modo cante a pantalla completa
│   ├── crono/  repaso/  simulacros/  estadisticas/  chat/  ajustes/
│   └── api/ai/               # analisis-cante, comparar-cante, transcribir,
│                             # chat, plan, keypoints, dictamen, estado
├── components/               # Shell, primitivos de UI, gráficos SVG, crono flotante
├── lib/
│   ├── data/                 # types, materias, parser de importación, srs,
│   │                         # apariencia + color (contraste WCAG medido)
│   ├── store/                # Zustand + persistencia IndexedDB
│   ├── ai/                   # cliente, prompts, ficha del opositor, hooks
│   ├── audio/                # grabadora, almacén de blobs y subida a Storage
│   ├── sync/                 # motor de sincronización (cola, fusión, transporte)
│   └── utils/                # tiempo e ids
├── db/schema.sql             # Postgres/Supabase con RLS
└── docs/
```

---

## Estado y siguientes pasos

**Hecho y funcionando**: programa e importación, mural, fichas de tema con epígrafes, cronos con horas efectivas, modo cante completo, **grabación del cante con transcripción y comparación contra el texto del tema**, repaso espaciado, keypoints, simulacros (bombo y dictamen), estadísticas, las funciones de IA, sincronización con Supabase, avisos, exportar/importar, claro y oscuro.

**Lo siguiente, por orden de valor:**

1. **Comparación por epígrafe con marcas de tiempo**, aprovechando los segmentos del transcriptor en vez de dejar que el modelo alinee por contenido.
2. **Modo preparador**: dashboard con sus opositores. Es el canal de adquisición real — ganas al preparador y te trae doce usuarios.
3. **App móvil** para cantar de paseo.

---

## Convenciones

- **Idioma**: la app y el código están en español; el público es 100% ES y el dominio es jurídico español, así que `cante`, `epigrafe` o `oxidado` son los nombres correctos también en el código.
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/).
- **Rama principal**: `main`. Trabajo en ramas y PR.
- **TypeScript estricto**, sin `any` en el dominio.

---

_Repo de [@eduardodelreal](https://github.com/eduardodelreal)._

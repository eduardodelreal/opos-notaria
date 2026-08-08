# Cante · app de estudio para la oposición a Notarías

Herramienta de precisión para opositores a Notarías: **cronometra los cantes, los
graba, calcula la nota combinando contenido y tiempo, decide qué toca repasar hoy y
convierte cinco años de estudio en números que se pueden leer.**

**La app arranca vacía.** No trae ningún programa impuesto: tú vas metiendo tus
materias, tus temas, tus tareas y tus horas según te los van dando en la academia.
Se construye contigo.

> Estado: **v0.2 funcional**. Cante con cronómetro y grabación, sistema de vueltas,
> temario propio (uno a uno o pegando la lista), calendario con tareas recurrentes,
> bombo virtual y métricas. Arranca sin backend en modo local.

---

## Índice

1. [Qué hace](#qué-hace)
2. [Por qué no es un Todoist con temas](#por-qué-no-es-un-todoist-con-temas)
3. [Stack](#stack)
4. [Arrancar en local](#arrancar-en-local)
5. [Desplegar](#desplegar)
6. [Usuario de prueba](#usuario-de-prueba)
7. [Modelo de datos](#modelo-de-datos)
8. [Cómo funciona el sistema de vueltas](#cómo-funciona-el-sistema-de-vueltas)
9. [Cómo se calcula la nota](#cómo-se-calcula-la-nota)
10. [Estructura del repo](#estructura-del-repo)
11. [Decisiones de producto](#decisiones-de-producto)

---

## Qué hace

### Hoy
El panel de la mañana. Cante neto del día, horas de estudio, ratio de cantes que
entran en el tiempo tasado, racha, la **cola de temas ordenada por riesgo de
examen**, tareas del día, estado del programa, previsión de carga a seis semanas y
mapa de constancia.

### Cantar
El módulo central. Tres modos: **tema único**, **tanda de bloque** o **simulacro**
(varios temas seguidos sacados del bombo).

- Cronómetro grande con el fondo cambiando de verde a ámbar (80% del tiempo) y a
  terracota (límite superado).
- **Grabación automática** en cuanto arranca el cronómetro, a 32 kbps mono
  (≈3 MB por cante de 12 minutos), vinculada al tema.
- **Modo ciego**: bloquea la pantalla para cantar paseando sin toques accidentales,
  manteniendo el cronómetro visible.
- Barra espaciadora para arrancar y parar; `B` para el modo ciego.
- Wake lock: la pantalla no se apaga mientras cantas.
- Al terminar: autocalificación de contenido (1–5), lagunas, si fue ante el
  preparador y notas. La nota final sale de combinar contenido y tiempo.

### Temario — el tuyo, construido a tu ritmo
Empieza vacío. Tres formas de llenarlo, y las tres son tuyas:

- **Pegar una lista**: copias el temario del PDF o del WhatsApp de la academia y lo
  pegas tal cual. El parser entiende `1.`, `Tema 2 -`, `3)`, viñetas y líneas sin
  numerar (esas las numera seguidas), e ignora cabeceras sueltas.
- **Uno a uno**, con `Ctrl+Enter` para guardar y dejar el cuadro listo para el
  siguiente: metes los cinco temas de esta semana sin tocar el ratón.
- **Plantilla opcional**: si prefieres partir del programa oficial completo (328
  temas), está en Ajustes. A partir de ahí es tuyo: edítalo, renumera o borra.

**Las materias también las creas tú** (Civil, Mercantil… o las que use tu
preparador), con su color y su ejercicio. Cada tema lleva estado, vueltas, nota
media, próxima revisión y horas acumuladas. Filtros por materia y estado, cinco
órdenes. Cada tema abre una ficha con su historial de cantes, reproductor de audio,
epígrafes, notas propias, registro de estudio y **botón para compartir el cante con
el preparador**.

### Calendario
Vista de mes, de semana y de series. **Tareas recurrentes de verdad**: diaria cada
N días, laborables, semanal en los días que elijas cada N semanas, mensual el día X
cada N meses, con fecha de fin opcional. Plantillas rápidas (cante diario, día de
preparador, dictamen semanal, simulacro mensual). Cada día muestra la carga
planificada frente a tu objetivo y los repasos que coloca el sistema de vueltas.

El **botón de pánico** reparte lo pendiente de un día entre los siguientes sin
pasarte del objetivo diario (first-fit decreasing).

### Métricas
Nota media, ratio en tiempo, duración media del cante frente al objetivo, evolución
de la nota y de la duración (media móvil de 5), horas por día, cantes por semana,
tabla de rendimiento por bloque, distribución de autocalificaciones, hitos,
simulacros y el **índice de preparación** con estimación de cuándo cierras la
primera vuelta al ritmo actual.

### Bombo
Sorteo animado con bolas. Configuras cuántas salen, si restringes a un bloque, si
solo entran temas ya tocados y si el sorteo se sesga hacia los temas flojos. Al
terminar, cantas los temas sorteados seguidos como simulacro.

### Ajustes
Tiempo objetivo por tema, temas por ejercicio, objetivos diarios, día de
preparador, agresividad del sistema de vueltas (con vista previa de los escalones),
umbral de oxidación, plantillas opcionales de programa y exportar/importar copia de
seguridad en JSON.

### Primer arranque
Tres pasos, todos saltables, menos de un minuto: cómo te llamas y qué oposición
preparas · tu ritmo (horas, cantes al día, minutos por tema) · las materias con las
que empiezas. Nada de tutorial de ocho pantallas.

---

## Por qué no es un Todoist con temas

Cinco decisiones que cambian todo:

1. **El programa lo pone el opositor, no la app.** Cada preparador numera y agrupa a
   su manera, y el temario llega a cuentagotas a lo largo de años. Un catálogo
   cerrado obligaría a pelearse con la herramienta desde el primer día.
2. **La unidad es el tema completo, no la flashcard.** El opositor recita 20 minutos
   seguidos con estructura y citas. Partirlo en tarjetas entrena una habilidad que no
   se examina.
3. **El tiempo es la mitad de la nota.** Un cante impecable en 19 minutos cuando el
   límite son 12 no es un 10: en el tribunal te cortan. La app lo penaliza.
4. **Los temas se oxidan solos.** Un tema dominado que llevas 80 días sin cantar
   pasa a `oxidado` sin que hagas nada, porque eso es lo que pasa en tu cabeza.
5. **Fallar no resetea.** Un tema de sexta vuelta que hoy sale flojo retrocede uno o
   dos escalones, no vuelve al día 1. El coste de un repaso es 12 minutos, no 8
   segundos.

La lista completa de lo que entra y lo que no, con los motivos, está en
[`docs/QUE-SI-QUE-NO.md`](docs/QUE-SI-QUE-NO.md).

---

## Stack

- **React 18 + TypeScript estricto + Vite** — SPA estática, sin servidor propio.
- **Tailwind CSS** con paleta clara propia (salvia, terracota apagada, oro viejo,
  papel cálido). Tipografías: Inter, Instrument Serif, JetBrains Mono.
- **Supabase** — Postgres con RLS, Auth por email y Storage privado para los audios.
- **Netlify** — build y hosting, con redirect SPA.
- **Cero dependencias de gráficos**: los anillos, barras, líneas, heatmaps y
  sparklines son SVG escrito a mano (`src/components/charts.tsx`). Bundle final
  ~163 kB gzip.
- **Sin backend, funciona igual**: si faltan las variables de Supabase la app
  arranca en modo local con `localStorage` + IndexedDB para los audios.

---

## Arrancar en local

```bash
npm install
npm run dev          # http://localhost:5173
```

Sin configurar nada, entra en **«modo local»** desde la pantalla de acceso: el
programa completo está precargado y puedes cantar un tema en 30 segundos. Todo se
guarda en este navegador.

Para conectar Supabase:

```bash
cp .env.example .env.local   # rellena VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev
```

Scripts:

```bash
npm run dev         # servidor de desarrollo
npm run build       # tsc -b && vite build  →  dist/
npm run preview     # sirve dist/ como en producción
npm run typecheck   # solo comprobación de tipos
```

---

## Desplegar

Guía completa paso a paso: **[`docs/DEPLOY.md`](docs/DEPLOY.md)**.

Resumen:

1. Proyecto en Supabase → SQL Editor → ejecuta
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
2. Netlify → importa el repo (lee `netlify.toml`, no hay que configurar el build).
3. Añade `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en las variables de entorno
   de Netlify y **relanza el deploy** (Vite las inyecta en tiempo de build).

---

## Usuario de prueba

```bash
SUPABASE_URL="https://xxxx.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="eyJ...service_role..." \
DEMO_EMAIL="tu@email.com" \
DEMO_PASSWORD="UnaClaveSegura123" \
node scripts/seed-demo.mjs
```

Crea el usuario con el email ya confirmado y **vacío**, que es como debe empezar la
app. Al entrar te pedirá cuatro datos en la pantalla de bienvenida y a partir de ahí
vas metiendo tus materias y tus temas.

- `DEMO=1` — además, siembra siete meses de estudio **ficticio** (~530 cantes, ~750 h,
  temas oxidados, tareas recurrentes, simulacros) para ver todas las pantallas
  llenas. Úsalo con **otro email**: no mezcles datos inventados con los reales.
- `RESET=1` — borra todos los datos previos de ese usuario antes de empezar.

> La `service_role key` salta RLS: úsala solo en tu terminal. Nunca en el repo ni en
> una variable de Netlify con prefijo `VITE_`.

---

## Modelo de datos

| Tabla | Contenido |
|---|---|
| `perfiles` | Un registro por usuario: `ajustes` (jsonb), días cumplidos, hitos. |
| `bloques` | Las materias que crea el usuario: nombre, color, ejercicio, orden. |
| `temas` | Los temas del usuario: materia, número, título, epígrafes. |
| `progreso` | Estado por usuario y tema: estado, vueltas, intervalo, facilidad, último cante, próxima revisión, nota media, minutos. |
| `cantes` | Cada sesión de cante: duración, objetivo vigente, calificación, nota, lagunas, si fue ante el preparador, ruta del audio. |
| `sesiones` | Estudio sin cantar: minutos y tipo (lectura, esquema, memorización, dictamen). |
| `tareas` | Tareas con `recurrencia` en jsonb y arrays de fechas completadas y saltadas. |
| `simulacros` | Ejercicios completos: temas sorteados, duración total, nota media. |

RLS activo en todas: la política es `auth.uid() = user_id`. Los audios viven en el
bucket privado `cantes`, en la carpeta `<user_id>/`, con políticas de Storage que
comprueban la primera carpeta de la ruta.

No hay catálogo global: **todo el contenido pertenece al usuario y vive en su
cuenta**. El programa oficial de Notarías existe solo como plantilla opcional en
[`src/data/plantillas.ts`](src/data/plantillas.ts), que no se aplica sola: se importa
desde Ajustes y a partir de ese momento los temas son suyos y editables.

---

## Cómo funciona el sistema de vueltas

Implementado en [`src/lib/srs.ts`](src/lib/srs.ts). Cinco diferencias deliberadas
frente a Anki:

1. **Escalones fijos**, no una curva continua: `1, 3, 7, 14, 25, 40, 60, 90, 130, 180`
   días. El opositor razona en vueltas y necesita previsibilidad para planificar.
2. **Fallar retrocede, no resetea.** Calificación 1 baja tres escalones, 2 baja dos,
   3 mantiene, 4–5 sube uno.
3. **Jitter determinista de ±12%** por tema, para que no se acumulen treinta
   vencimientos el mismo día.
4. **Tope por convocatoria** y techo absoluto de 210 días. Si el examen es en cinco
   meses, ningún intervalo se programa a ocho: todo tema cae al menos una vez más
   antes de la fecha. Y ningún tema pasa de siete meses sin cantarse, por dominado
   que esté.
5. **Oxidación.** Un tema `dominado` que pasa del umbral de días sin cantar (75 por
   defecto, configurable) se recalcula como `oxidado` en cada arranque.

La **cola del día** ordena los vencidos por un índice de riesgo 0–100 que combina
retraso sobre la fecha prevista, nota media del tema, número de vueltas y frescura,
y está topada por tu objetivo diario de cantes para que sea alcanzable. Solo sugiere
temas nuevos si el arrastre está bajo control.

---

## Cómo se calcula la nota

```
nota = contenido + ajuste_tiempo − penalización_lagunas
```

- **contenido**: autocalificación 1–5 → 0 / 2,5 / 5 / 7,5 / 10.
- **ajuste_tiempo**, sobre el ratio `duración / objetivo`:
  - dentro de la ventana **88%–105%** → **+0,3** (bonus por clavar el reloj);
  - por encima → **−0,9 por cada 10% de exceso**, hasta −3,5;
  - por debajo del 88% → **−0,8 por cada 10%**, hasta −4,5. Quedarse muy corto
    casi siempre significa epígrafes saltados, no eficiencia: un tema «perfecto»
    recitado en 3 de los 12 minutos sale con un 5,5, no con un 10.
- **lagunas**: −0,4 cada una, máximo −1,5.

Por eso «en tiempo» es una **ventana**, no «por debajo del límite»: un tema recitado
en 3 minutos cuando el objetivo son 12 no está en tiempo, está incompleto.

---

## Estructura del repo

```
opos-notaria/
├── src/
│   ├── data/plantillas.ts      # programa oficial como plantilla OPCIONAL
│   ├── lib/
│   │   ├── types.ts            # modelo de dominio
│   │   ├── bloques.ts          # materias del usuario, paleta y parser de listas
│   │   ├── srs.ts              # sistema de vueltas, riesgo, nota, oxidación
│   │   ├── recurrence.ts       # motor de recurrencia y botón de pánico
│   │   ├── audio.ts            # grabación, Storage/IndexedDB, enlace al preparador
│   │   ├── repo.ts             # LocalRepo | SupabaseRepo (misma interfaz)
│   │   ├── logros.ts           # hitos y nivel
│   │   ├── dates.ts            # fechas locales, sin desfase UTC
│   │   └── utils.ts
│   ├── store/AppStore.tsx      # estado global, auth y todas las mutaciones
│   ├── components/
│   │   ├── ui.tsx              # Card, Modal, Tabs, Toggle, Slider, Chip…
│   │   ├── charts.tsx          # Ring, Barras, Línea, Heatmap, Sparkline
│   │   └── Layout.tsx
│   └── pages/                  # Login, Bienvenida, Dashboard, Cante, Temario,
│                               # Calendario, Metricas, Bombo, Ajustes
├── supabase/migrations/        # esquema + RLS + bucket
├── scripts/seed-demo.mjs       # usuario de prueba con datos realistas
├── docs/
│   ├── QUE-SI-QUE-NO.md        # decisiones de producto
│   └── DEPLOY.md               # despliegue paso a paso
└── netlify.toml
```

---

## Decisiones de producto

- **Idioma**: la app es 100% en español y usa el vocabulario del opositor —cantar,
  vueltas, arrastre, oxidado, preparador, dictamen, bombo—. El código está en
  inglés donde es convención (`useMemo`, `props`) y en español en el dominio
  (`Cante`, `ProgresoTema`, `riesgo`), que es donde importa la claridad.
- **Tonos claros**: el opositor estudia de día en una mesa con flexo y usa la app en
  ráfagas de dos minutos entre cantes. Papel cálido, salvia, cero estridencia.
- **Nada de gamificación infantil**: los hitos van en números romanos y miden
  trabajo real. Un jurista que estudia 10 horas al día no quiere confeti.
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/).
- **Nada precargado**: la app no impone temario. La plantilla opcional del programa
  oficial procede de fuentes públicas (BOE) y, una vez cargada, es del usuario.

---

_Repo iniciado el 2026-08-07 por [@eduardodelreal](https://github.com/eduardodelreal)._

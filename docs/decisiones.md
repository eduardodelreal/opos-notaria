# Decisiones de producto y técnicas

Por qué la app es como es. Sirve para que nadie (nosotros dentro de seis meses
incluidos) deshaga por error algo que estaba pensado.

---

## Producto

### 1. Los temas los da de alta el usuario

No precargamos ningún programa. Cada convocatoria cambia la numeración, cada
preparador reparte distinto y hay opositores que trabajan con temarios propios.
Un programa "oficial" precargado sería falso la mitad de las veces y obligaría
al opositor a pelearse con nuestros números en vez de con los suyos.

A cambio, la importación tiene que ser **excelente**: pegar el programa entero y
que funcione. Ahí es donde ponemos el esfuerzo (`lib/data/parser.ts`).

Las **materias** sí vienen pre-rellenadas con las cinco clásicas de Notarías,
pero son editables y borrables: es un punto de partida, no una imposición.

### 2. Todo cuelga del epígrafe, no del tema

Es la decisión estructural más importante. Los tiempos y los fallos se registran
por epígrafe y se agregan hacia arriba.

Permite decir *"siempre fallas el epígrafe 3 del tema 47"* en vez de *"el tema 47
se te da mal"*. Lo primero es accionable esta tarde; lo segundo no sirve de nada.
Todo el valor del análisis por IA depende de esta granularidad.

### 3. Horas efectivas, no horas de silla

El cronómetro se auto-pausa a los 6 minutos sin actividad. Un opositor que se
miente sobre sus horas no puede planificar. La app existe para darle el número
honesto, aunque duela.

Por el mismo motivo el plan de la IA se construye sobre las horas que **hace**,
no sobre las que se propone.

### 4. El estado "oxidado" es automático

Un tema dominado que lleva más de N días sin tocarse se pinta en rojo, aunque en
base de datos siga marcado como dominado. El mural tiene que reflejar la verdad
de hoy, no la del día en que se marcó.

### 5. El SRS es de temas, no de tarjetas

Anki reparte cartas; aquí la unidad es el tema, porque el examen es cantar un
tema entero. El intervalo sale de cuatro variables reales: estado, dificultad
declarada, nota media de cante y vueltas dadas.

Los **keypoints** (artículos, plazos, listas) sí llevan un SM-2 clásico, porque
ahí sí la unidad es el dato.

### 6. Nunca se borra el histórico

Las sesiones no se pueden borrar desde la interfaz. Un histórico que se puede
maquillar no sirve para medir. Los cantes sí, porque un cante mal registrado
(crono olvidado corriendo) ensucia las medias.

### 7. La grabación del cante es un extra, nunca un requisito

Grabar el cante y compararlo con el texto del tema es lo que ningún
competidor tiene: le dice al opositor, negro sobre blanco, **qué se saltó
literalmente**, que es justo lo que no puede ver mientras canta.

Pero el cante manda sobre la grabación, no al revés. De ahí las reglas duras:

- El permiso del micrófono se pide **antes** de empezar. Un diálogo del
  navegador a media recitación arruina una toma de diez minutos que no se va
  a repetir.
- Durante el cante, ninguna operación de audio espera a nada: marcar un
  epígrafe es un `push` a un array.
- Si no hay micrófono, si el navegador no sabe grabar o si el opositor dice
  que no, el cante funciona **exactamente** igual que sin esta función. No
  hay una sola rama en la que la grabación impida cantar.
- La comparación no inventa: cada omisión va con la cita literal del temario
  que la respalda, y lo que huele a error del transcriptor no se cuenta como
  laguna. Decirle a alguien que se dejó un artículo que sí dijo es peor que
  no decirle nada.

---

## Técnicas

### Offline-first, IndexedDB primero

El opositor estudia en bibliotecas con wifi malo. Si se pierde un cante, se
pierde el usuario. Todo se escribe en local y la app funciona entera sin red
(salvo la IA).

`db/schema.sql` deja el Postgres listo con RLS, pero cuando llegue la
sincronización la nube será una **réplica**, no la fuente de verdad.

### El cronómetro se recalcula desde timestamps

`segundosCrono()` deriva de `desde` + `acumulado`, nunca de un contador que se
incrementa. Así una pestaña dormida, un móvil bloqueado o una recarga no pierden
ni ganan segundos.

### La ficha del opositor va en el mensaje, no en el system prompt

`lib/ai/contexto.ts` genera la ficha como **texto** (no JSON: ocupa la mitad y el
modelo lo lee mejor) y se adjunta al último mensaje de usuario.

Si fuera en el system prompt rompería la caché de prefijo en cada turno, porque
cambia constantemente. Así el prefijo (system + historial) se mantiene cacheado y
solo la ficha paga tokens completos.

### Selectores de Zustand: nunca derivar dentro del selector

```ts
// MAL: crea un array nuevo en cada render -> bucle infinito (React #185)
const mios = useStore((s) => s.cantes.filter((c) => c.temaId === id));

// BIEN
const cantes = useStore((s) => s.cantes);
const mios = useMemo(() => cantes.filter((c) => c.temaId === id), [cantes, id]);
```

Zustand v5 compara por identidad con `useSyncExternalStore`. Esto ya nos costó
una tarde: no lo repitamos.

### Sin librería de gráficas

Los cinco gráficos son SVG a medida (`components/graficos.tsx`). El estilo es el
de la app en vez del de Chart.js, y no cargamos 90 kB para pintar barras.

### Sin `next/font`

Las fuentes se cargan por `<link>` con stack de respaldo del sistema. Con
`next/font` el build depende de que Google Fonts esté accesible, y eso rompe
compilaciones en CI y en entornos con red restringida.

### Diseño por tokens CSS

Claro y oscuro se cambian reescribiendo variables en `:root`, no duplicando
clases con `dark:`. Tailwind consume los tokens con `@theme inline`, así que el
cambio de tema es instantáneo y no hay dos árboles de estilos que mantener.

### La IA es opcional y degrada con elegancia

Sin `ANTHROPIC_API_KEY` la app funciona entera; los botones de IA lo avisan en
pantalla en vez de fallar. `/api/ai/estado` es lo que consulta la interfaz al
arrancar.

---

## Cosas que deliberadamente NO hacemos

- **No inventamos contenido jurídico.** El prompt obliga al modelo a trabajar
  con el texto que le da el opositor y a avisar de que su temario y su preparador
  mandan sobre él. Un artículo mal citado en una oposición se paga caro.
- **No troceamos epígrafes a la fuerza.** Si el autoparser no encuentra una
  estructura fiable, lo dice y ofrece meterlos a mano. Un troceado inventado es
  peor que ninguno.
- **No gamificamos con confeti.** El público es jurídico y adulto; rachas y
  vueltas sí, medallitas no.

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

### 8. La app se personaliza, pero sigue siendo la misma app

El opositor pasa años delante de esta pantalla. Poder ajustarla —fondo,
acento, tipografía y cuerpo del texto de los temas, densidad, con qué
criterio se ordenan los temas— no es un capricho: es la diferencia entre una
herramienta que se usa y una que se abandona.

Ahora bien, personalizar **no es un constructor de temas**. Las reglas:

- **El acento sustituye al lacre, nunca al latón.** El dorado es la segunda
  nota de la casa y es lo que hace que un opositor con el acento jade siga
  usando reconociblemente esta app y no otra. Se ofrece una paleta con
  nombre (lacre, tinta, jade, cárdeno, cobre) porque un selector de color a
  pelo como única opción es una trampa: la mayoría de los colores elegidos a
  ojo sobre un fondo casi negro no se leen. El color libre existe, pero
  pasa por la corrección de contraste.
- **La legibilidad no se negocia.** `lib/data/color.ts` mide el contraste
  WCAG de verdad y `lib/data/apariencia.ts` corrige la luminosidad del
  acento hasta que llega al mínimo (3:1 como relleno, 4.5:1 donde se usa
  como texto, 4.5:1 para la etiqueta encima del botón). Si el color elegido
  ya cumple, sale tal cual: la corrección es una red, no un filtro de marca.
  `pruebas/modelo.mjs` lo comprueba por fuerza bruta sobre todo el círculo
  de tonos, en los tres fondos.
- **Solo cambia de tipografía el texto de los temas.** Los titulares, la
  marca y la interfaz se quedan como están. Cambiar el cuerpo de la interfaz
  entera es lo que convierte una preferencia de lectura en un desastre de
  maquetación.
- **La densidad es una línea de CSS.** `:root.compacta` reescribe
  `--spacing`, el token del que Tailwind deriva todas sus utilidades de
  espaciado. Una sola variable encoge la retícula entera y de forma
  proporcional; la alternativa —excepciones repartidas por treinta
  componentes— habría divergido a la tercera pantalla.
- **Los valores por defecto son la app de siempre, hasta el último dígito.**
  Quien no toca nada no nota nada. `pruebas/modelo.mjs` lo comprueba contra
  el propio `app/globals.css`: si alguien cambia un color en el CSS y no en
  la tabla de `apariencia.ts` (o al revés), la prueba se pone roja.

### 9. La personalización viaja; el antiparpadeo no calcula

Vive en `Perfil` y en la tabla `perfiles` (migración `0006`), como
`dias_oxido` o `estilo_feedback`: se configura una tarde en el portátil de
casa y el de la biblioteca abre igual. No es "el tema de este navegador".

El guion antiparpadeo de `app/layout.tsx` tenía que crecer con esto, y la
tentación era duplicar el cálculo de color en una cadena del `head`. No se
hace: `components/Proveedor.tsx` deja en `localStorage` el resultado ya
masticado (clases + pares clave/valor) y el guion **solo lo copia**. Así el
color se calcula en un único sitio y no hay una segunda versión resumida
esperando a desincronizarse.

### 10. El orden de los temas es del opositor, salvo en las colas de triaje

`temasOrdenados()` acepta cinco criterios (número, estado, urgencia, tiempo
invertido, nota) y lo respetan el programa, el cante, el crono y el repaso.
Reordena **dentro de cada materia**: el mural se lee por materias y romper
esa agrupación por ordenar por nota deja una lista sin mapa.

Dos excepciones, las dos deliberadas:

- **El cante y el repaso son triaje**, no catálogo: la pregunta no es "dónde
  está el tema 47" sino "qué toca ahora". Ahí el criterio por defecto
  ("número") se sustituye por la urgencia, que es como esas dos pantallas se
  han ordenado desde siempre; cualquier otro criterio, que solo se puede
  haber elegido a conciencia, sí manda. En el repaso, además, la preferencia
  ordena la cola pero no decide **quién entra**: eso lo sigue diciendo la
  urgencia, o un tema que no toca se colaría por tener mala nota.
- **Las bolas del bombo no se reordenan.** El sorteo es el sorteo, y además
  `Simulacro.notas` es posicional: reordenar la lista pintada desplazaría
  las notas.

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

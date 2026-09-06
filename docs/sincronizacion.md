# Sincronización

Cómo viaja el estado entre IndexedDB y Supabase. Este documento es el contrato:
si implementas el cliente de sincronización, lo que está aquí es lo que el
esquema (`db/migrations/`) da por supuesto.

---

## 1. Por qué local-first y no "app con backend"

El opositor estudia donde puede: bibliotecas con wifi saturado, salas de estudio
sin cobertura, el AVE. La sesión de trabajo dura horas y termina con un cante de
diez minutos que es el dato más caro que produce la app.

Si la escritura dependiese de la red, un cante perdido por un timeout sería un
usuario perdido. No hay recuperación posible: el opositor no va a repetir el
cante, va a cerrar la app.

Así que la regla es dura y sin excepciones:

> **Toda escritura del usuario se completa en IndexedDB antes de que la red
> entre en juego. La UI nunca espera al servidor. Nunca hay un spinner sobre
> una acción del usuario por culpa de la sincronización.**

Supabase no es la base de datos de la app. Es la copia duradera y el canal entre
dispositivos. Si Supabase está caído, la app funciona entera; solo deja de
propagarse.

Esto no es teoría montada a posteriori: la persistencia ya está en IndexedDB
(`lib/store/persist.ts`) precisamente por esto.

---

## 2. El contrato de columnas

Toda tabla lleva tres columnas de sincronización:

| Columna | Para qué |
| --- | --- |
| `creado_at` | Informativo. Se escribe una vez y no se toca más. |
| `updated_at` | Reloj del last-write-wins **y** cursor del pull incremental. |
| `deleted_at` | Tumba. `null` = fila viva. La app filtra siempre `deleted_at is null`. |

Y dos reglas de identidad:

- **El id lo genera el cliente**, uuid v4 (`crypto.randomUUID()`). Sin esto no
  se puede crear una entidad sin red, y sin eso no hay local-first. Los
  `default gen_random_uuid()` del esquema son solo red de seguridad para
  inserciones a mano desde el SQL editor.
- **`usuario_id` va denormalizado en todas las tablas** (salvo `perfiles`, que
  usa su PK). Es lo que permite que la RLS sea una comparación directa sin
  joins, y lo que hace barato el índice `(usuario_id, updated_at)`.

---

## 3. El ciclo

El sincronizador es un bucle con dos mitades independientes. Se dispara al
arrancar, al recuperar conectividad (`online`), al volver la pestaña a primer
plano, y con un intervalo de fondo (30-60 s es razonable) mientras haya cola.

```
    ┌─────────────┐   mutación    ┌──────────────┐
    │     UI      │ ────────────► │  IndexedDB   │  ← fuente de verdad de la sesión
    └─────────────┘   (síncrono)  └──────┬───────┘
                                         │ encola id + tabla
                                         ▼
                                  ┌──────────────┐
                                  │ cola pending │
                                  └──────┬───────┘
                        push (upsert)    │        ▲  pull (updated_at > cursor)
                                         ▼        │
                                  ┌──────────────────┐
                                  │     Supabase     │
                                  └──────────────────┘
```

### 3.1 Push

1. La cola de pendientes guarda `{tabla, id}`, no la fila entera. Al empujar se
   lee el estado **actual** de IndexedDB. Así, si el usuario ha editado la
   misma nota cinco veces offline, se sube una vez y con el valor final.
2. Se sube con `upsert` sobre la PK (`onConflict: 'id'`, o `'tema_id'` para
   `progreso_temas`), en lotes por tabla.
3. Se envía el `updated_at` local de la fila. Es imprescindible: una nota
   editada el martes y subida el jueves debe conservar la marca del martes,
   o le ganaría injustamente a una edición del miércoles hecha en otro
   dispositivo.
4. Al confirmarse el lote, se sacan esos ids de la cola. Si falla, se quedan y
   se reintentan con backoff. **Nunca se descarta una entrada de la cola por un
   error de red.**

**El orden del push importa**, porque hay claves ajenas:

```
perfiles → materias → temas → epigrafes → progreso_temas
                                        → sesiones, cantes, keypoints, notas, simulacros
```

Subir un epígrafe cuyo tema aún no está en el servidor falla con violación de
FK. Respeta el orden y no hace falta nada más.

### 3.2 Pull

1. Se guarda un cursor por usuario: `ultimoPull` (timestamptz).
2. Por cada tabla:
   `select * where usuario_id = <uid> and updated_at > <cursor> order by updated_at`.
   Índice `(usuario_id, updated_at)` — está creado para exactamente esto.
3. **El pull NO filtra `deleted_at is null`.** Las tumbas tienen que bajar: son
   la forma en que un dispositivo se entera de que algo se borró en otro. Por
   eso los índices de pull no son parciales y los de la app sí.
4. Se aplica cada fila sobre IndexedDB con la regla de conflicto de §4.
5. El cursor nuevo es el `updated_at` **máximo recibido**, no `Date.now()`. Usar
   el reloj local aquí abre una ventana en la que se pierden filas escritas por
   otro dispositivo durante el propio pull.
6. Deja un margen de seguridad de unos segundos hacia atrás (`cursor - 5 s`) y
   sé idempotente al aplicar: una fila que baja dos veces no debe hacer daño.

Primer arranque tras iniciar sesión: cursor a época cero, baja todo. Con un
temario completo son unos pocos miles de filas — cabe en una tacada; pagina de
1000 en 1000 si te preocupa.

---

## 4. Conflictos: last-write-wins por fila

Cuando el pull trae una fila que también existe en local:

```
si  remoto.updated_at > local.updated_at  →  gana el remoto, se sobrescribe local
si  remoto.updated_at < local.updated_at  →  gana el local, se deja y se reencola para push
si  son iguales                           →  no se toca nada
```

Y en el servidor, la misma regla la arbitra el trigger `tocar_updated_at()`:
si llega un `update` cuyo `updated_at` es anterior al que ya hay en la fila, el
trigger devuelve `OLD`, así que la fila se reescribe con los valores que ya
tenía y la escritura perdedora se neutraliza sin error ni transacción abortada.

Aprovéchalo: pide `.select()` en el upsert. Lo que te devuelve es la fila
**ganadora**, no la que mandaste. Si difiere de la tuya, has perdido el
conflicto y puedes adoptar la versión del servidor en el acto, sin esperar al
siguiente pull.

Que el arbitraje esté también en el servidor es deliberado. Un cliente con un
bug, o una versión antigua de la app, no puede corromper el estado de los demás.

**Granularidad: la fila entera.** Si dos dispositivos editan campos distintos de
la misma fila, el perdedor pierde su campo también. Es asumible aquí porque la
app es de un solo usuario y la ventana de escritura concurrente real es
diminuta. No montes merge por campos: complica todo para un caso que casi no
existe.

### Deriva de relojes

El last-write-wins depende de que los relojes de los dispositivos sean
comparables. Un móvil con la hora mal puesta gana o pierde todos los conflictos.
Mitigación barata y suficiente: al iniciar sesión, calcula el desfase con el
servidor (`select now()`) y aplícalo a los `updated_at` que generes. Si el
desfase es menor de unos segundos, ignóralo.

---

## 5. Qué es append-only y qué es mutable

La distinción manda sobre cuánto esfuerzo merece cada tabla.

### Append-only (sin conflicto real)

- **`sesiones`** — se crean al parar el cronómetro y no se vuelven a tocar.
- **`cantes`** — con una excepción: `analisis` y `feedback` se rellenan después,
  en un único update que casi siempre viene del mismo dispositivo que grabó.
- **`simulacros`** — se crean al sortear y se actualizan al corregir. La
  corrección la hace quien lo hizo, en el mismo sitio.

Para estas tablas el push es un `insert` que nunca choca, porque el id es un
uuid v4 generado en el cliente. No necesitan lógica de conflicto: si al pull
baja una que ya tienes, es la misma.

### Mutables de verdad

- **`perfiles`** — una fila, se edita en Ajustes. Conflicto posible pero raro.
- **`materias`**, **`temas`**, **`epigrafes`** — se editan al montar el temario.
  Momento intenso pero corto y normalmente en un solo dispositivo.
- **`progreso_temas`** — la tabla caliente. Ver §6.
- **`keypoints`** — cada respuesta muta `aciertos`, `fallos`, `intervalo_dias` y
  `proximo_repaso`. Repasar las mismas tarjetas en dos dispositivos a la vez es
  el segundo escenario de conflicto más probable.
- **`notas`** — texto libre. Es donde más duele perder una escritura, porque el
  usuario ve desaparecer algo que escribió. Si algún día se implementa merge por
  campos, empieza aquí.

---

## 6. El problema de los contadores

Hay que decirlo claro porque el esquema no lo resuelve solo:

**`progreso_temas.segundos`, `.vueltas` y `.nota_media` son acumuladores, y el
last-write-wins los trunca.** Si estudias 40 minutos en el portátil y 30 en el
móvil sin sincronizar entre medias, la fila ganadora tendrá 40 o 30, no 70. El
opositor ve horas que no cuadran, y esta app existe precisamente para darle el
número honesto.

La solución no es un CRDT. Es que los tres campos son **derivables de tablas
append-only**, que no tienen conflicto:

| Campo | Se puede derivar de |
| --- | --- |
| `segundos` | `sum(sesiones.segundos) where tema_id = ...` |
| `vueltas` | contando transiciones a `dominado` (haría falta registrarlas) |
| `nota_media` | `avg(cantes.nota) where tema_id = ...` |

Recomendación para quien implemente el cliente: **recalcula `segundos` y
`nota_media` en local tras cada pull**, a partir de `sesiones` y `cantes`, en vez
de fiarte del valor sincronizado. Las columnas se quedan en la tabla como caché
(evitan agregar en cada render), pero la verdad está en las tablas append-only.

`vueltas` es el caso feo: hoy no hay registro de las transiciones a `dominado`,
solo el contador. Se pierde en un conflicto y no hay de dónde reconstruirlo. Es
un dato de baja consecuencia — asúmelo o registra las transiciones como filas.

Lo mismo, en menor grado, con `keypoints.aciertos` y `.fallos`.

---

## 7. Borrados

**El cliente nunca hace DELETE.** No es una recomendación: el esquema no crea
política de `DELETE` en ninguna tabla, así que un delete desde el cliente afecta
a cero filas y ni siquiera da error.

Borrar es:

```ts
update <tabla> set deleted_at = now(), updated_at = now() where id = ...
```

Y la app filtra `deleted_at is null` en **todas** sus consultas y selectores. Si
se te olvida un filtro, aparecen temas fantasma.

El motivo es simple: un `DELETE` físico no deja rastro. El otro dispositivo pide
"lo tocado desde el jueves" y no recibe nada, porque no hay fila que enviar. La
tumba es lo único que viaja.

### Cascada

Borrar un tema tiene que arrastrar sus epígrafes, su progreso, sus cantes, sus
keypoints y sus notas — hoy `removeTema` en el store ya lo hace en local. En el
servidor lo repite el trigger `cascada_borrado_tema()`, y `cascada_borrado_materia()`
hace lo propio con los temas de una materia (que encadena el primero).

Está duplicado a propósito: si solo lo hiciera el cliente, un dispositivo con la
app vieja o interrumpido a mitad dejaría huérfanos visibles en los demás. Como
la cascada del servidor toca `updated_at` de las filas hijas, el pull incremental
de los otros dispositivos las recoge sin nada extra.

**Las `sesiones` NO se cascadean.** Borrar un tema no significa no haberlo
estudiado; las horas efectivas son historia y no se reescriben. Su `tema_id`
queda apuntando a un tema con `deleted_at` y la app lo pinta como "tema borrado".

### Purga

Las tumbas crecen. Cuando molesten, se borran de verdad con la `service_role`
(que salta la RLS) filtrando `deleted_at < now() - interval '90 days'`. Noventa
días es más que suficiente: un dispositivo que lleva tres meses sin sincronizar
debería hacer un pull completo, no incremental.

---

## 8. Audio de los cantes

El binario **no** viaja por la tabla. `cantes.audio_path` guarda la ruta dentro
del bucket privado `cantes-audio`, con el convenio `<usuario_id>/<cante_id>.webm`
del que depende toda la seguridad de Storage (ver `db/migrations/0002_storage_audio.sql`).

La subida es una fase aparte del push, y el orden no es negociable:

1. Guardar el cante en IndexedDB con el blob y con `audio_path` ya calculado
   (es determinista, no hace falta esperar a nada).
2. Push de la fila `cantes`. Es barato y va siempre, incluso con red mala.
3. Subida del binario cuando haya red decente, con su propia cola y su propio
   backoff.

Si (3) falla, la fila ya está a salvo. Al revés —esperar al audio para subir la
fila— es exactamente el escenario que pierde el cante en la biblioteca.

Para reproducir: `createSignedUrl(path, segundos)` con caducidad corta (minutos).
Un 404 al firmar significa "grabación pendiente de subir", no error.

### Cómo está implementado (`lib/audio/`)

- **El blob NO está en el store.** Vive en su propia base de IndexedDB
  (`opos-notaria-audio`, `lib/audio/almacen.ts`), indexado por el id del cante.
  El estado del store se serializa entero a JSON en cada escritura: con el
  audio dentro, cada tecla de fallo marcada durante el cante reescribiría
  varios megas —y en base64, un tercio más—, justo en el momento en el que la
  app no se puede permitir una pausa. En el store queda solo la ficha
  (`Cante.audio`: ruta, mime, bytes, duración y las marcas de epígrafe).

- **La cola de binarios no es una cola: se deriva del dato.** Pendiente = hay
  blob en local y la ficha del cante no dice `subido`. Se decidió así en vez
  de extender la cola de `lib/sync/cola.ts` por dos motivos. Uno, esa cola
  guarda `{tabla, id}` y su valor está en que el push relee la fila del estado
  actual; un binario no es una fila, no lo toca `escribir()`, no lo sella el
  reloj y no cabe en `filasParaPush`, así que habría que inventar una tabla
  falsa que se colaría en el orden de claves ajenas. Y dos, una cola paralela
  se puede desincronizar del dato al que apunta (entradas hacia blobs que ya
  no están, blobs sin entrada que no suben nunca); una cola que se deduce, no.

- **Va después del ciclo de filas y en su propio `try`**
  (`lib/sync/servicio.ts`): que no haya podido subir un audio de 5 MB con la
  wifi de la biblioteca no convierte en fallida una sincronización cuyo
  expediente ya está arriba. Backoff propio, en memoria, por cante.

- **Nunca durante el cante.** Hereda el bloqueo de `bloquearSincronizacion()`,
  porque cuelga del mismo ciclo.

- **Purga.** Un cante enterrado se lleva su binario por delante, en local y en
  Storage. Aquí sí hay borrado físico: la tumba que viaja es la fila.

### Lo que NO viaja, y por qué

`Cante.transcripcion` y `Cante.comparacion` **no tienen columna** en el
esquema, y las migraciones están cerradas. Se quedan en el dispositivo que las
generó. Como el audio sí sube, en otro aparato se pueden volver a generar
desde la grabación; cuesta una llamada al transcriptor, no el trabajo del
opositor.

Lo que sí hubo que arreglar para que esto no fuera una pérdida silenciosa: la
fusión **no puede borrar un campo del que la fila del servidor no habla**.
Ganar el last-write-wins significa "mi versión de lo que está en la tabla es
más nueva", no "lo que tú tienes de más ya no vale". `fundirCante()` en
`lib/sync/fusion.ts` conserva transcripción, comparación y los metadatos
locales del audio cuando gana el remoto. Hay una comprobación de esto en
`pruebas/sincronizacion.mjs`, contra Postgres.

Si algún día se abren las migraciones, dos columnas `jsonb` en `cantes`
(`transcripcion`, `comparacion`) y sus conversores en `lib/sync/tablas.ts`
cierran el hueco sin tocar nada más.

---

## 9. Deudas del modelo actual

Cosas que hoy están escritas de una forma que **no encaja** con este esquema.
Hay que resolverlas en el cliente antes de encender la sincronización.

### 9.1 Los ids no son uuid — bloqueante

`lib/utils/id.ts` genera ids tipo `tem_lx9f3kq2a`, y `addMateria` usa `slug()`,
que produce `civil`, `mercantil`, `hipotecario`. Ninguno es un uuid, y las
columnas del esquema son `uuid`. **El primer push de cualquier instalación
existente falla.**

Hay que hacer dos cosas:

1. Cambiar la generación a `crypto.randomUUID()` para todo lo nuevo.
2. Migrar los datos locales existentes: recorrer todas las entidades, asignar un
   uuid nuevo a cada una, y **reescribir todas las referencias** — `materiaId`,
   `temaId`, `epigrafeId`, las claves del mapa `progresos`, y `simulacros.temaIds`.
   Guarda el mapa `idViejo → uuid` en IndexedDB por si hay que depurar, y haz la
   migración en una versión del `persist` de Zustand (`version: 2` + `migrate`).

No se puede posponer ni esquivar cambiando las columnas a `text`: los ids slug de
las materias precargadas son **los mismos para todos los usuarios**, así que dos
opositores tendrían materias distintas con el id `civil`. Con `usuario_id` en la
PK compuesta funcionaría, pero rompe todas las FK. Uuid es la salida limpia.

### 9.2 Los epígrafes viven anidados dentro del tema

En el modelo, `Tema.epigrafes: Epigrafe[]`. En el esquema son una tabla. La capa
de sincronización tiene que aplanar al subir y reanidar al bajar.

Es la decisión correcta, no un capricho del esquema: si los epígrafes fueran un
`jsonb` del tema, editar el epígrafe 3 en el móvil y el 7 en el portátil sería un
conflicto a nivel de tema y una de las dos ediciones se perdería entera. Con
filas, cada epígrafe tiene su propio reloj.

Consecuencias concretas:

- `setEpigrafes(temaId, epigrafes)` reemplaza el array entero. Al sincronizar hay
  que diferenciar: los que ya no están se marcan `deleted_at`, no desaparecen.
- `removeEpigrafe` renumera el `orden` de todos los siguientes. Eso son N filas
  tocadas, no una. Es correcto y hay que encolarlas todas.
- `Epigrafe` no tiene `creado`/`actualizado` en el tipo. Los timestamps los pone
  la BD; el cliente los recibirá al bajar y debe guardárselos para el LWW.

### 9.3 Las materias precargadas

`ESTADO_INICIAL.materias = MATERIAS` siembra cinco materias en local antes de que
haya sesión. Con ids uuid nuevos por instalación (§9.1) esto ya no colisiona,
pero abre otro riesgo: si el usuario instala la app en dos dispositivos sin haber
sincronizado, acaba con diez materias, cinco de cada.

Por eso **el servidor no siembra materias** (el trigger de alta solo crea el
perfil). La siembra es del cliente, y el cliente debe decidir en el primer login:
si el pull trae materias, descarta las locales sin usar; si no trae nada, sube
las suyas.

### 9.4 `Materia` no tiene `orden`

El orden de las materias hoy es la posición en el array, y un array no sobrevive
a una tabla. El esquema tiene `materias.orden`; hay que añadir el campo al tipo
`Materia` y rellenarlo con el índice actual en la misma migración de §9.1.
Si no, el orden de la barra lateral bailará entre dispositivos.

### 9.5 `Nota.actualizado` y `updated_at` son lo mismo

No los dupliques. El esquema no tiene columna `actualizado`: el cliente lee
`updated_at` para pintar "editada hace X". Al bajar, mapea uno al otro.

### 9.6 El chat no se sincroniza

`MensajeChat` está en el modelo y se persiste en IndexedDB, pero **no tiene tabla
en Supabase**, igual que ya quedaba fuera de `exportar()`. Es un historial de
conversación efímero y voluminoso cuyo valor cae a cero en cuanto pasa la sesión;
sincronizarlo sería pagar ancho de banda por ruido. Si algún día se decide que
la conversación debe seguirte entre dispositivos, es una tabla nueva y una
migración `0003`, no un remiendo aquí.

### 9.7 El cronómetro activo tampoco

`CronoActivo` es estado de sesión, no dato. Un cronómetro corriendo en dos
dispositivos a la vez no tiene semántica que valga la pena definir. Se queda en
local y muere ahí. Lo que sí viaja es la `Sesion` que produce al pararse.

### 9.8 `simulacros`: arrays posicionales

`tema_ids` y `notas` se corresponden índice a índice. Es frágil (si alguien
reordena uno y no el otro, las notas se cruzan) pero aceptable, porque un
simulacro se crea y se corrige entero en el mismo sitio y el LWW por fila
sustituye el documento completo. No lo normalices en tablas hijas: multiplicarías
las filas a sincronizar para arreglar un problema que no se da.

---

## 10. Resumen para quien implemente

- [ ] Migrar ids a uuid v4 y reescribir referencias (§9.1). **Primero esto.**
- [ ] Añadir `orden` a `Materia` (§9.4).
- [ ] Cola de pendientes en IndexedDB: `{tabla, id}`, nunca la fila entera.
- [ ] Push por lotes con `upsert`, en el orden de FK de §3.1, mandando `updated_at`.
- [ ] Pull incremental por `updated_at > cursor`, **sin** filtrar `deleted_at`.
- [ ] Cursor = máximo `updated_at` recibido, menos un margen de segundos.
- [ ] Aplanar/reanidar epígrafes (§9.2).
- [ ] Recalcular `segundos` y `nota_media` desde `sesiones`/`cantes` tras cada pull (§6).
- [ ] Borrado = `deleted_at`, y filtro `deleted_at is null` en todos los selectores.
- [x] Audio en cola aparte, después de la fila (§8). Hecho en `lib/audio/`.

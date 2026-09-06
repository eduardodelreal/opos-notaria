# Avisos proactivos (Web Push)

El objetivo es que la app le diga al opositor *"llevas 11 días sin tocar
Hipotecario"* o *"el tema 33 se te está oxidando: 60 días"* **sin que él tenga
que abrir nada**. Un recordatorio al día como mucho, y solo si hay algo
concreto que decir. Al que va al día no le llega nada: eso no es un hueco, es
la regla más importante de todo esto.

Es **opcional de punta a punta**. Sin claves VAPID configuradas la app arranca
igual y el apartado de avisos no aparece, exactamente como pasa con
`ANTHROPIC_API_KEY` o con Supabase.

---

## Las piezas

| Fichero | Qué hace |
| --- | --- |
| `public/sw-avisos.js` | Service worker. Recibe el push, pinta la notificación y, al tocarla, abre **el tema**, no la portada. |
| `public/aviso-192.png` | Icono de la notificación. |
| `lib/avisos/tipos.ts` | Tipos compartidos por el motor, la interfaz y el cron. |
| `lib/avisos/config.ts` | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` y `hayAvisos()`. |
| `lib/avisos/zonas.ts` | Hora local por dispositivo, ventana de disparo, `conZona`. |
| `lib/avisos/motor.ts` | **De qué avisar.** Puro: ni red ni navegador. |
| `lib/avisos/navegador.ts` | Permiso, registro del SW, alta y baja de la suscripción. |
| `lib/avisos/preferencias.ts` | Preferencias y dispositivos, contra Supabase. |
| `lib/avisos/expediente.ts` | Carga el expediente de un usuario desde Supabase (lo usa el cron). |
| `lib/avisos/envio.ts` | Envío con `web-push`. **Solo el cron.** |
| `components/AjustesAvisos.tsx` | La pantalla de ajustes. Todavía **sin enchufar**. |
| `app/api/avisos/estado/route.ts` | Diagnóstico: ¿está esto configurado? |
| `scripts/enviar-avisos.ts` | El cron de Railway. |
| `scripts/prueba-motor-avisos.mjs` | Pruebas del motor y de las zonas horarias. |
| `scripts/prueba-envio-push.mjs` | Prueba del envío, con descifrado del push. |

El almacén ya venía hecho en `db/migrations/0003_vueltas_y_avisos.sql`:
`suscripciones_aviso` (una fila por navegador) y las preferencias en `perfiles`
(`avisos_activos`, `aviso_hora`, `aviso_dias`, `aviso_tipos`).

---

## 1. Claves VAPID

VAPID es cómo un servidor se identifica ante los servicios push de Google,
Mozilla y Apple. Es un par de claves ECDSA P-256 que se genera **una sola vez**:

```bash
npm run avisos:claves          # o: npx web-push generate-vapid-keys
```

Salen dos cadenas en base64url:

```
Public Key:  BGHNwBfH5Rwwh96jNmxmlKtoi33Y2RSoDM75GIoJssEvyL362v-orStELO2A9gxGWDxN7RGml6fC28tbPX0Qcrs
Private Key: OjH9rV3YC4hcP08LTlglVRkmMA2L5hODz2wiGMcstHw
```

> **No se rotan a la ligera.** La clave pública queda dentro de cada
> suscripción del navegador. Si se cambia el par, todas las suscripciones
> existentes dejan de valer y hay que volver a pedir permiso aparato por
> aparato. (El cliente lo detecta y se resuscribe solo, pero solo cuando el
> opositor vuelve a abrir los ajustes.)

### Variables de entorno

| Variable | Web (Netlify / Railway app) | Cron (Railway) | Notas |
| --- | :---: | :---: | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | **sí** | sí | Pública por diseño. **Se incrusta al compilar.** |
| `VAPID_PRIVATE_KEY` | **NO** | **sí** | Secreta. |
| `VAPID_SUBJECT` | no | **sí** | `mailto:tu-correo@ejemplo.es`. |
| `SUPABASE_SERVICE_ROLE_KEY` | **NO, JAMÁS** | **sí** | Se salta la RLS entera. |
| `SUPABASE_URL` | no | sí | Si falta, se usa `NEXT_PUBLIC_SUPABASE_URL`. |
| `AVISOS_VENTANA_MIN` | no | opcional | Por defecto 15. Ver más abajo. |

### La `service_role` solo puede vivir en el cron

El cron necesita leer los datos de **todos** los usuarios para decidir a quién
avisar, así que usa la `service_role` de Supabase, que **se salta la RLS
entera**: quien la tenga puede leer y escribir el expediente de cualquier
opositor sin iniciar sesión.

Por eso:

* va **solo** en las variables del servicio de cron;
* **nunca** en el entorno del sitio web, ni en Netlify ni en el Railway que
  sirve la app. Ninguna ruta de `app/` la lee;
* **nunca** con el prefijo `NEXT_PUBLIC_`. Next sustituye esas variables
  literalmente dentro del JavaScript que descarga cualquiera que abra la web:
  publicarla ahí equivale a publicar la base de datos entera;
* **nunca** en el repositorio.

Lo mismo, en menor grado, con `VAPID_PRIVATE_KEY`: quien la tenga puede mandar
notificaciones en nombre de la app a todo el que esté suscrito.

Se puede comprobar que un build no la lleva dentro:

```bash
grep -rl "SERVICE_ROLE\|VAPID_PRIVATE" .next/static   # no debe devolver nada
```

---

## 2. Supabase

1. Aplicar `db/migrations/0003_vueltas_y_avisos.sql` (después de `0001`).
2. Nada más. Las políticas RLS ya están: cada opositor solo ve y toca sus
   suscripciones, y el cron va con `service_role`.

### Lo que le falta al esquema: `avisos_enviados`

`0003` no trae dónde guardar **qué** aviso se mandó, solo *cuándo*
(`suscripciones_aviso.ultimo_envio`). Con eso sale el tope de **uno al día**,
pero no el **"no repetir el mismo aviso dos días seguidos"**: para eso hace
falta recordar la clave del aviso anterior.

El cron funciona sin esta tabla —lo detecta al arrancar y lo dice por consola—
pero repetirá el mismo aviso mientras la causa siga ahí. Con ella, si ayer le
dijo lo del tema 33 y sigue sin tocarlo, hoy le dice otra cosa.

Esto es una migración pendiente (`0004`), y no se ha añadido a `db/` a propósito
porque ese directorio no entraba en el encargo. El SQL, listo para pegar:

```sql
-- 0004 · memoria de avisos enviados
create table if not exists public.avisos_enviados (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users on delete cascade,
  -- La clave estable del aviso: "oxido:tema:<uuid>", "racha", "ritmo:<lunes>".
  clave      text not null,
  tipo       text not null,
  -- Se guardan el título y el cuerpo tal cual se enviaron: sin esto no hay
  -- forma de saber qué leyó el opositor cuando venga a decir que el aviso
  -- estaba mal.
  titulo     text not null,
  cuerpo     text not null,
  url        text not null,
  -- Día LOCAL del usuario, no del servidor. Es la unidad del "uno al día".
  dia        date not null,
  enviado_at timestamptz not null default now()
);

-- Un aviso por usuario y día: el tope diario, impuesto por la base y no solo
-- por el código, para que dos pasadas solapadas del cron no lo salten.
create unique index if not exists avisos_enviados_dia_idx
  on public.avisos_enviados (usuario_id, dia);

create index if not exists avisos_enviados_clave_idx
  on public.avisos_enviados (usuario_id, clave, dia desc);

alter table public.avisos_enviados enable row level security;

-- Solo lectura para el opositor: lo escribe el cron con service_role, que se
-- salta la RLS. Sin política de insert, nadie puede fabricarse un historial
-- falso para silenciarse los avisos.
drop policy if exists "datos propios: select" on public.avisos_enviados;
create policy "datos propios: select" on public.avisos_enviados
  for select using (auth.uid() = usuario_id);
```

---

## 3. Railway: el cron

Netlify no sirve para esto: sus funciones se disparan por petición HTTP y
cortan a los 10-30 s. Esto es un proceso que corre solo cada pocos minutos.

En Railway, un cron es **un servicio más** que arranca según el horario, hace su
trabajo y **termina**.

1. **Nuevo servicio** en el mismo proyecto, apuntando a este repositorio.
2. **Settings → Deploy → Custom Start Command**:

   ```
   npm run avisos:enviar
   ```

   (que es `node --experimental-strip-types --import ./pruebas/cargador.mjs
   scripts/enviar-avisos.ts`: los módulos del proyecto son TypeScript con
   imports sin extensión y ese cargador es el mismo que usan las pruebas.)

3. **Settings → Cron Schedule**:

   ```
   */15 * * * *
   ```

   Los horarios de Railway van **en UTC**, pero da igual: el cron no decide la
   hora, la decide la zona de cada dispositivo. Lo único que importa es que
   corra a menudo. El mínimo que admite Railway son 5 minutos.

4. **Settings → Deploy → Restart Policy: `Never`**. Un cron que reinicia al
   terminar se convierte en un bucle infinito.
5. **No** le pongas dominio público ni healthcheck: no escucha en ningún puerto.
6. **Variables** (Settings → Variables):

   ```
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=...        ← solo aquí
   NEXT_PUBLIC_VAPID_PUBLIC_KEY=B...
   VAPID_PRIVATE_KEY=...                ← solo aquí
   VAPID_SUBJECT=mailto:tu-correo@ejemplo.es
   AVISOS_VENTANA_MIN=15
   ```

7. Opcional: en **Build Command** puedes poner `npm ci` a secas. El
   `npm run build` por defecto compila Next entero, que este servicio no
   necesita para nada.

### `AVISOS_VENTANA_MIN` tiene que coincidir con el horario

El cron no corre en el minuto exacto de nadie, así que un aviso de las 20:00 se
manda en la pasada que caiga entre las 20:00 y las 20:00 + ventana. Si el cron
va cada 15 minutos y la ventana fuera de 5, los avisos de los otros 10 minutos
**no se mandarían nunca**. Si va cada 15 y la ventana fuera de 30, se intentaría
dos veces (el tope diario lo taparía, pero es trabajo tirado).

Regla: **ventana = periodo del cron**.

### Probarlo a mano

```bash
# Qué haría, sin mandar nada:
npm run avisos:enviar -- --seco

# Un solo opositor, ignorando su hora, sus días y el tope diario:
npm run avisos:enviar -- --forzar --usuario 00000000-0000-0000-0000-000000000000
```

En Railway, con el servicio ya creado: `railway run npm run avisos:enviar --
--seco` desde el repositorio, o **Deploy → Trigger** para lanzar una pasada
suelta.

La salida es una línea por opositor y un resumen al final:

```
[avisos] 2026-09-06T18:00:11.000Z · 12 perfiles con avisos activos
[avisos] a1b2…: oxido · oxido:tema:9f3c… · "El tema 33 se te está oxidando" → /tema/9f3c…
[avisos] c4d5…: nada que decir hoy.
[avisos] Fin. mirados=12 tocaban=3 decididos=2 enviados=3 caducadas=0 fallos=0
```

El proceso **siempre sale con código 0** si pudo arrancar: un endpoint muerto es
la cosa más normal del mundo y no debe pintar la ejecución de rojo. Solo sale
con error si le falta una variable de entorno.

---

## 4. El motor de decisión

Está en `lib/avisos/motor.ts` y es **puro**: se le da un expediente y devuelve
un aviso o `null`. No sabe nada de Supabase ni de navegadores, y por eso se
puede probar de verdad.

**De qué avisar sale de `lib/data/srs.ts`** —`colaDeRepaso`, `estadoEfectivo`,
`urgencia`, `intervaloDias`, `calcularRacha`—, que es la misma lógica que pinta
el mural y la cola de repaso. Si la app dice que un tema está oxidado, el aviso
dice lo mismo el mismo día. Reimplementarlo aquí habría sido garantizar que
antes o después dijeran cosas distintas.

### Las familias

| Familia | Cuándo | Ejemplo |
| --- | --- | --- |
| `oxido` (tema) | `estadoEfectivo` dice "oxidado" | *El tema 33 se te está oxidando — 60 días sin tocar «La hipoteca de máximo» (Civil). Lo tenías dominado.* |
| `oxido` (materia) | Una materia lleva más de `dias_oxido / 4` días parada **mientras sigue estudiando otras** | *11 días sin tocar Hipotecario — Lo que más lo pide es el tema 33: «El principio de fe pública».* |
| `repaso` | `colaDeRepaso` con urgencia ≥ 1 (la fecha ya pasó) | *Toca repasar el tema 47 — «Las obligaciones» (Civil). 12 días sin tocarlo, 4 más de la cuenta.* |
| `racha` | Racha ≥ 2 días y hoy todavía nada | *Racha de 14 días — Hoy no has estudiado nada todavía. Media hora con el tema 47 y sigue viva.* |
| `racha` (ritmo) | Miércoles a viernes y por debajo del 60 % de lo que tocaría | *9 h de 45 esta semana — Vas por el 20 % del objetivo y ya es jueves. Empieza por el tema 47.* |
| `simulacro` | ≥ 8 temas en pie y 21 días sin simulacro | *34 días sin simulacro — Tienes 28 temas en pie.* |

Todos nombran un tema por su número o una cifra. Un aviso que no puede ser
concreto no se manda.

> **El objetivo semanal viaja dentro de `racha`** porque
> `perfiles.aviso_tipos` solo admite cuatro valores (`0003`) y es la misma
> familia: constancia. Si algún día se quiere poder apagar por separado, hace
> falta una migración que amplíe el `check` con un quinto valor (`ritmo`).

### Cómo se limita el ruido

1. **Uno al día por opositor.** Dos barreras: el cron mira `ultimo_envio` de
   todos sus aparatos, y el motor descarta si el historial tiene algo de hoy.
2. **Sin repetir dos días seguidos.** Las claves son estables
   (`oxido:tema:<id>`, `racha`) precisamente para que se puedan comparar. Si
   llevaran la fecha dentro, cada día sería una clave distinta y no habría nada
   que comparar. Necesita la tabla `avisos_enviados` (arriba).
3. **Un aviso por tema.** "El tema 33 se oxida" y "toca repasar el 33" son la
   misma frase: se queda el de más peso. El filtro se aplica después del de
   familias y antes del historial, para que "no repetir" signifique "no volver
   sobre el mismo tema", no "no volver a usar la misma plantilla".
4. **Lo que el opositor apagó no se manda**, aunque sea lo más urgente.

---

## 5. Zonas horarias

La hora preferida es **una sola** y vive en `perfiles`; la zona es **de cada
aparato** y vive en `suscripciones_aviso`. El reparto es de `0003` y tiene
sentido: "avísame a las 20:00" es una decisión de la persona, pero esas 20:00 no
son el mismo instante para el móvil que se fue a Canarias y el portátil que se
quedó en Madrid.

Consecuencias, todas resueltas en `lib/avisos/zonas.ts`:

* el cron corre en UTC y resuelve la hora contra la zona de cada suscripción;
* el "día de hoy" del tope diario es el día **local del opositor**;
* antes de decidir, el cron se mete en la zona del usuario con `conZona()`
  (`process.env.TZ`), porque el SRS calcula con días locales del proceso
  (`claveDia`, `calcularRacha`, `inicioSemana`). Sin eso, la racha de un
  opositor en México se partiría seis horas antes de tiempo. Por lo mismo, el
  cron procesa los usuarios **en serie** y `conZona` **solo acepta funciones
  síncronas**;
* cuando le toca a cualquiera de sus aparatos, el aviso se manda a **todos**:
  el aviso es del opositor, no del cacharro.

---

## 6. Qué está probado y qué no

```bash
npm run prueba:avisos        # motor de decisión + zonas horarias   (23 pruebas)
npm run prueba:envio-push    # envío real de un push, descifrado     (5 pruebas)
```

**`prueba:avisos`** corre contra el código real (mismo cargador que
`pruebas/modelo.mjs`) con expedientes de mentira: un tema oxidado, una materia
abandonada, una racha a punto de romperse, un opositor al día. Comprueba que
avisa de lo que debe y con el número de tema dentro, que **no** avisa a quien va
al día, que no repite, que no manda dos en un día y que respeta lo apagado. Se
ha verificado que las pruebas muerden rompiendo el motor a propósito (quitar el
anti-repetición, quitar el tope diario, usar `estado` en vez de
`estadoEfectivo`): cada rotura tira las pruebas correspondientes.

**`prueba:envio-push`** levanta un servicio push de mentira en localhost (con
TLS, porque `web-push` siempre usa HTTPS), le manda un aviso con una suscripción
cuyas claves genera la propia prueba, y luego **descifra el cuerpo** con la
clave privada del "navegador" para comprobar que dentro está exactamente el JSON
que espera `public/sw-avisos.js`. El descifrado está escrito a mano con
`node:crypto` y no con `web-push`, para que un fallo de la librería no se
cancele consigo mismo. También comprueba que un 404/410 marca la suscripción
como caducada y que un 500 **no** lo hace.

**Lo que NO está probado**, y hay que probarlo con un navegador de verdad antes
de darlo por bueno:

* que el service worker se registre y pinte la notificación;
* que el clic abra el tema correcto;
* que Google/Mozilla/Apple acepten nuestros envíos (endpoints reales);
* el flujo completo de permiso denegado en cada navegador.

En este contenedor no hay navegador ni endpoint push real, así que ese tramo no
se ha ejecutado nunca.

---

## 7. Limitaciones conocidas

* **iOS y iPadOS no reciben nada.** Safari solo entrega push a las webs
  instaladas en la pantalla de inicio, y esta app no es una PWA: no tiene
  manifest, y añadirlo era justo lo que no había que hacer. La interfaz lo
  detecta y lo dice en vez de dejar un interruptor que no hace nada. Para
  soportarlo haría falta `manifest.json` + enlazarlo en `app/layout.tsx`.
* **El service worker no cachea nada.** No tiene manejador de `fetch` a
  propósito: la app se sigue sirviendo exactamente igual que antes y no hay
  riesgo de "he desplegado y siguen viendo la versión vieja".
* **Sin `avisos_enviados` no hay anti-repetición** (ver arriba).
* **El "aviso de prueba" de los ajustes es local**: comprueba el permiso y el
  service worker, no la entrega desde Railway. Está dicho así en la interfaz.

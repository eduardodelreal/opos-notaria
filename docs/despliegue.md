# Despliegue

Tres piezas: **Supabase** (datos y auth), **Railway** (la app y el backend de
IA) y **Netlify** (la app de cara al usuario).

---

## Por qué dos sitios para la misma app

Las funciones de Netlify cortan la ejecución a los **10 s por defecto y 30 s
como techo**, y **ignoran** el `maxDuration` de Next: no es una opción que se
pueda subir. Las respuestas del modelo tardan entre 60 y 180 s.

En Netlify, el chat se cortaría a media frase y los análisis darían 502 de
forma habitual. Railway ejecuta un contenedor de larga vida sin tope por
petición, así que ahí sí funcionan.

La solución no duplica código: **el mismo repositorio desplegado dos veces**.

| | Qué sirve | Variables clave |
|---|---|---|
| **Railway** | El mismo build, actuando además de backend de IA | `ANTHROPIC_API_KEY`, `ORIGENES_PERMITIDOS`, las dos `NEXT_PUBLIC_SUPABASE_*` |
| **Netlify** | La app de cara al usuario | `NEXT_PUBLIC_IA_URL` → URL de Railway |

El navegador carga la app desde Netlify y manda las llamadas de IA
directamente a Railway. Sin proxy de por medio.

`NEXT_PUBLIC_IA_URL` vacía significa "llama a tu propio origen", así que en
local y en un despliegue solo-Railway todo funciona sin tocar nada.

---

## Variables de entorno

| Variable | Railway | Netlify | Notas |
|---|:---:|:---:|---|
| `ANTHROPIC_API_KEY` | **sí** | no | Solo la necesita quien atiende las rutas de IA |
| `ANTHROPIC_MODEL` | opcional | no | Por defecto `claude-opus-5` |
| `TRANSCRIPCION_API_KEY` | opcional | no | Transcribir los cantes. Es **otro proveedor**: la API de Anthropic no acepta audio (docs/ia.md) |
| `TRANSCRIPCION_URL` | opcional | no | Por defecto `https://api.openai.com/v1`. Cualquier servicio con `POST /audio/transcriptions` |
| `TRANSCRIPCION_MODELO` | opcional | no | Por defecto `whisper-1` |
| `NEXT_PUBLIC_SUPABASE_URL` | sí | sí | **Se incrusta al compilar**. En Railway, además, es lo que enciende la exigencia de sesión en `/api/ai/*` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | sí | sí | **Se incrusta al compilar**. Es pública por diseño; la seguridad la da RLS |
| `NEXT_PUBLIC_IA_URL` | **vacía** | URL de Railway | **Se incrusta al compilar** |
| `ORIGENES_PERMITIDOS` | dominio de Netlify | no | CORS. Sin esto el navegador bloquea las llamadas |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | sí | sí | Avisos push. **Se incrusta al compilar** |

> Las `NEXT_PUBLIC_*` se leen **en tiempo de compilación**, no de ejecución.
> Si las declaras después de construir, no surten efecto: hay que volver a
> desplegar.

La `service_role` de Supabase **no la usa la app web** y no debe aparecer en
ninguna variable de su build. La usa únicamente el **cron de avisos**, que
corre como un servicio aparte en Railway y necesita leer datos de todos los
usuarios para decidir a quién avisar. Vive solo en el entorno de ese cron:
nunca en Netlify, nunca en el servicio web de Railway, y jamás en una
variable `NEXT_PUBLIC_*`. Ver `docs/avisos.md`.

---

## Quién puede gastar tu dinero en las rutas de IA

**No hace falta ninguna variable nueva.** La regla la decide una que ya
existe:

> Si el servicio que atiende `/api/ai/*` (Railway) tiene las dos
> `NEXT_PUBLIC_SUPABASE_*`, sus rutas **exigen sesión iniciada**. Si no las
> tiene, siguen abiertas.

Esto importa porque `ORIGENES_PERMITIDOS` **no protege el endpoint**: CORS
solo le dice al navegador de otra pestaña que no lea la respuesta. Un `curl`
contra el dominio público de Railway no manda `Origin` y entraba sin más, y
cada llamada gasta dinero real en Anthropic y en el proveedor de
transcripción.

Tres consecuencias prácticas al desplegar:

1. **Pon las dos `NEXT_PUBLIC_SUPABASE_*` también en Railway**, no solo en
   Netlify (ya estaban en la tabla, pero antes solo servían para el render;
   ahora son además la cerradura). Y recuerda que se incrustan al compilar:
   declararlas después no surte efecto.
2. **Las dos piezas tienen que apuntar al MISMO proyecto de Supabase.** Si
   Netlify firma con un proyecto y Railway valida contra otro, el token no
   vale y todas las llamadas de IA dan 401. Se ve venir sin pulsar nada:
   `GET /api/ai/estado` con la cabecera `Authorization` devuelve
   `"requiereSesion": true` y `"sesion": false`.
3. **`GET /api/ai/estado` sigue abierto** a propósito: es el healthcheck de
   `railway.json` y lo que la interfaz consulta para saber si tiene que pedir
   que inicies sesión.

### Comprobarlo desde fuera

```
# Sin sesión: rechazo claro, y sin gastar un céntimo.
curl -i -X POST https://TU-APP.up.railway.app/api/ai/plan \
  -H 'Content-Type: application/json' -d '{"ficha":"x"}'
# HTTP/1.1 401 Unauthorized
# {"error":"sin_sesion","mensaje":"Necesitas haber iniciado sesión para usar esto."}

# El estado dice si este servidor pide sesión:
curl https://TU-APP.up.railway.app/api/ai/estado
# {"disponible":true,...,"requiereSesion":true,"sesion":false}
```

Si el 401 no aparece y sale la respuesta del modelo, a ese servicio le faltan
las `NEXT_PUBLIC_SUPABASE_*`: sus rutas de IA están abiertas al mundo.

### Qué NO protege esto

- **No hay límite de gasto por usuario ni por IP.** Cualquiera con cuenta en
  tu proyecto de Supabase puede llamar tantas veces como quiera, y la factura
  es tuya. Si dejas el registro abierto en Supabase, esto es una puerta con
  cerradura y la llave puesta: cualquiera se crea una cuenta. Para un
  despliegue personal, ten el registro cerrado (Authentication → Providers →
  *Allow new users to sign up* desactivado) o restringido a tu dominio.
- No es un cortafuegos: quien tenga una sesión válida sigue pudiendo abusar.
  Un contador por usuario y ventana de tiempo está pendiente.
- No cambia quién ve qué datos: eso lo sigue decidiendo la RLS.

---

## 1. Supabase

1. Crear el proyecto. Región cercana a los usuarios (Europa).
2. Aplicar las migraciones **en orden**, desde `db/migrations/`:
   - `0001_esquema_inicial.sql`
   - `0002_storage_audio.sql`
   - `0003_*.sql` y siguientes, por número
   Con la CLI (`supabase db push`) o pegándolas en el SQL editor.
   Son idempotentes: reaplicarlas no rompe nada.
   **Nunca apliques nada de `db/pruebas/`**: es un andamiaje para simular
   Supabase en un Postgres local y sobrescribiría objetos del sistema.
3. **Authentication → URL Configuration**
   - *Site URL*: el dominio público de Netlify.
   - *Redirect URLs*: `https://TU-DOMINIO/auth/callback` y
     `http://localhost:3000/auth/callback`.
4. **Authentication → Providers**: Email activado. Google, si se quiere, con
   su Client ID/Secret; en Google Cloud hay que registrar la *Authorized
   redirect URI* que da Supabase (`https://<proyecto>.supabase.co/auth/v1/callback`).
5. **Project Settings → API**: copiar *Project URL* y la clave *anon*.
6. Si quieres los avisos push, hay un tercer servicio (un cron en Railway) con
   su propia configuración: `docs/avisos.md`.

### Comprobación

En el SQL editor, `select * from perfiles;` debe devolver cero filas sin
error. Tras crear una cuenta desde la app, una fila.

---

## 2. Railway

1. Nuevo proyecto desde el repositorio, rama de trabajo.
2. Variables: `ANTHROPIC_API_KEY`, las dos `NEXT_PUBLIC_SUPABASE_*`
   —las mismas que en Netlify: son las que hacen que las rutas de IA solo
   atiendan a quien ha iniciado sesión—, `ORIGENES_PERMITIDOS` con el dominio
   de Netlify. `NEXT_PUBLIC_IA_URL` se deja **sin definir**.
3. Generar dominio público.

`railway.json` ya fija el builder, los comandos y un healthcheck sobre
`/api/ai/estado`, que responde 200 incluso sin clave de Anthropic.

`next start` lee `PORT` de forma nativa, así que no hay que configurar nada.

### Comprobación

```
curl https://TU-APP.up.railway.app/api/ai/estado
# {"disponible":true,"modelo":"claude-opus-5"}
```

`"disponible": false` significa que falta `ANTHROPIC_API_KEY`.

---

## 3. Netlify

1. Nuevo sitio desde el mismo repositorio.
2. Variables: las dos `NEXT_PUBLIC_SUPABASE_*` y `NEXT_PUBLIC_IA_URL` con la
   URL de Railway **sin barra final**.
   `ANTHROPIC_API_KEY` **no** hace falta aquí.
3. Desplegar. `netlify.toml` ya trae el comando, la versión de Node y el
   plugin de Next.

Si el dominio de Netlify cambia, hay que actualizar `ORIGENES_PERMITIDOS` en
Railway **y volver a desplegar Railway**.

---

## Comprobación final

Desde el dominio de Netlify:

1. La app carga y el mural se ve.
2. Crear cuenta y entrar. En Supabase aparece la fila en `perfiles`.
3. Dar de alta un tema, cronometrar un minuto, cantarlo.
4. Abrir el chat del preparador y escribir algo: **debe responder en
   streaming, sin cortarse**. Si da error de CORS en la consola,
   `ORIGENES_PERMITIDOS` en Railway no incluye el dominio de Netlify.
5. Recargar: los datos siguen ahí.

---

## Qué esperar

- **Sin `ANTHROPIC_API_KEY`** la app funciona entera; los botones de IA lo
  avisan en pantalla.
- **Sin `TRANSCRIPCION_API_KEY`** el cante se graba, se guarda y se escucha
  igual; solo se apagan transcribir y comparar, diciendo por qué.
- **Sin credenciales de Supabase** la app funciona entera en local, sin
  login ni sincronización. Las grabaciones se quedan en el navegador, y las
  rutas de IA quedan **abiertas** a quien sepa la URL: es lo correcto en
  local o para un despliegue de un solo opositor, y una mala idea en un
  dominio público con clave de Anthropic puesta.
- **Con Supabase configurado y sin sesión iniciada** la app funciona entera
  menos la IA, y lo avisa antes de dejar pulsar: "Inicia sesión para usar el
  preparador".
- Ninguna pantalla queda detrás de una guarda de sesión.

---

## Problemas típicos

| Síntoma | Causa |
|---|---|
| El chat se corta a media frase | Se está llamando a Netlify en vez de a Railway: `NEXT_PUBLIC_IA_URL` mal puesta o declarada después de compilar |
| Error de CORS en la consola | `ORIGENES_PERMITIDOS` en Railway no incluye el dominio de Netlify |
| Los botones de IA salen apagados | Falta `ANTHROPIC_API_KEY` en Railway, o `NEXT_PUBLIC_IA_URL` apunta a un sitio que no responde |
| Todas las llamadas de IA dan 401 `sin_sesion` estando dentro | Netlify y Railway apuntan a proyectos de Supabase distintos, o Railway se compiló sin las `NEXT_PUBLIC_SUPABASE_*` y luego se añadieron. Compruébalo con `curl .../api/ai/estado -H "Authorization: Bearer <token>"`: `requiereSesion` y `sesion` tienen que ser los dos `true` |
| La IA dice "Inicia sesión para usar el preparador" y sí has entrado | La sesión caducó y el navegador no la ha renovado: recarga. Si persiste, el reloj del servidor o el proyecto de Supabase no coinciden |
| No aparece el bloque de sesión | Faltan las `NEXT_PUBLIC_SUPABASE_*`, o se declararon después de compilar |
| No sale la casilla de grabar el cante | El navegador no soporta `MediaRecorder`, o la página no se sirve por HTTPS (fuera de `localhost`, `getUserMedia` exige contexto seguro) |
| «Permissions policy violation: microphone» en consola | Un proxy o CDN delante está reescribiendo la cabecera `Permissions-Policy`. La app la manda como `microphone=(self)` desde `next.config.ts` |
| El audio no sube a Supabase | Falta ejecutar `0002_storage_audio.sql`, o no hay sesión iniciada. El cante y su grabación siguen a salvo en local |
| Redirección fallida al entrar | La *Redirect URL* de Supabase no coincide exactamente con el dominio |

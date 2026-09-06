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
| **Railway** | El mismo build, actuando además de backend de IA | `ANTHROPIC_API_KEY`, `ORIGENES_PERMITIDOS` |
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
| `NEXT_PUBLIC_SUPABASE_URL` | sí | sí | **Se incrusta al compilar** |
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
2. Variables: `ANTHROPIC_API_KEY`, las dos `NEXT_PUBLIC_SUPABASE_*`,
   `ORIGENES_PERMITIDOS` con el dominio de Netlify.
   `NEXT_PUBLIC_IA_URL` se deja **sin definir**.
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
  login ni sincronización. Las grabaciones se quedan en el navegador.
- Ninguna pantalla queda detrás de una guarda de sesión.

---

## Problemas típicos

| Síntoma | Causa |
|---|---|
| El chat se corta a media frase | Se está llamando a Netlify en vez de a Railway: `NEXT_PUBLIC_IA_URL` mal puesta o declarada después de compilar |
| Error de CORS en la consola | `ORIGENES_PERMITIDOS` en Railway no incluye el dominio de Netlify |
| Los botones de IA salen apagados | Falta `ANTHROPIC_API_KEY` en Railway, o `NEXT_PUBLIC_IA_URL` apunta a un sitio que no responde |
| No aparece el bloque de sesión | Faltan las `NEXT_PUBLIC_SUPABASE_*`, o se declararon después de compilar |
| No sale la casilla de grabar el cante | El navegador no soporta `MediaRecorder`, o la página no se sirve por HTTPS (fuera de `localhost`, `getUserMedia` exige contexto seguro) |
| «Permissions policy violation: microphone» en consola | Un proxy o CDN delante está reescribiendo la cabecera `Permissions-Policy`. La app la manda como `microphone=(self)` desde `next.config.ts` |
| El audio no sube a Supabase | Falta ejecutar `0002_storage_audio.sql`, o no hay sesión iniciada. El cante y su grabación siguen a salvo en local |
| Redirección fallida al entrar | La *Redirect URL* de Supabase no coincide exactamente con el dominio |

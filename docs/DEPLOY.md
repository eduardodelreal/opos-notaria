# Despliegue: Netlify + Supabase

De cero a app en producción en unos 10 minutos.

---

## 1 · Supabase (backend)

### 1.1 Crear el proyecto

[app.supabase.com](https://app.supabase.com) → **New project**. Elige región
`eu-west` (Irlanda) o `eu-central`: los usuarios están en España y el RGPD lo
agradece.

### 1.2 Ejecutar el esquema

**SQL Editor** → **New query** → pega el contenido completo de
[`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql) → **Run**.

Esto crea:

- Tablas `perfiles`, `bloques`, `temas`, `progreso`, `cantes`, `sesiones`, `tareas`, `simulacros`.
- **RLS activado** en todas: cada usuario solo ve sus filas.
- Trigger que crea el perfil al registrarse.
- Bucket privado `cantes` para los audios, con políticas por carpeta de usuario.
- Dos vistas de consulta (`v_resumen_usuario`, `v_cantes_semana`).

Es idempotente: puedes volver a ejecutarlo sin romper datos.

### 1.3 Configurar Auth

**Authentication → Providers → Email**:

- `Enable email provider`: ✅
- `Confirm email`: apágalo mientras desarrollas (te ahorra ir al correo en cada prueba). Enciéndelo antes de abrir la app a desconocidos.

**Authentication → URL Configuration**:

- `Site URL`: la URL de Netlify (p. ej. `https://cante-notarias.netlify.app`)
- `Redirect URLs`: añade `http://localhost:5173/**` y `https://TU-SITIO.netlify.app/**`

### 1.4 Copiar las claves

**Project Settings → API**:

| Clave | Dónde va |
|-------|----------|
| `Project URL` | `VITE_SUPABASE_URL` |
| `anon` `public` | `VITE_SUPABASE_ANON_KEY` |
| `service_role` | **Solo en tu terminal**, para el script de seed. Nunca en Netlify con prefijo `VITE_`, nunca en el repo. |

> La `anon key` es pública por diseño: va en el JS del navegador y lo que protege
> los datos es RLS, no el secreto de la clave. La `service_role` salta RLS: trátala
> como una contraseña de root.

---

## 2 · Netlify (frontend)

### Opción A — desde la interfaz web

1. [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project** → GitHub → `eduardodelreal/opos-notaria`.
2. Netlify lee `netlify.toml`, así que build command y publish directory ya vienen puestos (`npm run build` → `dist`). No toques nada.
3. **Site configuration → Environment variables** → añade:

   ```
   VITE_SUPABASE_URL       = https://xxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY  = eyJhbGciOi...
   ```

4. **Deploy site**. Si añadiste las variables después del primer deploy, lanza
   **Trigger deploy → Clear cache and deploy site** (Vite inyecta las `VITE_*` en
   tiempo de *build*, no de ejecución: sin rebuild no se aplican).

### Opción B — desde la terminal

```bash
npm i -g netlify-cli
netlify login
netlify init                      # enlaza el repo, detecta netlify.toml
netlify env:set VITE_SUPABASE_URL "https://xxxxxxxx.supabase.co"
netlify env:set VITE_SUPABASE_ANON_KEY "eyJhbGciOi..."
netlify deploy --build --prod
```

### Qué hace `netlify.toml`

- `command = "npm run build"` · `publish = "dist"`
- **Redirect SPA**: `/*  →  /index.html  200`. Sin esto, entrar directamente en
  `/temario` o recargar la página da un 404. Es el error número uno al desplegar
  una SPA en Netlify.
- Cabeceras de seguridad y `Permissions-Policy: microphone=(self)` — necesario para
  que funcione la grabación del cante.
- Cache inmutable para `/assets/*` (los nombres llevan hash).

---

## 3 · Crear tu usuario de prueba

Crea tu cuenta **vacía**, que es como debe empezar la app:

```bash
SUPABASE_URL="https://xxxxxxxx.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOi...service_role..." \
DEMO_EMAIL="tu@email.com" \
DEMO_PASSWORD="UnaClaveSegura123" \
node scripts/seed-demo.mjs
```

Al entrar, la pantalla de bienvenida te pedirá nombre, oposición, convocatoria y
ritmo, y ya podrás crear tus materias y meter tus primeros temas.

Variantes:

```bash
DEMO=1  ... node scripts/seed-demo.mjs   # siembra datos FICTICIOS para ver las
                                         # pantallas llenas (usa otro email)
RESET=1 ... node scripts/seed-demo.mjs   # borra sus datos antes de empezar
```

> `DEMO=1` inventa ~530 cantes y ~750 h de estudio. Sirve para hacerte una idea de
> cómo se ve la app con recorrido, pero no lo lances sobre tu cuenta real: acabarías
> con métricas mezcladas y sin saber cuáles son tuyas.

El script es idempotente: si el email ya existe, actualiza la contraseña y
resiembra en lugar de fallar.

---

## 4 · Comprobaciones después del deploy

| Comprobación | Cómo | Si falla |
|---|---|---|
| La app carga | Abre la URL de Netlify | Mira el *deploy log* en Netlify |
| Hay backend | Ajustes → debe decir «Supabase», no «Local» | Faltan las `VITE_*` o falta rebuild |
| Login funciona | Entra con el usuario del seed | Revisa `Site URL` y `Redirect URLs` en Supabase |
| Bienvenida sale | Al primer login pide nombre y ritmo | Si no sale, ese usuario ya tenía `configurado: true` |
| Temario propio | Temario → «Pegar lista» y pega 3 líneas | Comprueba que existen las tablas `bloques` y `temas` |
| Rutas directas | Abre `TU-SITIO/metricas` en una pestaña nueva | Falta el redirect SPA de `netlify.toml` |
| RLS activo | SQL Editor: `select * from progreso;` con la anon key debe devolver solo lo tuyo | Reejecuta la migración |
| Micrófono | Cantar → «Empezar el cante» | Necesita HTTPS (Netlify ya lo da) y permiso del navegador |
| Audio en la nube | Canta un tema y pulsa «▸ Audio» en la ficha | Comprueba que existe el bucket `cantes` |

---

## 5 · Railway (opcional, aún no necesario)

La app es una SPA estática: **no hace falta servidor**. Supabase cubre base de
datos, auth y storage.

Railway entra en juego cuando aparezca algo que no puede vivir en el navegador:

- **Transcripción de cantes con Whisper** — un worker que consume una cola de audios.
- **Emails transaccionales** — resumen semanal de progreso.
- **Panel del preparador** con agregaciones pesadas entre muchos alumnos.
- **Cron de recordatorios** de temas vencidos.

Cuando llegue el momento: servicio Node en Railway, hablando con Supabase mediante
`service_role` (nunca expuesta al cliente), y la SPA llamándolo por HTTPS.

---

## 6 · Desarrollo en local

```bash
npm install
cp .env.example .env.local     # rellena con tus claves de Supabase
npm run dev                    # http://localhost:5173
```

Sin `.env.local` la app arranca en **modo local**: todo se guarda en el
`localStorage` del navegador y los audios en IndexedDB. Perfecto para desarrollar
la interfaz sin tocar el backend.

```bash
npm run build        # tsc + vite build
npm run preview      # sirve dist/ como en producción
npm run typecheck    # solo tipos
```

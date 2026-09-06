# Base de datos

Esquema Postgres/Supabase que sirve de fuente de verdad duradera para la app.
El modelo de sincronización (por qué local-first, push/pull, conflictos,
borrados) está en [`docs/sincronizacion.md`](../docs/sincronizacion.md).

## Migraciones

Se aplican **en orden numérico** y son idempotentes: se pueden reaplicar enteras
sobre una base ya migrada sin romper nada.

| Archivo | Qué hace |
| --- | --- |
| `migrations/0001_esquema_inicial.sql` | Tablas, triggers de `updated_at` y de borrado en cascada lógica, índices, RLS y alta automática de perfil. |
| `migrations/0002_storage_audio.sql` | Bucket privado `cantes-audio` y políticas de Storage. |

`0002` no depende de `0001`, pero aplícalos igualmente en orden.

## Aplicar con la CLI de Supabase

```bash
supabase link --project-ref <project-ref>   # una sola vez
supabase db push
```

`supabase db push` aplica todo lo que haya en `supabase/migrations`. Si el
proyecto no tiene aún esa carpeta, enlaza los ficheros o cópialos con el prefijo
de fecha que espera la CLI:

```bash
mkdir -p supabase/migrations
cp db/migrations/0001_esquema_inicial.sql supabase/migrations/20250101000001_esquema_inicial.sql
cp db/migrations/0002_storage_audio.sql   supabase/migrations/20250101000002_storage_audio.sql
supabase db push
```

Para probar en local antes de tocar producción:

```bash
supabase start
supabase db reset          # recrea la base y reaplica todas las migraciones
```

## Alternativa: SQL editor

Si no quieres CLI, en el panel de Supabase → **SQL Editor**:

1. Pega el contenido íntegro de `0001_esquema_inicial.sql` y ejecuta.
2. Pega el contenido íntegro de `0002_storage_audio.sql` y ejecuta.

`0002` toca `storage.objects` y `storage.buckets`, que necesitan un rol
privilegiado: desde el SQL editor funciona; desde un cliente con la clave `anon`
no. Si da error de permisos, es que lo estás ejecutando con el rol equivocado.

## Comprobación rápida

Tras aplicar, con un usuario autenticado:

```sql
-- deben salir las 10 tablas, todas con rowsecurity = true
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;

-- ninguna tabla debe tener política de DELETE: el borrado es lógico
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and cmd = 'DELETE';   -- 0 filas
```

## Convenciones

- Nombres de tablas y columnas en español (`progreso_temas`, `con_preparador`),
  igual que el modelo de dominio en `lib/data/types.ts`.
- Excepción deliberada: `updated_at` y `deleted_at` mantienen el nombre inglés
  por ser el contrato de sincronización, y `creado_at` los acompaña por simetría.
- Los `id` los genera **el cliente** (uuid v4). Los `default gen_random_uuid()`
  solo son red de seguridad para inserciones a mano desde el editor.

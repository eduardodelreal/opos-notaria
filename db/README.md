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
| `migrations/0003_vueltas_y_avisos.sql` | Tabla `vueltas` (append-only, sustituye al contador de `progreso_temas`), `suscripciones_aviso` para el Web Push y las preferencias de aviso en `perfiles`. |

`0002` no depende de `0001`, pero aplícalos igualmente en orden. `0003` sí
depende: reutiliza `tocar_updated_at()` y **redefine** `cascada_borrado_tema()`
para meter las vueltas en la cascada, así que reaplicar `0001` a solas deja las
vueltas fuera del borrado en cascada hasta que se vuelva a aplicar `0003`.

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
cp db/migrations/0003_vueltas_y_avisos.sql supabase/migrations/20250101000003_vueltas_y_avisos.sql
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
3. Pega el contenido íntegro de `0003_vueltas_y_avisos.sql` y ejecuta.

`0002` toca `storage.objects` y `storage.buckets`, que necesitan un rol
privilegiado: desde el SQL editor funciona; desde un cliente con la clave `anon`
no. Si da error de permisos, es que lo estás ejecutando con el rol equivocado.

## Comprobación rápida

Tras aplicar, con un usuario autenticado:

```sql
-- deben salir las 12 tablas, todas con rowsecurity = true
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;

-- ninguna tabla debe tener política de DELETE: el borrado es lógico
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and cmd = 'DELETE';   -- 0 filas
```

## Probar en local, sin Supabase

Las migraciones se pueden aplicar y ejercitar contra un PostgreSQL corriente:

```bash
./db/pruebas/ejecutar.sh
```

Recrea una base local desechable, monta el andamiaje mínimo que en Supabase ya
viene de fábrica (esquema `auth`, esquema `storage`, roles `anon`/
`authenticated`/`service_role`), aplica las migraciones dos veces —así se
comprueba la idempotencia— y corre una batería que verifica el
**comportamiento**, no solo que el SQL pase: aislamiento real entre dos usuarios,
arbitraje last-write-wins, cascada del borrado lógico, imposibilidad del
`DELETE` y uso efectivo de los índices de pull. Detalles en
[`pruebas/README.md`](pruebas/README.md).

`db/pruebas/` **no** es una migración y nunca debe aplicarse a un proyecto de
Supabase.

## Límites conocidos

- **Las claves ajenas no ven la RLS.** Un usuario puede insertar una fila SUYA
  (`epigrafes`, `keypoints`, `notas`, `cantes`...) apuntando con `tema_id` al
  uuid de un tema de otro usuario: la FK valida sin RLS y el `with check` solo
  mira `usuario_id`. No expone ningún dato ajeno (no puede leer ese tema, ni
  aparece nada en el pull del otro) y hay que conocer un uuid v4 para intentarlo,
  pero deja basura enlazada. Si algún día molesta, se cierra con un trigger que
  compruebe que el padre es del mismo `usuario_id`.
- `file_size_limit` y `allowed_mime_types` del bucket los aplica el servicio de
  Storage, no la base de datos: una escritura directa en `storage.objects` no
  los respeta.
- De los avisos, `0003` solo pone el almacén. El envío no existe todavía: ni las
  claves VAPID, ni el proceso programado que cruza `perfiles.aviso_hora` con
  `suscripciones_aviso`, ni quien marque `caducada_at` cuando el servicio push
  responda 404/410. Y la hora del aviso es hora LOCAL: hay que resolverla contra
  `suscripciones_aviso.zona_horaria`, que es por dispositivo.

## Convenciones

- Nombres de tablas y columnas en español (`progreso_temas`, `con_preparador`),
  igual que el modelo de dominio en `lib/data/types.ts`.
- Excepción deliberada: `updated_at` y `deleted_at` mantienen el nombre inglés
  por ser el contrato de sincronización, y `creado_at` los acompaña por simetría.
- Los `id` los genera **el cliente** (uuid v4). Los `default gen_random_uuid()`
  solo son red de seguridad para inserciones a mano desde el editor.

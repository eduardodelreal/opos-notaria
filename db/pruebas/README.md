# Pruebas locales del esquema

Aplica las migraciones de `db/migrations/` contra un **PostgreSQL local** y
comprueba que el esquema se comporta como dice la documentación: la RLS aísla de
verdad, el arbitraje last-write-wins funciona, el borrado lógico cascadea, el
`DELETE` físico es imposible y los índices de pull se usan.

> **Nada de esto se aplica nunca a Supabase.** `andamiaje.sql` y `pruebas.sql`
> viven fuera de `db/migrations/`, así que `supabase db push` no los mira.

## Lanzar

```bash
./db/pruebas/ejecutar.sh
```

Necesita un Postgres 13+ corriendo y un `psql` que pueda crear bases de datos
(superusuario, o al menos `CREATEDB` + `CREATEROLE`). El script:

1. **destruye y recrea** la base `opos_test`,
2. aplica `andamiaje.sql`,
3. aplica todas las migraciones en orden,
4. las vuelve a aplicar (prueba de idempotencia),
5. ejecuta `pruebas.sql` y sale con código ≠ 0 si algo falla.

Variables opcionales: `PGDATABASE_TEST` (nombre de la base, por defecto
`opos_test`) y `PSQL` (cómo invocar psql). Se aplican también las de siempre:
`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`.

En un contenedor Debian/Ubuntu con el paquete `postgresql`:

```bash
apt-get install -y postgresql
pg_ctlcluster 16 main start        # o: service postgresql start
su postgres -c '/ruta/al/repo/db/pruebas/ejecutar.sh'
```

## Qué hay aquí

| Archivo | Qué es |
| --- | --- |
| `andamiaje.sql` | Imitación mínima de lo que Supabase da hecho: roles `anon`/`authenticated`/`service_role`, esquema `auth` con `auth.users` y `auth.uid()`, esquema `storage` con `buckets`, `objects` y `foldername()`, `pgcrypto` y los grants de `public`. **No aplicar jamás en Supabase**, donde todo eso ya existe. |
| `pruebas.sql` | La batería. Deja una fila por comprobación en `pruebas.resultados`. |
| `ejecutar.sh` | El orquestador. |

## Cómo se simula a Supabase

`auth.uid()` lee el `sub` del JWT que PostgREST deja en un GUC. Una petición de
un usuario logueado se imita así:

```sql
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111"}';
  -- ...aquí la RLS ya está activa y auth.uid() devuelve ese uuid
commit;
```

El rol de la sesión (`postgres`) es el dueño de las tablas y **se salta la
RLS**, igual que la `service_role` en Supabase: si una prueba se olvida el
`set local role authenticated`, no prueba nada. Por eso `pruebas.sql` cambia de
rol con los ayudantes `pruebas.como(uid)` y `pruebas.servidor()`.

## Añadir una comprobación

Dentro de un bloque `do $$ ... $$`:

```sql
perform pruebas.comprobar('bloque', 'lo que se afirma', <condicion booleana>, 'detalle');
```

Para algo que **debe** ser rechazado por la RLS:

```sql
perform pruebas.comprobar('rls', 'A no puede X',
  pruebas.rechazado('insert into ...'),   -- true si falla con SQLSTATE 42501
  'esperado SQLSTATE 42501');
```

Una prueba que no falla cuando rompes a propósito lo que dice comprobar no vale
nada: al añadir una, cámbiale el signo a la lógica de la migración y comprueba
que se pone en rojo.

## Lo que estas pruebas NO cubren

- El `auth.users` del andamiaje tiene 4 columnas de las ~35 reales, y el
  `storage.objects` no valida tamaños ni MIME: `file_size_limit` y
  `allowed_mime_types` del bucket los aplica el servicio de Storage de Supabase,
  no la base de datos. Que el bucket los tenga bien puestos sí se comprueba;
  que se respeten, no.
- Los permisos reales de Supabase sobre `auth.users` y `storage.objects` (crear
  el trigger `al_crear_usuario`, crear políticas). Aquí se corre como
  superusuario, así que todo está permitido; en Supabase depende del rol.
- La RLS de `storage.buckets` (en Supabase está activada y no hay política, así
  que un cliente no lista buckets; aquí no se reproduce).

-- ============================================================================
-- ANDAMIAJE PARA PRUEBAS LOCALES  ·  NO APLICAR NUNCA EN SUPABASE
-- ============================================================================
--
--   ⚠️  ESTE FICHERO NO ES UNA MIGRACIÓN Y NO DEBE EJECUTARSE JAMÁS CONTRA UN
--       PROYECTO DE SUPABASE (ni de producción, ni de staging, ni de desarrollo).
--
-- Vive fuera de db/migrations/ a propósito: `supabase db push` no lo mira.
--
-- Por qué existe: las migraciones de db/migrations/ dan por supuesto un montón
-- de cosas que en Supabase ya vienen de fábrica y que un PostgreSQL desnudo no
-- tiene:
--
--   · los roles anon / authenticated / service_role
--   · el esquema auth, con auth.users y auth.uid()
--   · el esquema storage, con storage.buckets, storage.objects y
--     storage.foldername()
--   · los GRANT por defecto del esquema public hacia esos roles
--
-- En Supabase todo eso ya existe y lo gestiona la plataforma. Recrearlo allí
-- iría de romper el gestor de identidades a destruir el índice de ficheros de
-- Storage. Aquí solo reproducimos lo MÍNIMO e IMPRESCINDIBLE para poder aplicar
-- y ejercitar las migraciones contra un Postgres de verdad.
--
-- Es una imitación, no la cosa real: auth.users tiene cuatro columnas de las
-- treinta y tantas que tiene la de Supabase, y storage.objects no valida nada.
-- Basta para lo que se prueba aquí (RLS, triggers, índices, políticas).
--
-- Uso:  psql -d opos_test -f db/pruebas/andamiaje.sql
-- ============================================================================

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------- roles ------
-- Supabase los trae creados. `authenticated` es el rol con el que corre
-- cualquier petición de un usuario logueado a través de PostgREST.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

-- ---------------------------------------------------------------- auth ------
create schema if not exists auth;

-- Recorte de auth.users: solo lo que tocan las migraciones (la PK a la que
-- apuntan todas las FK, y raw_user_meta_data que lee public.crear_perfil()).
create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- Copia fiel de la de Supabase: lee el "sub" del JWT que PostgREST deja en el
-- GUC request.jwt.claims. En las pruebas se simula con
--   set local request.jwt.claims = '{"sub":"<uuid>"}';
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.role', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
    ),
    ''
  )::text;
$$;

grant usage on schema auth to anon, authenticated, service_role;

-- ------------------------------------------------------------- storage ------
create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets (id),
  name             text,
  owner            uuid,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata         jsonb,
  constraint objects_bucketid_name_unique unique (bucket_id, name)
);

-- La RLS de storage.objects viene activada de fábrica en Supabase; 0002 cuenta
-- con ello y no la activa.
alter table storage.objects enable row level security;

-- Implementación real de Supabase: trocea la ruta por "/" y devuelve todo menos
-- el último segmento. Para '<uid>/<cante>.webm' devuelve {'<uid>'}.
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end;
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;

-- ------------------------------------------------- grants del esquema public --
-- Supabase concede a anon/authenticated/service_role sobre todo lo que se cree
-- en public (privilegios por defecto + grant retroactivo). Sin esto la RLS ni
-- se llegaría a evaluar: fallaría antes por permiso de tabla.
grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

-- ============================================================================
--  Cante · Oposición a Notarías — esquema inicial
--  Ejecutar en Supabase → SQL Editor (o `supabase db push`).
--  Idempotente: se puede volver a ejecutar sin romper nada.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- perfiles --
-- Un registro por usuario. `ajustes` es jsonb porque son preferencias de UI
-- que evolucionan rápido y no se consultan por columnas.
create table if not exists public.perfiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  ajustes       jsonb       not null default '{}'::jsonb,
  dias_cumplidos text[]     not null default '{}',
  logros        text[]      not null default '{}',
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------- bloques --
-- Las materias las crea el opositor: la app no impone ningún programa.
create table if not exists public.bloques (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  bloque_id  text not null,
  nombre     text not null,
  ejercicio  smallint not null default 1 check (ejercicio between 1 and 4),
  color      text not null default '#517C5E',
  color_soft text not null default '#DFE8E1',
  color_text text not null default '#293F30',
  orden      integer not null default 0,
  creado_en  timestamptz not null default now(),
  unique (user_id, bloque_id)
);

create index if not exists bloques_user_orden_idx on public.bloques (user_id, orden);

-- ------------------------------------------------------------------ temas --
-- Todos los temas son del usuario. Los va añadiendo según se los dan en la
-- academia: uno a uno, pegando una lista o cargando una plantilla opcional.
-- Migración desde el esquema anterior, por si la v1 ya se ejecutó.
do $$
begin
  if to_regclass('public.temas_usuario') is not null
     and to_regclass('public.temas') is null then
    alter table public.temas_usuario rename to temas;
    alter table public.temas rename column bloque to bloque_id;
    alter table public.temas drop column if exists custom;
  end if;
end $$;

create table if not exists public.temas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  tema_id    text not null,
  bloque_id  text not null,
  numero     integer not null default 1,
  titulo     text not null,
  excluido   boolean not null default false,
  epigrafes  text[],
  creado_en  timestamptz not null default now(),
  unique (user_id, tema_id)
);

create index if not exists temas_user_bloque_idx on public.temas (user_id, bloque_id, numero);

-- ---------------------------------------------------------------- progreso --
create table if not exists public.progreso (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  tema_id          text not null,
  estado           text not null default 'no_tocado'
                     check (estado in ('no_tocado','primera_vuelta','en_arrastre','dominado','oxidado')),
  vueltas          integer not null default 0 check (vueltas >= 0),
  intervalo        integer not null default 0 check (intervalo >= 0),
  facilidad        numeric(4,2) not null default 2.20,
  ultimo_cante     date,
  proxima_revision date,
  nota_media       numeric(4,2) check (nota_media is null or (nota_media >= 0 and nota_media <= 10)),
  minutos_estudio  integer not null default 0 check (minutos_estudio >= 0),
  prioritario      boolean not null default false,
  notas            text,
  actualizado_en   timestamptz not null default now(),
  unique (user_id, tema_id)
);

create index if not exists progreso_user_revision_idx
  on public.progreso (user_id, proxima_revision);
create index if not exists progreso_user_estado_idx
  on public.progreso (user_id, estado);

-- ----------------------------------------------------------------- cantes ---
create table if not exists public.cantes (
  id                text primary key,
  user_id           uuid not null references auth.users (id) on delete cascade,
  tema_id           text not null,
  fecha             timestamptz not null default now(),
  duracion_segundos integer not null check (duracion_segundos >= 0),
  objetivo_segundos integer not null check (objetivo_segundos > 0),
  calificacion      smallint not null check (calificacion between 1 and 5),
  nota              numeric(4,2) not null check (nota >= 0 and nota <= 10),
  lagunas           integer not null default 0 check (lagunas >= 0),
  ante_preparador   boolean not null default false,
  comentarios       text,
  audio_path        text,
  audio_duracion    integer,
  simulacro_id      text,
  creado_en         timestamptz not null default now()
);

create index if not exists cantes_user_fecha_idx on public.cantes (user_id, fecha desc);
create index if not exists cantes_user_tema_idx  on public.cantes (user_id, tema_id);

-- --------------------------------------------------------------- sesiones ---
create table if not exists public.sesiones (
  id        text primary key,
  user_id   uuid not null references auth.users (id) on delete cascade,
  tema_id   text,
  fecha     timestamptz not null default now(),
  minutos   integer not null check (minutos > 0),
  tipo      text not null default 'otro'
              check (tipo in ('lectura','esquema','memorizacion','dictamen','otro')),
  notas     text,
  creado_en timestamptz not null default now()
);

create index if not exists sesiones_user_fecha_idx on public.sesiones (user_id, fecha desc);

-- ----------------------------------------------------------------- tareas ---
-- `recurrencia` es jsonb: la forma de la regla cambia según el tipo
-- (diaria / semanal con días / mensual con día del mes / laborables).
create table if not exists public.tareas (
  id             text primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  titulo         text not null,
  fecha          date not null,
  hora           text,
  duracion_estim integer,
  recurrencia    jsonb not null default '{"tipo":"ninguna"}'::jsonb,
  hasta          date,
  categoria      text not null default 'estudio'
                   check (categoria in ('cante','estudio','dictamen','repaso','preparador','personal')),
  tema_id        text,
  bloque_id      text,
  color          text,
  notas          text,
  completadas    text[] not null default '{}',
  saltadas       text[] not null default '{}',
  archivada      boolean not null default false,
  creado_en      timestamptz not null default now()
);

create index if not exists tareas_user_fecha_idx on public.tareas (user_id, fecha);

-- ------------------------------------------------------------- simulacros ---
create table if not exists public.simulacros (
  id             text primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  fecha          timestamptz not null default now(),
  tema_ids       text[] not null default '{}',
  duracion_total integer not null default 0,
  nota_media     numeric(4,2) not null default 0,
  completado     boolean not null default false,
  creado_en      timestamptz not null default now()
);

create index if not exists simulacros_user_fecha_idx on public.simulacros (user_id, fecha desc);

-- ============================================================================
--  Row Level Security: cada opositor solo ve sus datos.
-- ============================================================================

alter table public.perfiles      enable row level security;
alter table public.bloques      enable row level security;
alter table public.temas        enable row level security;
alter table public.progreso      enable row level security;
alter table public.cantes        enable row level security;
alter table public.sesiones      enable row level security;
alter table public.tareas        enable row level security;
alter table public.simulacros    enable row level security;

-- perfiles: la clave primaria ES el user id.
drop policy if exists "perfiles propios" on public.perfiles;
create policy "perfiles propios" on public.perfiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- resto de tablas: mismo patrón sobre user_id.
do $$
declare t text;
begin
  foreach t in array array['bloques','temas','progreso','cantes','sesiones','tareas','simulacros']
  loop
    execute format('drop policy if exists "datos propios" on public.%I', t);
    execute format(
      'create policy "datos propios" on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t
    );
  end loop;
end $$;

-- ============================================================================
--  Perfil automático al registrarse
-- ============================================================================

create or replace function public.crear_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfiles (id, ajustes)
  values (
    new.id,
    jsonb_build_object('nombre', coalesce(new.raw_user_meta_data->>'nombre', 'Opositor'))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.crear_perfil();

-- ============================================================================
--  Storage: bucket privado para los audios de los cantes.
--  Ruta: <user_id>/<cante_id>.webm  →  la primera carpeta es el dueño.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cantes',
  'cantes',
  false,
  52428800, -- 50 MB por archivo
  array['audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "cantes lectura propia"     on storage.objects;
drop policy if exists "cantes subida propia"      on storage.objects;
drop policy if exists "cantes actualizacion propia" on storage.objects;
drop policy if exists "cantes borrado propio"     on storage.objects;

create policy "cantes lectura propia" on storage.objects
  for select using (
    bucket_id = 'cantes' and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "cantes subida propia" on storage.objects
  for insert with check (
    bucket_id = 'cantes' and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "cantes actualizacion propia" on storage.objects
  for update using (
    bucket_id = 'cantes' and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "cantes borrado propio" on storage.objects
  for delete using (
    bucket_id = 'cantes' and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================================
--  Vistas de consulta rápida (opcionales, útiles para depurar o para un
--  futuro panel del preparador).
-- ============================================================================

create or replace view public.v_resumen_usuario
with (security_invoker = true) as
select
  p.user_id,
  count(*)                                                as temas_con_progreso,
  count(*) filter (where p.estado = 'dominado')            as dominados,
  count(*) filter (where p.estado = 'oxidado')             as oxidados,
  count(*) filter (where p.proxima_revision <= current_date) as vencidos,
  round(avg(p.nota_media), 2)                             as nota_media_global,
  sum(p.minutos_estudio)                                  as minutos_estudio
from public.progreso p
group by p.user_id;

create or replace view public.v_cantes_semana
with (security_invoker = true) as
select
  c.user_id,
  date_trunc('week', c.fecha)::date as semana,
  count(*)                          as cantes,
  round(avg(c.nota), 2)             as nota_media,
  round(avg(c.duracion_segundos))   as duracion_media,
  count(*) filter (
    where c.duracion_segundos between (c.objetivo_segundos * 0.88) and (c.objetivo_segundos * 1.05)
  )                                 as en_tiempo
from public.cantes c
group by c.user_id, date_trunc('week', c.fecha);

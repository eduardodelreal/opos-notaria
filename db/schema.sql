-- ============================================================================
-- opos-notaria — esquema Postgres / Supabase
--
-- La app funciona hoy 100% en local (IndexedDB). Este esquema es el destino
-- de la sincronización: misma forma que el modelo de dominio de lib/data/types.ts,
-- con RLS para que cada opositor solo vea lo suyo.
--
-- Aplicar con:  supabase db push   (o pegándolo en el SQL editor)
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- perfiles --
create table if not exists perfiles (
  id                      uuid primary key references auth.users on delete cascade,
  nombre                  text        not null default '',
  oposicion               text        not null default 'notarias'
                          check (oposicion in ('notarias', 'registros', 'judicatura')),
  fecha_inicio            timestamptz not null default now(),
  fecha_examen            date,
  preparador              text,
  objetivo_horas_semana   int         not null default 45 check (objetivo_horas_semana between 1 and 120),
  minutos_por_tema        int         not null default 10 check (minutos_por_tema between 1 and 90),
  dias_oxido              int         not null default 45 check (dias_oxido between 7 and 365),
  tema                    text        not null default 'dark' check (tema in ('dark', 'light')),
  estilo_feedback         text        not null default 'directo'
                          check (estilo_feedback in ('directo', 'equilibrado', 'amable')),
  creado                  timestamptz not null default now()
);

-- --------------------------------------------------------------- materias --
create table if not exists materias (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references auth.users on delete cascade,
  nombre      text not null,
  abrev       text not null default '',
  color       text not null default '#c9a227',
  ejercicio   int  not null default 1 check (ejercicio between 1 and 4),
  descripcion text not null default '',
  orden       int  not null default 0
);
create index if not exists materias_usuario_idx on materias (usuario_id, orden);

-- ------------------------------------------------------------------ temas --
-- Los temas los da de alta el opositor: no hay programa precargado. El par
-- (materia, numero) no es único a propósito — hay convocatorias con bis.
create table if not exists temas (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references auth.users on delete cascade,
  materia_id  uuid not null references materias on delete cascade,
  numero      int  not null,
  titulo      text not null,
  creado      timestamptz not null default now()
);
create index if not exists temas_usuario_idx on temas (usuario_id, materia_id, numero);

-- -------------------------------------------------------------- epigrafes --
create table if not exists epigrafes (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references auth.users on delete cascade,
  tema_id     uuid not null references temas on delete cascade,
  orden       int  not null,
  titulo      text not null,
  texto       text
);
create index if not exists epigrafes_tema_idx on epigrafes (tema_id, orden);

-- ----------------------------------------------------------- progreso ------
create table if not exists progreso_temas (
  tema_id        uuid primary key references temas on delete cascade,
  usuario_id     uuid not null references auth.users on delete cascade,
  estado         text not null default 'nuevo'
                 check (estado in ('nuevo','estudiando','cantable','dominado','oxidado')),
  segundos       int  not null default 0,
  dificultad     int  not null default 3 check (dificultad between 1 and 5),
  vueltas        int  not null default 0,
  ultimo_estudio timestamptz,
  ultimo_cante   timestamptz,
  nota_media     numeric(3,1),
  proximo_repaso timestamptz,
  favorito       boolean not null default false
);
create index if not exists progreso_usuario_idx on progreso_temas (usuario_id, proximo_repaso);

-- ---------------------------------------------------------------- sesiones --
create table if not exists sesiones (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users on delete cascade,
  tema_id    uuid references temas on delete set null,
  tipo       text not null check (tipo in ('estudio','repaso','cante')),
  inicio     timestamptz not null,
  fin        timestamptz not null,
  segundos   int  not null check (segundos >= 0),
  nota       text
);
create index if not exists sesiones_usuario_idx on sesiones (usuario_id, inicio desc);

-- ------------------------------------------------------------------ cantes --
-- El desglose por epígrafe va en jsonb: es un documento inmutable que se
-- consulta entero y nunca se filtra por dentro.
create table if not exists cantes (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      uuid not null references auth.users on delete cascade,
  tema_id         uuid not null references temas on delete cascade,
  fecha           timestamptz not null default now(),
  segundos        int  not null check (segundos >= 0),
  epigrafes       jsonb not null default '[]'::jsonb,
  nota            numeric(3,1) check (nota between 0 and 10),
  con_preparador  boolean not null default false,
  feedback        text,
  analisis        jsonb,          -- conclusiones del modelo
  audio_path      text            -- storage: grabación del cante
);
create index if not exists cantes_usuario_idx on cantes (usuario_id, fecha desc);
create index if not exists cantes_tema_idx    on cantes (tema_id, fecha desc);

-- --------------------------------------------------------------- keypoints --
create table if not exists keypoints (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null references auth.users on delete cascade,
  tema_id        uuid not null references temas on delete cascade,
  epigrafe_id    uuid references epigrafes on delete set null,
  anverso        text not null,
  reverso        text not null,
  creado         timestamptz not null default now(),
  aciertos       int not null default 0,
  fallos         int not null default 0,
  intervalo_dias int not null default 1,
  proximo_repaso timestamptz not null default now()
);
create index if not exists keypoints_repaso_idx on keypoints (usuario_id, proximo_repaso);

-- ------------------------------------------------------------------- notas --
create table if not exists notas (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references auth.users on delete cascade,
  tema_id     uuid not null references temas on delete cascade,
  epigrafe_id uuid references epigrafes on delete set null,
  texto       text not null,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index if not exists notas_tema_idx on notas (tema_id, actualizado desc);

-- -------------------------------------------------------------- simulacros --
create table if not exists simulacros (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      uuid not null references auth.users on delete cascade,
  tipo            text not null check (tipo in ('cante','dictamen')),
  fecha           timestamptz not null default now(),
  tema_ids        uuid[] not null default '{}',
  minutos         int not null default 0,
  segundos_usados int not null default 0,
  notas           jsonb not null default '[]'::jsonb,
  supuesto        text,
  respuesta       text,
  correccion      text,
  completado      boolean not null default false
);
create index if not exists simulacros_usuario_idx on simulacros (usuario_id, fecha desc);

-- ============================================================================
-- Row Level Security: cada opositor solo ve y toca sus filas.
-- ============================================================================

alter table perfiles       enable row level security;
alter table materias       enable row level security;
alter table temas          enable row level security;
alter table epigrafes      enable row level security;
alter table progreso_temas enable row level security;
alter table sesiones       enable row level security;
alter table cantes         enable row level security;
alter table keypoints      enable row level security;
alter table notas          enable row level security;
alter table simulacros     enable row level security;

drop policy if exists "perfil propio" on perfiles;
create policy "perfil propio" on perfiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

do $$
declare t text;
begin
  foreach t in array array[
    'materias','temas','epigrafes','progreso_temas',
    'sesiones','cantes','keypoints','notas','simulacros'
  ] loop
    execute format('drop policy if exists "datos propios" on %I', t);
    execute format(
      'create policy "datos propios" on %I for all
         using (auth.uid() = usuario_id)
         with check (auth.uid() = usuario_id)', t);
  end loop;
end $$;

-- ============================================================================
-- Alta automática de perfil al registrarse.
-- ============================================================================

create or replace function public.crear_perfil()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.perfiles (id, nombre)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil();

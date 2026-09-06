-- ============================================================================
-- opos-notaria — 0001 · esquema inicial
--
-- Destino de la sincronización local-first. La app escribe primero en
-- IndexedDB y empuja después; este esquema es la fuente de verdad duradera.
-- La forma de las tablas sigue lib/data/types.ts, con RLS por opositor.
--
-- Tres invariantes que atraviesan todo el fichero:
--   · el id lo genera SIEMPRE el cliente (uuid v4). El default gen_random_uuid()
--     solo es red de seguridad para inserciones hechas a mano desde el editor.
--   · toda tabla lleva updated_at (pull incremental) y deleted_at (borrado
--     lógico). El cliente nunca hace DELETE físico: un DELETE no se propaga.
--   · resolución de conflictos last-write-wins por fila, arbitrada por el
--     servidor en el trigger tocar_updated_at().
--
-- Idempotente: se puede reaplicar entero sin miedo.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- 1 · Funciones comunes
-- ============================================================================

-- Mantiene updated_at y, de paso, arbitra el last-write-wins.
--
-- El cliente puede mandar su propio updated_at (lo necesita: una fila editada
-- offline el martes y subida el jueves debe conservar la marca del martes).
-- Si esa marca es ANTERIOR a la que ya hay en el servidor, la escritura ha
-- perdido el conflicto y se neutraliza devolviendo OLD: el UPDATE se ejecuta
-- pero reescribe la fila con los valores que ya tenía, así que los datos no
-- cambian y no se aborta la transacción. Se devuelve OLD y no NULL a propósito
-- — con OLD el RETURNING del upsert le entrega al cliente la fila GANADORA,
-- que puede adoptar en el acto sin esperar al siguiente pull; con NULL no
-- recibiría nada y no sabría distinguirlo de una fila inexistente.
--
-- Si el cliente NO manda updated_at, el servidor pone su reloj. Es el camino
-- preferible siempre que la escritura sea online, porque elimina la deriva de
-- relojes entre dispositivos.
--
-- Ese reloj del servidor, eso sí, NUNCA puede hacer retroceder el updated_at de
-- la fila. El cursor del pull incremental es "el updated_at máximo que me he
-- bajado" (docs/sincronizacion.md §3.2): si una escritura deja la fila con un
-- updated_at MENOR que el que otro dispositivo ya tiene como cursor, ese
-- dispositivo no vuelve a ver la fila nunca. Y pasa de verdad, no es teórico:
-- basta con que un móvil con el reloj adelantado haya insertado la fila con su
-- marca, y que la siguiente edición la haga otro dispositivo online. De ahí el
-- greatest(): en el caso normal (now() por delante) vale now() y no cambia
-- nada; en el caso patológico garantiza que la marca avanza igualmente. El
-- milisegundo extra es para que avance ESTRICTAMENTE, porque el cursor del
-- cliente compara con > y una marca repetida no se bajaría.
create or replace function public.tocar_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  if new.updated_at is distinct from old.updated_at then
    -- Estrictamente anterior. Si son iguales se deja pasar: dos escrituras en
    -- el mismo milisegundo son la misma intención, y descartar la segunda
    -- rompería el reintento idempotente del push.
    if new.updated_at < old.updated_at then
      return old;
    end if;
    return new;
  end if;

  new.updated_at := greatest(now(), old.updated_at + interval '1 millisecond');
  return new;
end;
$fn$;

-- Propaga el borrado lógico de un tema a todo lo que cuelga de él.
--
-- Se hace en el servidor y no solo en el cliente porque un dispositivo con la
-- app vieja, o que se quedó sin batería a mitad del borrado, dejaría epígrafes
-- y cantes huérfanos visibles en los demás dispositivos. Al tocar las filas
-- hijas su updated_at avanza, así que el pull incremental de los otros
-- dispositivos las recoge sin nada más.
--
-- Las SESIONES no se cascadean a propósito: son el registro de horas
-- efectivas del opositor y borrar un tema no significa no haberlo estudiado.
-- Su tema_id queda apuntando a un tema con deleted_at, y la app lo muestra
-- como "tema borrado" en el histórico.
create or replace function public.cascada_borrado_tema()
returns trigger
language plpgsql
as $fn$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.epigrafes      set deleted_at = new.deleted_at where tema_id = new.id and deleted_at is null;
    update public.progreso_temas set deleted_at = new.deleted_at where tema_id = new.id and deleted_at is null;
    update public.cantes         set deleted_at = new.deleted_at where tema_id = new.id and deleted_at is null;
    update public.keypoints      set deleted_at = new.deleted_at where tema_id = new.id and deleted_at is null;
    update public.notas          set deleted_at = new.deleted_at where tema_id = new.id and deleted_at is null;
  end if;
  return new;
end;
$fn$;

-- Igual para materias: borrar una materia arrastra sus temas, y el trigger de
-- temas encadena el resto. No hay ciclo posible.
create or replace function public.cascada_borrado_materia()
returns trigger
language plpgsql
as $fn$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.temas set deleted_at = new.deleted_at where materia_id = new.id and deleted_at is null;
  end if;
  return new;
end;
$fn$;

-- ============================================================================
-- 2 · Tablas
--
-- Convención de las tres columnas de sincronización, presentes en todas:
--   creado_at   informativo, no se toca nunca más
--   updated_at  reloj del last-write-wins y del pull incremental
--   deleted_at  tumba. null = fila viva. La app filtra deleted_at is null.
-- ============================================================================

-- ---------------------------------------------------------------- perfiles --
-- Comparte PK con auth.users: un opositor, un perfil. Es la única tabla sin
-- usuario_id; su RLS va contra id.
create table if not exists public.perfiles (
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
  tema                    text        not null default 'dark'    check (tema in ('dark', 'light')),
  estilo_feedback         text        not null default 'directo'
                          check (estilo_feedback in ('directo', 'equilibrado', 'amable')),
  creado_at               timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  -- Presente por uniformidad del contrato de sincronización; en la práctica no
  -- se usa: el perfil muere con la cuenta, vía el cascade de auth.users.
  deleted_at              timestamptz
);

-- --------------------------------------------------------------- materias --
-- Las cinco materias clásicas de Notarías las siembra el CLIENTE en el primer
-- arranque, no este esquema. Si las sembrase el servidor en el alta, un
-- usuario que ya hubiera trabajado offline acabaría con diez.
create table if not exists public.materias (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null default auth.uid() references auth.users on delete cascade,
  nombre      text not null,
  abrev       text not null default '',
  color       text not null default '#c9a227',
  ejercicio   int  not null default 1 check (ejercicio between 1 and 4),
  descripcion text not null default '',
  -- El orden de la lista de materias hoy es implícito (la posición en el array
  -- del store). Un array no sobrevive a una tabla, así que se materializa.
  orden       int  not null default 0,
  creado_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ------------------------------------------------------------------ temas --
-- Los temas los da de alta el opositor: no hay programa precargado. El par
-- (materia, numero) no es único a propósito — hay convocatorias con bis, y un
-- unique aquí convertiría un choque de numeración en un push que falla.
create table if not exists public.temas (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null default auth.uid() references auth.users on delete cascade,
  materia_id  uuid not null references public.materias on delete cascade,
  numero      int  not null,
  titulo      text not null,
  propio      boolean not null default true,
  creado_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- -------------------------------------------------------------- epigrafes --
-- En el cliente los epígrafes viven anidados dentro del tema (Tema.epigrafes).
-- Aquí son filas propias: si fuesen un jsonb del tema, editar un epígrafe en el
-- móvil y otro del mismo tema en el portátil daría un conflicto a nivel de tema
-- y una de las dos ediciones se perdería entera. Con filas, cada epígrafe tiene
-- su propio reloj y los conflictos casi desaparecen.
create table if not exists public.epigrafes (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null default auth.uid() references auth.users on delete cascade,
  tema_id     uuid not null references public.temas on delete cascade,
  orden       int  not null default 0,
  titulo      text not null,
  texto       text,
  creado_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- -------------------------------------------------------- progreso_temas --
-- Uno por tema, así que la PK natural es el tema y no hace falta id propio: el
-- cliente ya conoce ese uuid sin red, que es lo único que exigía la regla de
-- "los ids los genera el cliente".
--
-- Es la tabla más caliente y la única con conflicto real de verdad. Ver
-- docs/sincronizacion.md § "El problema de los contadores": segundos, vueltas y
-- nota_media son acumuladores y el last-write-wins los trunca.
create table if not exists public.progreso_temas (
  tema_id        uuid primary key references public.temas on delete cascade,
  usuario_id     uuid not null default auth.uid() references auth.users on delete cascade,
  estado         text not null default 'nuevo'
                 check (estado in ('nuevo','estudiando','cantable','dominado','oxidado')),
  segundos       int  not null default 0 check (segundos >= 0),
  dificultad     int  not null default 3 check (dificultad between 1 and 5),
  vueltas        int  not null default 0 check (vueltas >= 0),
  ultimo_estudio timestamptz,
  ultimo_cante   timestamptz,
  nota_media     numeric(3,1) check (nota_media between 0 and 10),
  proximo_repaso timestamptz,
  favorito       boolean not null default false,
  creado_at      timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

-- ---------------------------------------------------------------- sesiones --
-- Append-only. Una sesión cerrada no se vuelve a tocar nunca.
-- tema_id es nullable: se puede cronometrar estudio sin tema asignado.
create table if not exists public.sesiones (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid() references auth.users on delete cascade,
  tema_id    uuid references public.temas on delete set null,
  tipo       text not null check (tipo in ('estudio','repaso','cante')),
  inicio     timestamptz not null,
  fin        timestamptz not null,
  -- Segundos EFECTIVOS: descuentan pausas e inactividad, así que son bastante
  -- menores que fin - inicio. No es una columna derivable.
  segundos   int  not null check (segundos >= 0),
  nota       text,
  creado_at  timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ------------------------------------------------------------------ cantes --
create table if not exists public.cantes (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      uuid not null default auth.uid() references auth.users on delete cascade,
  tema_id         uuid not null references public.temas on delete cascade,
  fecha           timestamptz not null default now(),
  segundos        int  not null check (segundos >= 0),
  -- CanteEpigrafe[]: desglose por epígrafe con sus fallos. Va en jsonb y no en
  -- tabla hija porque es un documento inmutable que se lee entero y nunca se
  -- filtra por dentro; una tabla solo añadiría filas que sincronizar.
  epigrafes       jsonb not null default '[]'::jsonb,
  nota            numeric(3,1) check (nota between 0 and 10),
  con_preparador  boolean not null default false,
  feedback        text,
  -- AnalisisCante generado por el modelo. Llega tarde, tras el cante, y es la
  -- única razón por la que un cante se actualiza alguna vez.
  analisis        jsonb,
  -- Ruta dentro del bucket cantes-audio (ver 0002). Convenio: <uid>/<cante_id>.
  -- Es solo la ruta: el binario no viaja por esta tabla.
  audio_path      text,
  creado_at       timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- --------------------------------------------------------------- keypoints --
create table if not exists public.keypoints (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null default auth.uid() references auth.users on delete cascade,
  tema_id        uuid not null references public.temas on delete cascade,
  epigrafe_id    uuid references public.epigrafes on delete set null,
  anverso        text not null,
  reverso        text not null,
  aciertos       int not null default 0 check (aciertos >= 0),
  fallos         int not null default 0 check (fallos >= 0),
  intervalo_dias int not null default 1 check (intervalo_dias between 1 and 3650),
  proximo_repaso timestamptz not null default now(),
  creado_at      timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

-- ------------------------------------------------------------------- notas --
-- El campo "actualizado" del modelo de dominio y updated_at son la misma cosa,
-- así que no se duplica: el cliente lee updated_at para pintar "editada hace X".
create table if not exists public.notas (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null default auth.uid() references auth.users on delete cascade,
  tema_id     uuid not null references public.temas on delete cascade,
  epigrafe_id uuid references public.epigrafes on delete set null,
  texto       text not null,
  creado_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- -------------------------------------------------------------- simulacros --
-- tema_ids y notas son arrays POSICIONALES que se corresponden índice a índice
-- (notas[i] es la nota de tema_ids[i]). notas va en jsonb y no en numeric[]
-- porque admite null por hueco: un tema aún sin corregir.
create table if not exists public.simulacros (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      uuid not null default auth.uid() references auth.users on delete cascade,
  tipo            text not null check (tipo in ('cante','dictamen')),
  fecha           timestamptz not null default now(),
  tema_ids        uuid[] not null default '{}',
  minutos         int not null default 0 check (minutos >= 0),
  segundos_usados int not null default 0 check (segundos_usados >= 0),
  notas           jsonb not null default '[]'::jsonb,
  supuesto        text,
  respuesta       text,
  correccion      text,
  completado      boolean not null default false,
  creado_at       timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- ============================================================================
-- 3 · Triggers de updated_at
-- ============================================================================

do $bloque$
declare t text;
begin
  foreach t in array array[
    'perfiles','materias','temas','epigrafes','progreso_temas',
    'sesiones','cantes','keypoints','notas','simulacros'
  ] loop
    execute format('drop trigger if exists tocar_updated_at on public.%I', t);
    execute format(
      'create trigger tocar_updated_at before update on public.%I
         for each row execute function public.tocar_updated_at()', t);
  end loop;
end;
$bloque$;

drop trigger if exists cascada_borrado on public.temas;
create trigger cascada_borrado after update on public.temas
  for each row execute function public.cascada_borrado_tema();

drop trigger if exists cascada_borrado on public.materias;
create trigger cascada_borrado after update on public.materias
  for each row execute function public.cascada_borrado_materia();

-- ============================================================================
-- 4 · Índices
--
-- Dos familias distintas:
--   (a) pull incremental — (usuario_id, updated_at). Es la consulta que hace
--       el sincronizador en cada arranque: "dame todo lo mío tocado después
--       de mi última bajada". Incluye filas con deleted_at, porque el cliente
--       necesita enterarse de las tumbas: por eso NO son parciales.
--   (b) consultas de la app — parciales sobre deleted_at is null, porque la
--       app nunca mira una fila borrada y así el índice no engorda con tumbas.
-- ============================================================================

-- (a) pull incremental
create index if not exists materias_pull_idx       on public.materias       (usuario_id, updated_at);
create index if not exists temas_pull_idx          on public.temas          (usuario_id, updated_at);
create index if not exists epigrafes_pull_idx      on public.epigrafes      (usuario_id, updated_at);
create index if not exists progreso_temas_pull_idx on public.progreso_temas (usuario_id, updated_at);
create index if not exists sesiones_pull_idx       on public.sesiones       (usuario_id, updated_at);
create index if not exists cantes_pull_idx         on public.cantes         (usuario_id, updated_at);
create index if not exists keypoints_pull_idx      on public.keypoints      (usuario_id, updated_at);
create index if not exists notas_pull_idx          on public.notas          (usuario_id, updated_at);
create index if not exists simulacros_pull_idx     on public.simulacros     (usuario_id, updated_at);
-- perfiles no lleva índice de pull: es una fila por usuario y la PK basta.

-- (b) consultas de la app
create index if not exists materias_orden_idx on public.materias (usuario_id, orden)
  where deleted_at is null;

-- Listado del temario: materia y luego número.
create index if not exists temas_materia_idx on public.temas (usuario_id, materia_id, numero)
  where deleted_at is null;

-- Detalle de tema: sus epígrafes en orden.
create index if not exists epigrafes_tema_idx on public.epigrafes (tema_id, orden)
  where deleted_at is null;

-- Cola de repaso del SRS: "qué toca hoy".
create index if not exists progreso_repaso_idx on public.progreso_temas (usuario_id, proximo_repaso)
  where deleted_at is null;
create index if not exists progreso_estado_idx on public.progreso_temas (usuario_id, estado)
  where deleted_at is null;

-- Gráfica de horas y racha: sesiones por fecha descendente.
create index if not exists sesiones_fecha_idx on public.sesiones (usuario_id, inicio desc)
  where deleted_at is null;
-- Horas agregadas por tema.
create index if not exists sesiones_tema_idx on public.sesiones (tema_id, inicio desc)
  where deleted_at is null and tema_id is not null;

create index if not exists cantes_fecha_idx on public.cantes (usuario_id, fecha desc)
  where deleted_at is null;
-- Histórico de cantes de un tema (evolución de la nota).
create index if not exists cantes_tema_idx on public.cantes (tema_id, fecha desc)
  where deleted_at is null;

-- Cola de tarjetas vencidas.
create index if not exists keypoints_repaso_idx on public.keypoints (usuario_id, proximo_repaso)
  where deleted_at is null;
create index if not exists keypoints_tema_idx on public.keypoints (tema_id)
  where deleted_at is null;

create index if not exists notas_tema_idx on public.notas (tema_id, updated_at desc)
  where deleted_at is null;

create index if not exists simulacros_fecha_idx on public.simulacros (usuario_id, fecha desc)
  where deleted_at is null;

-- ============================================================================
-- 5 · Row Level Security
--
-- Políticas separadas por acción en vez de un FOR ALL, por una razón concreta:
-- NO se crea política de DELETE en ninguna tabla. Un DELETE físico desde el
-- cliente no se propaga a los otros dispositivos (la fila desaparece y el pull
-- incremental no tiene nada que traerse), así que la base de datos directamente
-- no lo permite. Un delete del cliente afecta a cero filas y no da error, lo
-- cual es exactamente el comportamiento que queremos. El borrado real es
-- update ... set deleted_at = now().
--
-- La limpieza definitiva de tumbas antiguas, si algún día hace falta, se hace
-- con la service_role, que salta la RLS.
-- ============================================================================

alter table public.perfiles       enable row level security;
alter table public.materias       enable row level security;
alter table public.temas          enable row level security;
alter table public.epigrafes      enable row level security;
alter table public.progreso_temas enable row level security;
alter table public.sesiones       enable row level security;
alter table public.cantes         enable row level security;
alter table public.keypoints      enable row level security;
alter table public.notas          enable row level security;
alter table public.simulacros     enable row level security;

drop policy if exists "perfil propio: select" on public.perfiles;
drop policy if exists "perfil propio: insert" on public.perfiles;
drop policy if exists "perfil propio: update" on public.perfiles;
drop policy if exists "perfil propio"         on public.perfiles;  -- nombre del esquema anterior

create policy "perfil propio: select" on public.perfiles
  for select using (auth.uid() = id);
create policy "perfil propio: insert" on public.perfiles
  for insert with check (auth.uid() = id);
create policy "perfil propio: update" on public.perfiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

do $bloque$
declare t text;
begin
  foreach t in array array[
    'materias','temas','epigrafes','progreso_temas',
    'sesiones','cantes','keypoints','notas','simulacros'
  ] loop
    execute format('drop policy if exists "datos propios" on public.%I', t);          -- esquema anterior
    execute format('drop policy if exists "datos propios: select" on public.%I', t);
    execute format('drop policy if exists "datos propios: insert" on public.%I', t);
    execute format('drop policy if exists "datos propios: update" on public.%I', t);

    execute format(
      'create policy "datos propios: select" on public.%I
         for select using (auth.uid() = usuario_id)', t);
    execute format(
      'create policy "datos propios: insert" on public.%I
         for insert with check (auth.uid() = usuario_id)', t);
    -- El WITH CHECK impide además regalarle una fila a otro usuario cambiando
    -- usuario_id en un update.
    execute format(
      'create policy "datos propios: update" on public.%I
         for update using (auth.uid() = usuario_id)
                   with check (auth.uid() = usuario_id)', t);
  end loop;
end;
$bloque$;

-- ============================================================================
-- 6 · Alta automática de perfil al registrarse
--
-- security definer porque el trigger corre en el contexto de auth.users, donde
-- auth.uid() todavía no es el del usuario recién creado y la RLS de perfiles
-- rechazaría el insert.
-- ============================================================================

create or replace function public.crear_perfil()
returns trigger
language plpgsql
security definer set search_path = public
as $fn$
begin
  insert into public.perfiles (id, nombre)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'nombre',
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'full_name',
      ''
    )
  )
  -- Idempotente: si el cliente ya empujó su perfil offline antes de que el
  -- trigger corriese, no lo pisamos con una fila vacía.
  on conflict (id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil();

-- ============================================================================
-- opos-notaria — 0007 · artículos del temario y lente de lectura
--
-- Hasta ahora el articulado solo existía dentro del texto del epígrafe, en
-- prosa: el opositor escribía "el 1255 CC consagra la libertad de pacto" y el
-- artículo entero se quedaba en el Código, que hay que abrir. Esta migración
-- le da al artículo entidad propia —cuerpo legal, número, rúbrica y TEXTO
-- ÍNTEGRO— por tres razones que no se resuelven con un `text` más:
--
--   1. Repasar sin abrir el Código. Es lo que se pide a dos semanas del
--      examen y lo que hoy obliga a tener el tocho al lado.
--   2. Cantar por artículos. Antes de cantar un tema se hace un barrido de
--      números y rúbricas; con el articulado dentro del texto eso no se puede
--      ni listar.
--   3. El índice cruzado. "El 1255 CC te sale en los temas 67, 70 y 95" es lo
--      que más pregunta el tribunal, y eso exige que el artículo sea una fila
--      consultable, no una cadena dentro de un párrafo.
--
-- Cuelga del EPÍGRAFE, como todo en este modelo, con `epigrafe_id` nullable:
-- mientras el opositor no lo asigne, el artículo vive a nivel de tema. Igual
-- que en `keypoints` y `notas`, y por el mismo motivo.
--
-- Depende de 0001 (tablas `temas` y `epigrafes`, función `tocar_updated_at`)
-- y REDEFINE `public.cascada_borrado_tema()` para meter los artículos en la
-- cascada. 0003 ya la había redefinido antes; esta versión es la buena y
-- tiene que aplicarse después, como todas.
--
-- Idempotente: se puede reaplicar entero sin miedo.
-- ============================================================================

-- ============================================================================
-- 1 · articulos
-- ============================================================================

create table if not exists public.articulos (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null default auth.uid() references auth.users on delete cascade,
  tema_id     uuid not null references public.temas on delete cascade,
  -- Nullable a propósito: un artículo recién pegado todavía no está
  -- archivado en ningún epígrafe y tiene que poder existir igual. El
  -- `on delete set null` es coherente con lo que hace la app al borrar un
  -- epígrafe —el artículo sobrevive, suelto a nivel de tema— y con lo que ya
  -- hacían `keypoints` y `notas` desde 0001.
  epigrafe_id uuid references public.epigrafes on delete set null,

  -- Cuerpo legal tal y como lo escribe el opositor: CC, LH, LSC. Se guarda su
  -- forma, no un id de un catálogo de leyes: cita cuerpos que no están en
  -- ninguna lista (forales, autonómicos, reglamentos) y una tabla de leyes
  -- solo conseguiría rechazarle citas legítimas. La normalización para cruzar
  -- ("CC", "C.C." y "Código Civil" son lo mismo) la hace el cliente
  -- (lib/data/articulos.ts), que es donde se puede cambiar de idea.
  cuerpo      text not null default '',

  -- TEXTO y no entero, y esto sí es importante: hay "1255 bis", hay "9.1" y
  -- hay "1.255". Un `int` obligaría a inventar columnas de apartado y de
  -- ordinal para guardar algo que el opositor escribe de un tirón.
  numero      text not null default '',

  -- La rúbrica. Vacía cuando el troceado del bloque pegado no ha podido
  -- distinguirla con fiabilidad: mejor un hueco que el opositor rellena que
  -- una rúbrica inventada que se acaba estudiando.
  titulo      text not null default '',

  -- El texto íntegro del artículo. Es la razón de ser de la tabla.
  contenido   text not null default '',

  -- Orden dentro del epígrafe: manda el opositor, no el número. Es un campo y
  -- no la posición de un array por lo mismo que en `materias.orden` — un
  -- array no sobrevive a una tabla.
  orden       int  not null default 0,

  creado_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Los topes son de longitud y nada más. NO hay `check (numero <> '')` aunque
-- un artículo sin número no signifique gran cosa: el push sube lotes, un
-- check que rechace una fila tumba el lote entero, y el precio de que un
-- artículo a medio escribir reviente la sincronización del expediente es
-- desproporcionado. Los campos vacíos los enseña la interfaz; esto es solo el
-- cinturón contra un pegado descomunal.
do $bloque$
begin
  if not exists (select 1 from pg_constraint where conname = 'articulos_numero_check') then
    alter table public.articulos add constraint articulos_numero_check
      check (char_length(numero) <= 40);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'articulos_cuerpo_check') then
    alter table public.articulos add constraint articulos_cuerpo_check
      check (char_length(cuerpo) <= 40);
  end if;
end;
$bloque$;

comment on table public.articulos is
  'Artículos del temario guardados enteros, para repasar sin abrir el Código.';
comment on column public.articulos.epigrafe_id is
  'Epígrafe al que está asignado; null mientras viva a nivel de tema.';
comment on column public.articulos.numero is
  'Número tal cual: "1255", "34", "1255 bis", "9.1". Texto, no entero.';
comment on column public.articulos.orden is
  'Orden dentro del epígrafe. Manda el opositor, no el número del artículo.';

drop trigger if exists tocar_updated_at on public.articulos;
create trigger tocar_updated_at before update on public.articulos
  for each row execute function public.tocar_updated_at();

-- ============================================================================
-- 2 · Los artículos entran en la cascada de borrado del tema
--
-- Se redefine la función entera (0003 ya la había redefinido; `create or
-- replace` la deja idempotente). Un artículo de un tema borrado no puede
-- quedarse vivo: saldría en el índice cruzado apuntando a un tema que ya no
-- existe, que es la clase de fantasma que el borrado lógico existe para
-- evitar.
--
-- Al epígrafe NO le cuelga cascada, y es deliberado: borrar un epígrafe es
-- reorganizar el tema, no decir que el 1255 CC ya no entra en él. El artículo
-- se queda con `epigrafe_id` a null (lo hace la FK) y vuelve al nivel de
-- tema, exactamente igual que las notas y los keypoints de ese epígrafe.
--
-- Las SESIONES siguen fuera de la cascada, como desde 0001: borrar un tema no
-- significa no haberlo estudiado.
-- ============================================================================

create or replace function public.cascada_borrado_tema()
returns trigger
language plpgsql
as $fn$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.epigrafes      set deleted_at = new.deleted_at where tema_id = new.id and deleted_at is null;
    update public.articulos      set deleted_at = new.deleted_at where tema_id = new.id and deleted_at is null;
    update public.progreso_temas set deleted_at = new.deleted_at where tema_id = new.id and deleted_at is null;
    update public.cantes         set deleted_at = new.deleted_at where tema_id = new.id and deleted_at is null;
    update public.keypoints      set deleted_at = new.deleted_at where tema_id = new.id and deleted_at is null;
    update public.notas          set deleted_at = new.deleted_at where tema_id = new.id and deleted_at is null;
    update public.vueltas        set deleted_at = new.deleted_at where tema_id = new.id and deleted_at is null;
  end if;
  return new;
end;
$fn$;

-- ============================================================================
-- 3 · Índices
--
-- Las dos familias de 0001, más una tercera que solo necesita esta tabla:
--   (a) pull incremental — (usuario_id, updated_at), NO parcial: el cliente
--       tiene que enterarse de las tumbas o el artículo borrado en el móvil
--       reaparece en el portátil.
--   (b) consultas de la app — parciales sobre deleted_at is null.
--   (c) el índice cruzado, que es una consulta que no existía hasta ahora:
--       "¿en qué otros temas tengo dado de alta este artículo?".
-- ============================================================================

create index if not exists articulos_pull_idx on public.articulos (usuario_id, updated_at);

-- Los artículos de un tema, en su orden. Es lo que pinta la lectura del tema.
create index if not exists articulos_tema_idx on public.articulos (tema_id, orden)
  where deleted_at is null;

-- Los de un epígrafe concreto: el barrido de antes de cantar ese epígrafe.
create index if not exists articulos_epigrafe_idx on public.articulos (epigrafe_id, orden)
  where deleted_at is null and epigrafe_id is not null;

-- (c) El cruce. Va por (usuario_id, cuerpo, numero) porque la pregunta
-- siempre es sobre el expediente de UN opositor, y el par cuerpo+numero es lo
-- que identifica un artículo entre temas.
create index if not exists articulos_cruce_idx on public.articulos (usuario_id, cuerpo, numero)
  where deleted_at is null;

-- ============================================================================
-- 4 · Row Level Security
--
-- Tres políticas separadas y NINGUNA de DELETE, igual que el resto del
-- esquema (0001 §5): un DELETE físico desde el cliente no se propaga a los
-- demás dispositivos, así que la base de datos no lo permite. El borrado real
-- es `update ... set deleted_at = now()`.
-- ============================================================================

alter table public.articulos enable row level security;

drop policy if exists "datos propios: select" on public.articulos;
drop policy if exists "datos propios: insert" on public.articulos;
drop policy if exists "datos propios: update" on public.articulos;

create policy "datos propios: select" on public.articulos
  for select using (auth.uid() = usuario_id);
create policy "datos propios: insert" on public.articulos
  for insert with check (auth.uid() = usuario_id);
-- El WITH CHECK impide además regalarle una fila a otro usuario cambiando
-- usuario_id en un update.
create policy "datos propios: update" on public.articulos
  for update using (auth.uid() = usuario_id)
            with check (auth.uid() = usuario_id);

-- Supabase concede los privilegios de tabla a los roles por defecto; en el
-- Postgres desnudo de db/pruebas/ los da el andamiaje, y los `alter default
-- privileges` de allí cubren esta tabla por ser posterior. Se repite el grant
-- explícito por si esta migración se aplicara sobre una base donde no lo
-- estén: sin privilegio de tabla la RLS ni se llega a evaluar.
do $bloque$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select, insert, update on public.articulos to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.articulos to service_role';
  end if;
end;
$bloque$;

-- ============================================================================
-- 5 · La lente de lectura, en el perfil
--
-- Con cuánto detalle se abre un tema: solo números y rúbricas (el barrido de
-- antes de cantar), los artículos desarrollados, o el tema entero. No es una
-- pestaña ni una pantalla nueva: es el mismo tema visto con más o menos
-- detalle.
--
-- Va en `perfiles` y no en una tabla propia por lo mismo que la apariencia de
-- 0006: es un ajuste único por opositor que vale en todos sus dispositivos.
-- Y se recuerda entre temas a propósito — quien repasa a golpe de artículo
-- abre así el tema siguiente sin volver a elegir.
--
-- El DEFAULT es 'completo', que es el tema entero: EXACTAMENTE la app de
-- antes de que esto existiera. Quien no dé de alta ni un artículo no nota que
-- la lente está ahí.
-- ============================================================================

alter table public.perfiles
  add column if not exists nivel_lectura text not null default 'completo';

do $bloque$
begin
  if not exists (select 1 from pg_constraint where conname = 'perfiles_nivel_lectura_check') then
    alter table public.perfiles add constraint perfiles_nivel_lectura_check
      check (nivel_lectura in ('articulos', 'articulos-texto', 'completo'));
  end if;
end;
$bloque$;

comment on column public.perfiles.nivel_lectura is
  'Lente con la que se abre un tema: articulos | articulos-texto | completo. "completo" es el tema entero de siempre.';

-- ============================================================================
-- 6 · Lo que NO hace falta tocar
--
--   · `crear_perfil()` no nombra esta columna, así que el alta se lleva el
--     DEFAULT: un opositor recién registrado abre el tema entero.
--   · la RLS de `perfiles` va contra la PK (0001) y cubre la columna nueva.
--   · `cascada_borrado_materia()` no se toca: encadena por `temas`, y el
--     trigger de temas ya arrastra los artículos.
--   · no hay índice para `perfiles.nivel_lectura`: se lee entera con la fila
--     del perfil y no se filtra por ella en ninguna consulta.
-- ============================================================================

-- ============================================================================
-- opos-notaria — 0003 · vueltas y avisos
--
-- Cierra tres huecos que dejó 0001:
--
--   1. `vueltas`, la tabla que le falta a un tipo del dominio que ya existe
--      (lib/data/types.ts → Vuelta) y que sin destino en el servidor no se
--      puede sincronizar.
--   2. las tumbas de epígrafes. Se resuelven SIN tabla nueva; el razonamiento
--      está en el bloque 2, que no crea nada a propósito.
--   3. `suscripciones_aviso` + las preferencias de aviso en `perfiles`, para
--      los recordatorios proactivos por Web Push.
--
-- Depende de 0001: reutiliza public.tocar_updated_at() y REDEFINE
-- public.cascada_borrado_tema(). Aplíquese después, como todas.
--
-- Idempotente: se puede reaplicar entero sin miedo.
-- ============================================================================

-- ============================================================================
-- 1 · vueltas
--
-- Cada fila es una transición de un tema a "dominado". Existe por el problema
-- de los contadores (docs/sincronizacion.md §6): `progreso_temas.vueltas` es un
-- acumulador y el last-write-wins lo trunca. Si cierras vuelta de Hipotecario
-- en el portátil y otra en el móvil sin sincronizar entre medias, la fila
-- ganadora de progreso_temas se queda con un 3 o con otro 3, nunca con el 4, y
-- la vuelta perdida no se puede reconstruir de ningún sitio porque no quedó
-- rastro de ella. Con una fila por vuelta sí: el contador se recompone
-- contando filas, que es lo que un append-only sí sabe hacer, igual que
-- `segundos` sale de `sesiones` y `nota_media` de `cantes`.
--
-- `progreso_temas.vueltas` se queda como caché, no se elimina: evita agregar
-- en cada render. La verdad es esta tabla.
--
-- Append-only, como `sesiones` y `cantes`: una vuelta cerrada no se edita
-- nunca. Lo único que la toca después de insertarla es la cascada de borrado
-- del tema.
-- ============================================================================

create table if not exists public.vueltas (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid() references auth.users on delete cascade,
  -- No es nullable, al revés que en `sesiones`: una vuelta sin tema no
  -- significa nada, no hay nada que contar.
  tema_id    uuid not null references public.temas on delete cascade,
  -- El instante de la transición, que NO es creado_at: una vuelta cerrada
  -- offline el martes y subida el jueves ocurrió el martes.
  fecha      timestamptz not null default now(),
  creado_at  timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ============================================================================
-- 2 · Tumbas de epígrafes: aquí NO se crea nada, y es deliberado
--
-- El store lleva una colección `epigrafesBorrados` (lib/data/types.ts →
-- EpigrafeBorrado, lib/store/store.ts → setEpigrafes / removeEpigrafe). Existe
-- por una razón que es CIERTA EN EL CLIENTE Y SOLO ALLÍ: en local los epígrafes
-- viven anidados dentro del tema (`Tema.epigrafes`), así que quitar uno del
-- array lo hace desaparecer sin dejar rastro y no habría nada que empujar.
--
-- En el servidor esa razón no aplica: 0001 ya sacó los epígrafes a tabla propia
-- y `public.epigrafes` tiene su `deleted_at`. Un EpigrafeBorrado ya tiene una
-- fila donde caber, campo por campo:
--
--     EpigrafeBorrado.id       → epigrafes.id
--     EpigrafeBorrado.temaId   → epigrafes.tema_id   (ya está en la fila)
--     EpigrafeBorrado.borrado  → epigrafes.deleted_at
--
-- Así que `epigrafesBorrados` es una COLA DE PUSH del cliente, no una entidad
-- del dominio, y su destino es un update sobre la fila que ya existe:
--
--     update public.epigrafes
--        set deleted_at = <borrado>, updated_at = <borrado>
--      where id = <id>;
--
-- Darle tabla propia sería peor, no mejor: dos sitios donde vive la muerte de
-- un epígrafe (`epigrafes.deleted_at` y la tabla de tumbas) que pueden
-- contradecirse, una entidad más que sincronizar, y un pull que tendría que
-- fusionar ambas fuentes para saber si un epígrafe está vivo. Además la
-- cascada de `temas` ya entierra los epígrafes por su `deleted_at`: una tabla
-- aparte se quedaría fuera de la cascada o habría que duplicarla también ahí.
--
-- Dos apuntes para quien implemente el push, que es donde está la letra
-- pequeña:
--
--   · el update de arriba puede afectar a 0 filas, y no es un error. Pasa
--     cuando el epígrafe se creó y se borró sin que llegara a subir ninguna de
--     las dos cosas: si nunca hubo fila en el servidor, no hay nada que
--     enterrar y ningún otro dispositivo lo vio jamás. La entrada se saca de la
--     cola igualmente.
--   · el update tiene que ir con la marca del borrado (`borrado`), no con
--     now(): si va con now() y otro dispositivo editó el epígrafe DESPUÉS del
--     borrado, el borrado tardío gana el arbitraje y se lleva por delante una
--     edición más reciente. Con la marca original, tocar_updated_at() lo
--     rechaza, que es justo lo correcto.
--
-- Por eso este bloque no crea ninguna tabla.
-- ============================================================================

-- ============================================================================
-- 3 · suscripciones_aviso
--
-- Una fila por NAVEGADOR suscrito, no por usuario: el mismo opositor tiene la
-- app en el móvil y en el portátil y quiere el aviso en los dos. Es lo que
-- obliga a tabla aparte — las preferencias van en `perfiles` (bloque 4), pero
-- una suscripción push es del dispositivo, no de la persona.
--
-- Lo que guarda es exactamente el PushSubscription del navegador: el endpoint
-- (la URL del servicio push de Google/Mozilla/Apple a la que se hace POST) y
-- las dos claves de cifrado que exige el Web Push. Sin las tres cosas no se
-- puede enviar nada; no son opcionales.
--
-- OJO con quién escribe aquí: las claves son secretos de cifrado del mensaje,
-- no credenciales de acceso a nada, pero aun así solo tienen sentido para el
-- proceso que envía, que corre con la service_role y se salta la RLS. El
-- cliente solo inserta la suya y marca la baja.
-- ============================================================================

create table if not exists public.suscripciones_aviso (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null default auth.uid() references auth.users on delete cascade,

  -- Los tres campos del PushSubscription serializado.
  endpoint     text not null,
  clave_p256dh text not null,
  -- Se llama clave_auth y no auth para no confundirla con el esquema auth de
  -- Supabase, que no tiene nada que ver.
  clave_auth   text not null,

  -- Para que el opositor reconozca cuál es cuál en la pantalla de ajustes
  -- ("Chrome en Android", "Safari en Mac"). Informativo, nadie decide con esto.
  user_agent   text not null default '',

  -- La zona del DISPOSITIVO, y va aquí y no en `perfiles` a propósito: la
  -- preferencia es "avísame a las 20:00", y esas 20:00 no son el mismo instante
  -- para un móvil que se ha ido a Canarias que para el portátil que se quedó en
  -- Madrid. El programador necesita una zona por endpoint para resolverlo.
  zona_horaria text not null default 'Europe/Madrid',

  -- Última vez que se envió algo por este endpoint. Sirve para no repetir el
  -- aviso del día si el opositor abre la app en dos sitios.
  ultimo_envio timestamptz,

  -- La muerte del endpoint, que es DISTINTA de deleted_at y por eso tiene
  -- columna propia:
  --   caducada_at  la puso el servidor: el servicio push respondió 404/410,
  --                el endpoint ya no existe. No es una decisión del usuario y
  --                se revierte sola en cuanto el navegador vuelve a suscribirse.
  --   deleted_at   lo puso el opositor: "no quiero avisos en este aparato".
  -- Fundirlas en una perdería la diferencia entre "se rompió" y "lo apagó", que
  -- es justo lo que hay que saber para decidir si se le vuelve a pedir permiso.
  -- Marcar en vez de borrar también deja el histórico y evita que el mismo
  -- navegador, al resuscribirse, aparezca como un dispositivo nuevo más.
  caducada_at  timestamptz,

  creado_at    timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- Un endpoint es único por navegador+instalación, así que dos filas con el
-- mismo endpoint son siempre la misma suscripción duplicada: pasa en cuanto el
-- cliente pierde su IndexedDB y vuelve a suscribirse generando otro uuid. El
-- unique deja que el push lo resuelva con
--   on conflict (usuario_id, endpoint) do update set ...
-- y NO es parcial a propósito: si excluyera las tumbas, resuscribirse tras dar
-- de baja el dispositivo crearía una fila nueva en vez de resucitar la vieja.
-- Lleva usuario_id delante para que el conflicto nunca cruce usuarios: con un
-- unique solo sobre endpoint, un opositor podría averiguar si un endpoint ajeno
-- existe mirando si su insert choca.
create unique index if not exists suscripciones_aviso_endpoint_idx
  on public.suscripciones_aviso (usuario_id, endpoint);

-- ============================================================================
-- 4 · Preferencias de aviso — en `perfiles`, no en tabla aparte
--
-- Van aquí porque son EXACTAMENTE la misma clase de dato que `dias_oxido`,
-- `objetivo_horas_semana` o `estilo_feedback`, que ya están en `perfiles`: un
-- ajuste único por opositor, que él cambia a mano de uvas a peras y que debe
-- valer en todos sus dispositivos (cambias la hora en el móvil y el portátil
-- avisa a la hora nueva). Una tabla propia añadiría una entidad más al push, un
-- índice de pull, una fila que crear en el alta y un join en cada consulta del
-- programador, a cambio de nada: nunca habrá más de una fila por usuario.
--
-- Lo que sí es por dispositivo (endpoint, claves, zona horaria) está en
-- suscripciones_aviso. La línea divisoria es esa, y es la razón de que las
-- preferencias no vayan también allí: si estuvieran en cada suscripción,
-- apagar los domingos habría que hacerlo aparato por aparato.
-- ============================================================================

alter table public.perfiles
  -- Apagados por defecto: un aviso push exige permiso explícito del navegador y
  -- encenderlos de oficio dejaría el perfil diciendo que sí mientras el
  -- navegador dice que no.
  add column if not exists avisos_activos boolean not null default false,

  -- Hora LOCAL, sin fecha ni zona: "a las 20:00", resuelta contra la
  -- zona_horaria de cada suscripción. Guardarla como timestamptz obligaría a
  -- reescribirla cada día y a elegir una zona por el usuario.
  add column if not exists aviso_hora time not null default '20:00',

  -- Días ISO (1 = lunes … 7 = domingo). Array y no siete booleanos ni una
  -- máscara de bits porque es lo que la app maneja y lo que se lee de un
  -- vistazo en el editor. El check impide días inventados; el array vacío se
  -- permite y significa "ninguno", que es otra forma de apagarlos.
  add column if not exists aviso_dias int[] not null default '{1,2,3,4,5,6,7}',

  -- Qué se le puede recordar:
  --   oxido      "llevas 11 días sin tocar Hipotecario"
  --   repaso     hay temas con proximo_repaso vencido
  --   racha      hoy todavía no has estudiado nada
  --   simulacro  toca simulacro según su cadencia
  add column if not exists aviso_tipos text[] not null default '{oxido,repaso,racha}';

do $bloque$
begin
  -- Los checks van aparte de los add column porque "add constraint if not
  -- exists" no existe en Postgres y hay que preguntar por el catálogo.
  if not exists (select 1 from pg_constraint where conname = 'perfiles_aviso_dias_check') then
    alter table public.perfiles add constraint perfiles_aviso_dias_check
      check (aviso_dias <@ array[1,2,3,4,5,6,7]);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'perfiles_aviso_tipos_check') then
    alter table public.perfiles add constraint perfiles_aviso_tipos_check
      check (aviso_tipos <@ array['oxido','repaso','racha','simulacro']);
  end if;
end;
$bloque$;

-- ============================================================================
-- 5 · Triggers
-- ============================================================================

do $bloque$
declare t text;
begin
  foreach t in array array['vueltas','suscripciones_aviso'] loop
    execute format('drop trigger if exists tocar_updated_at on public.%I', t);
    execute format(
      'create trigger tocar_updated_at before update on public.%I
         for each row execute function public.tocar_updated_at()', t);
  end loop;
end;
$bloque$;

-- Cascada de borrado de tema, AMPLIADA con vueltas.
--
-- Esta función sustituye a la de 0001 (misma firma, mismo trigger; no hay que
-- recrear el trigger). Se redefine entera en vez de encadenar un segundo
-- trigger para que la cascada siga estando en un único sitio: dos triggers
-- distintos sobre `temas` acabarían divergiendo a la tercera migración. La
-- contrapartida es que 0003 tiene que aplicarse DESPUÉS de 0001 — que es el
-- orden de siempre; reaplicar 0001 a solas dejaría las vueltas fuera de la
-- cascada hasta reaplicar este fichero.
--
-- Las vueltas SÍ se cascadean, al contrario que las sesiones. No es una
-- incoherencia: una sesión es tiempo de vida del opositor y sigue siendo verdad
-- aunque el tema desaparezca (por eso se conserva y la app la pinta como "tema
-- borrado"), mientras que una vuelta solo existe para contar las de UN tema. Si
-- el tema no está, la vuelta no cuenta nada; dejarla viva inflaría el recuento
-- de un tema que ya no se ve. El cliente hace lo mismo en local: removeTema
-- quita las vueltas del tema.
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
    update public.vueltas        set deleted_at = new.deleted_at where tema_id = new.id and deleted_at is null;
  end if;
  return new;
end;
$fn$;

-- ============================================================================
-- 6 · Índices
--
-- Las dos familias de 0001: (a) pull incremental, nunca parcial, porque las
-- tumbas tienen que bajar; (b) consultas de la app, parciales.
-- ============================================================================

-- (a) pull incremental
create index if not exists vueltas_pull_idx             on public.vueltas             (usuario_id, updated_at);
create index if not exists suscripciones_aviso_pull_idx on public.suscripciones_aviso (usuario_id, updated_at);

-- (b) consultas de la app

-- Recuento de vueltas de un tema (la derivación que sustituye al contador) y
-- "cuándo cerraste la última vuelta".
create index if not exists vueltas_tema_idx on public.vueltas (tema_id, fecha desc)
  where deleted_at is null;

-- A quién le mando el push: las suscripciones VIVAS de un usuario. Doble
-- filtro porque una suscripción caducada no sirve para enviar aunque el
-- opositor no la haya dado de baja.
create index if not exists suscripciones_aviso_vivas_idx on public.suscripciones_aviso (usuario_id)
  where deleted_at is null and caducada_at is null;

-- A quién le toca aviso a esta hora. Es la consulta del programador, que corre
-- con la service_role cada pocos minutos sobre TODOS los perfiles, así que es
-- la única de la app que no empieza por usuario_id. Parcial sobre
-- avisos_activos: los que no quieren avisos son la mayoría y no deben ni
-- aparecer en el índice.
create index if not exists perfiles_aviso_hora_idx on public.perfiles (aviso_hora)
  where avisos_activos and deleted_at is null;

-- ============================================================================
-- 7 · Row Level Security
--
-- Mismo patrón que 0001: políticas separadas por acción y NINGUNA de DELETE.
--
-- En `vueltas` es lo de siempre: un delete físico no viaja. En
-- suscripciones_aviso el motivo es distinto y conviene decirlo, porque la
-- tentación de permitir el delete aquí es real (un endpoint muerto no es un
-- dato del opositor): si el navegador borrase la fila, el otro dispositivo
-- seguiría enseñando ese aparato en la lista de ajustes para siempre, porque
-- el pull no tiene cómo enterarse de una fila que ya no está. La baja es
-- deleted_at, igual que todo lo demás. La limpieza de verdad, cuando moleste,
-- con la service_role.
-- ============================================================================

alter table public.vueltas             enable row level security;
alter table public.suscripciones_aviso enable row level security;

do $bloque$
declare t text;
begin
  foreach t in array array['vueltas','suscripciones_aviso'] loop
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

-- ============================================================================
-- Batería de pruebas de comportamiento del esquema
--
-- NO ES UNA MIGRACIÓN. Se ejecuta contra la base de pruebas LOCAL que monta
-- db/pruebas/ejecutar.sh, nunca contra Supabase: crea usuarios falsos, escribe
-- datos basura y crea el esquema `pruebas`.
--
-- No comprueba que el SQL se aplique (eso ya lo hace ejecutar.sh al aplicarlo),
-- sino que el esquema HACE LO QUE DICE: RLS que aísla de verdad, arbitraje
-- last-write-wins, borrado lógico en cascada, DELETE imposible, e índices que
-- el planificador usa de verdad para el pull incremental.
--
-- Cada comprobación deja una fila en pruebas.resultados. Al final se imprime el
-- listado y el recuento de fallos; ejecutar.sh sale con código != 0 si hay
-- alguno.
-- ============================================================================

\set ON_ERROR_STOP on
set client_min_messages = warning;

-- ============================================================================
-- 0 · Andamio de la propia batería
-- ============================================================================

drop schema if exists pruebas cascade;
create schema pruebas;

create table pruebas.resultados (
  n        serial primary key,
  bloque   text not null,
  nombre   text not null,
  ok       boolean not null,
  detalle  text not null default ''
);

-- security definer: los tests corren con el rol `authenticated`, que no tiene
-- por qué poder escribir en el esquema de pruebas.
create function pruebas.comprobar(p_bloque text, p_nombre text, p_ok boolean, p_detalle text default '')
returns void
language plpgsql
security definer
as $$
begin
  insert into pruebas.resultados (bloque, nombre, ok, detalle)
  values (p_bloque, p_nombre, coalesce(p_ok, false), coalesce(p_detalle, ''));
end;
$$;

-- Simula a PostgREST: rol `authenticated` + el claim "sub" del JWT que lee
-- auth.uid(). `set local`, así que se deshace al cerrar la transacción.
create function pruebas.como(p_uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end;
$$;

-- Vuelve al rol de la sesión (equivalente al SQL editor / service_role).
create function pruebas.servidor()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Ejecuta p_sql esperando que la RLS (u otro error) lo rechace.
-- Devuelve true si falló con el SQLSTATE esperado.
create function pruebas.rechazado(p_sql text, p_estado text default '42501')
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_estado;
end;
$$;

-- uuids deterministas para que las pruebas se puedan releer.
create function pruebas.id(p_pref text, p_n int)
returns uuid
language sql
immutable
as $$
  select (p_pref || '-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid;
$$;

-- Siembra un juego completo de datos del usuario p_uid. Se llama YA con el rol
-- del usuario puesto, así que también comprueba de paso que la RLS deja
-- insertar lo propio en las diez tablas.
create function pruebas.sembrar(p_uid uuid, p_pref text)
returns void
language plpgsql
as $$
begin
  insert into public.materias (id, usuario_id, nombre, abrev, orden)
    values (pruebas.id(p_pref, 1), p_uid, 'Civil', 'CIV', 0);
  insert into public.temas (id, usuario_id, materia_id, numero, titulo)
    values (pruebas.id(p_pref, 2), p_uid, pruebas.id(p_pref, 1), 1, 'Tema 1');
  insert into public.epigrafes (id, usuario_id, tema_id, orden, titulo, texto)
    values (pruebas.id(p_pref, 3), p_uid, pruebas.id(p_pref, 2), 0, 'Epígrafe 1', 'texto');
  insert into public.progreso_temas (tema_id, usuario_id, estado, segundos)
    values (pruebas.id(p_pref, 2), p_uid, 'estudiando', 1200);
  insert into public.sesiones (id, usuario_id, tema_id, tipo, inicio, fin, segundos)
    values (pruebas.id(p_pref, 4), p_uid, pruebas.id(p_pref, 2), 'estudio',
            now() - interval '1 hour', now(), 3000);
  insert into public.cantes (id, usuario_id, tema_id, segundos, nota, audio_path)
    values (pruebas.id(p_pref, 5), p_uid, pruebas.id(p_pref, 2), 600, 7.5,
            p_uid::text || '/' || pruebas.id(p_pref, 5)::text || '.webm');
  insert into public.keypoints (id, usuario_id, tema_id, epigrafe_id, anverso, reverso)
    values (pruebas.id(p_pref, 6), p_uid, pruebas.id(p_pref, 2), pruebas.id(p_pref, 3), 'anverso', 'reverso');
  insert into public.notas (id, usuario_id, tema_id, texto)
    values (pruebas.id(p_pref, 7), p_uid, pruebas.id(p_pref, 2), 'nota libre');
  insert into public.simulacros (id, usuario_id, tipo, tema_ids, minutos)
    values (pruebas.id(p_pref, 8), p_uid, 'cante', array[pruebas.id(p_pref, 2)], 30);
end;
$$;

-- Las nueve tablas con usuario_id (perfiles va aparte: su RLS es contra la PK).
create function pruebas.tablas()
returns text[]
language sql
immutable
as $$
  select array['materias','temas','epigrafes','progreso_temas',
               'sesiones','cantes','keypoints','notas','simulacros'];
$$;

-- Los tests corren con el rol `authenticated`, que necesita poder llamar a
-- estos ayudantes.
grant usage on schema pruebas to public;
grant execute on all functions in schema pruebas to public;

-- ============================================================================
-- 1 · Alta de usuarios y perfil automático
-- ============================================================================

do $$
declare
  a uuid := '11111111-1111-4111-8111-111111111111';
  b uuid := '22222222-2222-4222-8222-222222222222';
  n int;
  nom text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'ana@ejemplo.es', '{"nombre":"Ana"}'),
    (b, 'bruno@ejemplo.es', '{"full_name":"Bruno"}');

  select count(*) into n from public.perfiles where id in (a, b);
  perform pruebas.comprobar('alta', 'el trigger al_crear_usuario crea el perfil',
    n = 2, 'perfiles creados: ' || n);

  select nombre into nom from public.perfiles where id = a;
  perform pruebas.comprobar('alta', 'crear_perfil lee "nombre" de raw_user_meta_data',
    nom = 'Ana', 'nombre = ' || quote_literal(nom));

  select nombre into nom from public.perfiles where id = b;
  perform pruebas.comprobar('alta', 'crear_perfil cae a "full_name" si no hay "nombre"',
    nom = 'Bruno', 'nombre = ' || quote_literal(nom));
end;
$$;

-- ============================================================================
-- 2 · Siembra (cada usuario escribe lo suyo, ya bajo RLS)
-- ============================================================================

begin;
do $$ begin perform pruebas.como('11111111-1111-4111-8111-111111111111');
            perform pruebas.sembrar('11111111-1111-4111-8111-111111111111', 'aaaa1111'); end $$;
commit;

begin;
do $$ begin perform pruebas.como('22222222-2222-4222-8222-222222222222');
            perform pruebas.sembrar('22222222-2222-4222-8222-222222222222', 'bbbb2222'); end $$;
commit;

do $$
declare n int;
begin
  select count(*) into n from public.materias;
  perform pruebas.comprobar('siembra', 'los dos usuarios han podido insertar sus filas',
    n = 2, 'materias en total (sin RLS): ' || n);
end;
$$;

-- ============================================================================
-- 3 · RLS: aislamiento entre usuarios
-- ============================================================================

begin;
do $$ begin perform pruebas.como('11111111-1111-4111-8111-111111111111'); end $$;

do $$
declare
  a uuid := '11111111-1111-4111-8111-111111111111';
  b uuid := '22222222-2222-4222-8222-222222222222';
  t text;
  n int;
  total int;
  fallos text := '';
begin
  -- SELECT: A no ve ni una fila de B, en ninguna tabla.
  foreach t in array pruebas.tablas() loop
    execute format('select count(*) from public.%I where usuario_id = %L', t, b) into n;
    if n <> 0 then fallos := fallos || t || '(' || n || ' de B visibles) '; end if;
    execute format('select count(*) from public.%I', t) into total;
    if total <> 1 then fallos := fallos || t || '(ve ' || total || ' filas, esperaba 1) '; end if;
  end loop;
  perform pruebas.comprobar('rls', 'select: A no ve ninguna fila de B en las 9 tablas',
    fallos = '', coalesce(nullif(fallos, ''), 'todas aisladas'));

  -- perfiles: su RLS va contra la PK.
  select count(*) into n from public.perfiles;
  perform pruebas.comprobar('rls', 'select: A solo ve su propio perfil',
    n = 1, 'perfiles visibles: ' || n);
  select count(*) into n from public.perfiles where id = b;
  perform pruebas.comprobar('rls', 'select: el perfil de B es invisible para A',
    n = 0, 'filas: ' || n);

  -- UPDATE de filas ajenas: 0 filas afectadas, sin error.
  fallos := '';
  foreach t in array pruebas.tablas() loop
    execute format('update public.%I set updated_at = now() where usuario_id = %L', t, b);
    get diagnostics n = row_count;
    if n <> 0 then fallos := fallos || t || '(' || n || ') '; end if;
  end loop;
  perform pruebas.comprobar('rls', 'update: A no puede modificar filas de B',
    fallos = '', coalesce(nullif(fallos, ''), 'ninguna fila ajena tocada'));

  -- INSERT con usuario_id ajeno: rechazado por el WITH CHECK.
  fallos := '';
  perform pruebas.comprobar('rls', 'insert: A no puede crear una materia a nombre de B',
    pruebas.rechazado(format(
      'insert into public.materias (usuario_id, nombre) values (%L, %L)', b, 'robada')),
    'esperado SQLSTATE 42501');

  -- UPDATE que "regala" una fila propia a B: rechazado por el WITH CHECK.
  perform pruebas.comprobar('rls', 'update: A no puede reasignar una fila suya a B',
    pruebas.rechazado(format(
      'update public.materias set usuario_id = %L where id = %L', b, pruebas.id('aaaa1111', 1))),
    'esperado SQLSTATE 42501');

  -- Upsert sobre el id de una fila de B (el escenario de colisión de uuid).
  perform pruebas.comprobar('rls', 'upsert: A no puede secuestrar por id una fila de B',
    pruebas.rechazado(format(
      'insert into public.materias (id, usuario_id, nombre) values (%L, %L, %L)
         on conflict (id) do update set nombre = excluded.nombre, usuario_id = excluded.usuario_id',
      pruebas.id('bbbb2222', 1), a, 'secuestrada')),
    'esperado SQLSTATE 42501');
end;
$$;
commit;

-- ============================================================================
-- 4 · El DELETE físico tiene que ser imposible
-- ============================================================================

begin;
do $$ begin perform pruebas.como('11111111-1111-4111-8111-111111111111'); end $$;

do $$
declare
  t text;
  n int;
  fallos text := '';
  antes int;
  despues int;
begin
  select count(*) into antes from public.materias;

  foreach t in array pruebas.tablas() loop
    execute format('delete from public.%I', t);   -- sin where: borrarlo todo
    get diagnostics n = row_count;
    if n <> 0 then fallos := fallos || t || '(' || n || ' borradas) '; end if;
  end loop;
  delete from public.perfiles;
  get diagnostics n = row_count;
  if n <> 0 then fallos := fallos || 'perfiles(' || n || ') '; end if;

  perform pruebas.comprobar('delete', 'un delete sin where afecta a 0 filas y no da error',
    fallos = '', coalesce(nullif(fallos, ''), 'las 10 tablas rechazan el delete'));

  select count(*) into despues from public.materias;
  perform pruebas.comprobar('delete', 'nada ha desaparecido tras los delete',
    antes = despues and antes = 1, 'antes=' || antes || ' despues=' || despues);
end;
$$;
commit;

-- ============================================================================
-- 5 · updated_at y arbitraje last-write-wins
-- ============================================================================

begin;
do $$ begin perform pruebas.como('11111111-1111-4111-8111-111111111111'); end $$;

do $$
declare
  mid uuid := pruebas.id('aaaa1111', 1);
  t0 timestamptz;
  t1 timestamptz;
  t2 timestamptz;
  creado0 timestamptz;
  creado1 timestamptz;
  nom text;
begin
  select updated_at, creado_at into t0, creado0 from public.materias where id = mid;

  -- (a) update normal: el servidor pone su reloj.
  update public.materias set nombre = 'v2' where id = mid;
  select updated_at, creado_at, nombre into t1, creado1, nom from public.materias where id = mid;
  perform pruebas.comprobar('updated_at', 'un update avanza updated_at',
    t1 > t0, t0 || ' -> ' || t1);
  perform pruebas.comprobar('updated_at', 'el update sí escribe los datos',
    nom = 'v2', 'nombre = ' || nom);
  perform pruebas.comprobar('updated_at', 'creado_at no se toca nunca',
    creado1 = creado0, creado0 || ' -> ' || creado1);

  -- (b) el select puro no toca nada.
  perform 1 from public.materias where id = mid;
  select updated_at into t2 from public.materias where id = mid;
  perform pruebas.comprobar('updated_at', 'leer no cambia updated_at',
    t2 = t1, t1 || ' = ' || t2);

  -- (c) LWW: llega una escritura con updated_at ANTERIOR. Debe perder entera.
  update public.materias
     set nombre = 'PERDEDOR', abrev = 'XXX', updated_at = t1 - interval '1 day'
   where id = mid;
  select nombre, updated_at into nom, t2 from public.materias where id = mid;
  perform pruebas.comprobar('lww', 'un update con updated_at más antiguo NO gana',
    nom = 'v2' and t2 = t1, 'nombre=' || nom || ' updated_at=' || t2);

  -- (d) ...y el RETURNING le devuelve al cliente la fila GANADORA, no la suya.
  nom := null;
  update public.materias
     set nombre = 'PERDEDOR2', updated_at = t1 - interval '1 day'
   where id = mid
  returning nombre into nom;
  perform pruebas.comprobar('lww', 'el RETURNING del perdedor devuelve la fila ganadora',
    nom = 'v2', 'returning devolvió ' || quote_literal(nom));

  -- (e) LWW: updated_at posterior gana y se conserva la marca del cliente.
  update public.materias
     set nombre = 'GANADOR', updated_at = t1 + interval '2 minutes'
   where id = mid;
  select nombre, updated_at into nom, t2 from public.materias where id = mid;
  perform pruebas.comprobar('lww', 'un update con updated_at posterior gana',
    nom = 'GANADOR' and t2 = t1 + interval '2 minutes',
    'nombre=' || nom || ' updated_at=' || t2);

  -- (f) reintento idempotente del push: misma marca, se acepta.
  update public.materias
     set nombre = 'REINTENTO', updated_at = t1 + interval '2 minutes'
   where id = mid;
  select nombre into nom from public.materias where id = mid;
  perform pruebas.comprobar('lww', 'un update con la MISMA marca se acepta (reintento del push)',
    nom = 'REINTENTO', 'nombre = ' || nom);

  -- (g) ...y updated_at nunca retrocede, aunque el reloj del servidor vaya por
  --     detrás de la marca del cliente. Si retrocediera por debajo del cursor de
  --     otro dispositivo, ese dispositivo no volvería a ver la fila jamás.
  select updated_at into t2 from public.materias where id = mid;
  perform pruebas.comprobar('lww', 'updated_at nunca retrocede (marca del cliente en el futuro)',
    t2 >= t1 + interval '2 minutes', 'updated_at = ' || t2);
  perform pruebas.comprobar('lww', 'updated_at avanza ESTRICTAMENTE al aceptar la escritura',
    t2 > t1 + interval '2 minutes', 'updated_at = ' || t2);
end;
$$;
commit;

-- Caso extremo del reloj adelantado, en una fila aparte para no ensuciar.
begin;
do $$ begin perform pruebas.como('11111111-1111-4111-8111-111111111111'); end $$;
do $$
declare
  mid uuid := pruebas.id('aaaa1111', 101);
  futuro timestamptz := now() + interval '10 minutes';
  t timestamptz;
begin
  -- Un móvil con el reloj 10 minutos adelantado inserta la fila.
  insert into public.materias (id, usuario_id, nombre, updated_at)
    values (mid, '11111111-1111-4111-8111-111111111111', 'reloj adelantado', futuro);
  -- Otro dispositivo, en hora, la edita sin mandar updated_at.
  update public.materias set nombre = 'editada desde el portátil' where id = mid;
  select updated_at into t from public.materias where id = mid;
  perform pruebas.comprobar('lww', 'una edición online no hace retroceder la marca de un cliente adelantado',
    t > futuro, 'updated_at = ' || t || ' (marca del móvil: ' || futuro || ')');
end;
$$;
commit;

-- ============================================================================
-- 6 · Borrado lógico en cascada
-- ============================================================================

begin;
do $$ begin perform pruebas.como('11111111-1111-4111-8111-111111111111'); end $$;

do $$
declare
  tema uuid := pruebas.id('aaaa1111', 2);
  marca timestamptz;
  n int;
  fallos text := '';
  t text;
  ses_borrada boolean;
  hijo_updated timestamptz;
  antes timestamptz;
begin
  select updated_at into antes from public.epigrafes where tema_id = tema;

  marca := now();
  update public.temas set deleted_at = marca, updated_at = marca where id = tema;

  foreach t in array array['epigrafes','progreso_temas','cantes','keypoints','notas'] loop
    execute format('select count(*) from public.%I where tema_id = %L and deleted_at is null', t, tema) into n;
    if n <> 0 then fallos := fallos || t || '(' || n || ' sin borrar) '; end if;
  end loop;
  perform pruebas.comprobar('cascada', 'borrar un tema arrastra epígrafes, progreso, cantes, keypoints y notas',
    fallos = '', coalesce(nullif(fallos, ''), 'los 5 hijos quedan con deleted_at'));

  select deleted_at is not null into ses_borrada from public.sesiones where tema_id = tema;
  perform pruebas.comprobar('cascada', 'las SESIONES no se cascadean (las horas son historia)',
    ses_borrada = false, 'sesion borrada = ' || ses_borrada);

  select updated_at into hijo_updated from public.epigrafes where tema_id = tema;
  perform pruebas.comprobar('cascada', 'la cascada avanza updated_at de los hijos (si no, no se propaga)',
    hijo_updated > antes, antes || ' -> ' || hijo_updated);

  -- La tumba tiene que bajar en el pull: es cómo se entera el otro dispositivo.
  select count(*) into n from public.epigrafes
   where usuario_id = '11111111-1111-4111-8111-111111111111' and updated_at > antes;
  perform pruebas.comprobar('cascada', 'la tumba del hijo la devuelve la consulta de pull incremental',
    n = 1, 'filas devueltas por el pull: ' || n);
end;
$$;
commit;

-- Cascada de materia: arrastra temas y, encadenando, los nietos.
begin;
do $$ begin perform pruebas.como('22222222-2222-4222-8222-222222222222'); end $$;
do $$
declare
  mat uuid := pruebas.id('bbbb2222', 1);
  tema uuid := pruebas.id('bbbb2222', 2);
  n int;
  tema_borrado boolean;
  nieto_borrado boolean;
begin
  update public.materias set deleted_at = now(), updated_at = now() where id = mat;

  select deleted_at is not null into tema_borrado from public.temas where id = tema;
  perform pruebas.comprobar('cascada', 'borrar una materia arrastra sus temas',
    tema_borrado, 'tema borrado = ' || tema_borrado);

  select deleted_at is not null into nieto_borrado from public.epigrafes where tema_id = tema;
  perform pruebas.comprobar('cascada', 'la cascada encadena hasta los nietos (materia → tema → epígrafe)',
    nieto_borrado, 'epígrafe borrado = ' || nieto_borrado);

  select count(*) into n from public.sesiones where tema_id = tema and deleted_at is not null;
  perform pruebas.comprobar('cascada', 'tampoco se cascadean las sesiones al borrar la materia',
    n = 0, 'sesiones borradas: ' || n);
end;
$$;
commit;

-- Un borrado que PIERDE el arbitraje no debe cascadear.
begin;
do $$ begin perform pruebas.como('11111111-1111-4111-8111-111111111111'); end $$;
do $$
declare
  mat uuid := pruebas.id('aaaa1111', 201);
  tema uuid := pruebas.id('aaaa1111', 202);
  epi uuid := pruebas.id('aaaa1111', 203);
  a uuid := '11111111-1111-4111-8111-111111111111';
  tema_borrado boolean;
  epi_borrado boolean;
  ya timestamptz;
begin
  insert into public.materias (id, usuario_id, nombre) values (mat, a, 'M2');
  insert into public.temas (id, usuario_id, materia_id, numero, titulo) values (tema, a, mat, 2, 'T2');
  insert into public.epigrafes (id, usuario_id, tema_id, titulo) values (epi, a, tema, 'E2');

  update public.temas set titulo = 'T2 renombrado', updated_at = now() + interval '1 hour' where id = tema;
  select updated_at into ya from public.temas where id = tema;

  -- Llega tarde un borrado de un dispositivo con marca vieja: debe perder.
  update public.temas set deleted_at = now(), updated_at = ya - interval '30 minutes' where id = tema;

  select deleted_at is not null into tema_borrado from public.temas where id = tema;
  select deleted_at is not null into epi_borrado from public.epigrafes where id = epi;

  perform pruebas.comprobar('cascada', 'un borrado que pierde el LWW no borra el tema',
    not tema_borrado, 'tema borrado = ' || tema_borrado);
  perform pruebas.comprobar('cascada', 'un borrado que pierde el LWW no dispara la cascada',
    not epi_borrado, 'epígrafe borrado = ' || epi_borrado);
end;
$$;
commit;

-- La cascada no debe pisar la fecha de un hijo que ya estaba borrado antes.
begin;
do $$ begin perform pruebas.como('11111111-1111-4111-8111-111111111111'); end $$;
do $$
declare
  mat uuid := pruebas.id('aaaa1111', 301);
  tema uuid := pruebas.id('aaaa1111', 302);
  epi uuid := pruebas.id('aaaa1111', 303);
  a uuid := '11111111-1111-4111-8111-111111111111';
  vieja timestamptz := '2024-01-01 00:00:00+00';
  final timestamptz;
begin
  insert into public.materias (id, usuario_id, nombre) values (mat, a, 'M3');
  insert into public.temas (id, usuario_id, materia_id, numero, titulo) values (tema, a, mat, 3, 'T3');
  insert into public.epigrafes (id, usuario_id, tema_id, titulo, deleted_at) values (epi, a, tema, 'E3', vieja);

  update public.temas set deleted_at = now(), updated_at = now() where id = tema;

  select deleted_at into final from public.epigrafes where id = epi;
  perform pruebas.comprobar('cascada', 'la cascada respeta la tumba previa de un hijo ya borrado',
    final = vieja, 'deleted_at = ' || final);
end;
$$;
commit;

-- ============================================================================
-- 7 · Storage (0002)
-- ============================================================================

begin;
do $$ begin perform pruebas.como('11111111-1111-4111-8111-111111111111'); end $$;
do $$
declare
  a uuid := '11111111-1111-4111-8111-111111111111';
  b uuid := '22222222-2222-4222-8222-222222222222';
  n int;
  pub boolean;
  lim bigint;
begin
  perform pruebas.servidor();
  select public, file_size_limit into pub, lim from storage.buckets where id = 'cantes-audio';
  perform pruebas.comprobar('storage', 'el bucket cantes-audio existe y es privado',
    pub = false, 'public = ' || pub);
  perform pruebas.comprobar('storage', 'el límite de tamaño es 50 MB',
    lim = 52428800, 'file_size_limit = ' || lim);

  -- Dos objetos ya existentes, uno de cada usuario (los pone el servicio).
  insert into storage.objects (bucket_id, name) values
    ('cantes-audio', a::text || '/c1.webm'),
    ('cantes-audio', b::text || '/c2.webm');

  perform pruebas.como(a);

  select count(*) into n from storage.objects;
  perform pruebas.comprobar('storage', 'A solo ve los objetos de su carpeta',
    n = 1, 'objetos visibles: ' || n);

  insert into storage.objects (bucket_id, name) values ('cantes-audio', a::text || '/c3.webm');
  perform pruebas.comprobar('storage', 'A puede subir a su propia carpeta', true, '');

  perform pruebas.comprobar('storage', 'A no puede subir a la carpeta de B',
    pruebas.rechazado(format(
      'insert into storage.objects (bucket_id, name) values (%L, %L)',
      'cantes-audio', b::text || '/c3.webm')),
    'esperado SQLSTATE 42501');

  perform pruebas.comprobar('storage', 'A no puede subir a la raíz del bucket (sin carpeta)',
    pruebas.rechazado(
      'insert into storage.objects (bucket_id, name) values (''cantes-audio'', ''suelto.webm'')'),
    'esperado SQLSTATE 42501');

  delete from storage.objects where name = b::text || '/c2.webm';
  get diagnostics n = row_count;
  perform pruebas.comprobar('storage', 'A no puede borrar el audio de B',
    n = 0, 'filas borradas: ' || n);

  delete from storage.objects where name = a::text || '/c1.webm';
  get diagnostics n = row_count;
  perform pruebas.comprobar('storage', 'A sí puede borrar su propio audio (aquí el delete es físico)',
    n = 1, 'filas borradas: ' || n);

  update storage.objects set metadata = '{"x":1}'::jsonb where name = b::text || '/c2.webm';
  get diagnostics n = row_count;
  perform pruebas.comprobar('storage', 'A no puede reemplazar el audio de B',
    n = 0, 'filas actualizadas: ' || n);

  update storage.objects set metadata = '{"x":1}'::jsonb where name = a::text || '/c3.webm';
  get diagnostics n = row_count;
  perform pruebas.comprobar('storage', 'A sí puede reemplazar el suyo (reintento de subida)',
    n = 1, 'filas actualizadas: ' || n);
end;
$$;
commit;

-- ============================================================================
-- 8 · Índices del pull incremental
--
-- No basta con que el índice exista: hay que ver que el planificador lo elige.
-- Para eso hace falta volumen, si no un seq scan siempre gana.
-- ============================================================================

-- Volumen: 200 usuarios de relleno con datos viejos.
do $$
declare a uuid;
begin
  perform pruebas.servidor();

  insert into auth.users (id, email)
  select gen_random_uuid(), 'relleno' || g || '@ejemplo.es' from generate_series(1, 200) g;

  insert into public.materias (id, usuario_id, nombre, updated_at)
  select gen_random_uuid(), u.id, 'm' || g, now() - (g || ' days')::interval
    from auth.users u, generate_series(1, 100) g
   where u.email like 'relleno%';

  insert into public.temas (id, usuario_id, materia_id, numero, titulo, updated_at)
  select gen_random_uuid(), m.usuario_id, m.id, 1, 't', m.updated_at
    from public.materias m where m.nombre like 'm%' and m.abrev = '';

  insert into public.epigrafes (id, usuario_id, tema_id, titulo, updated_at)
  select gen_random_uuid(), t.usuario_id, t.id, 'e', t.updated_at
    from public.temas t where t.titulo = 't';

  insert into public.progreso_temas (tema_id, usuario_id, updated_at)
  select t.id, t.usuario_id, t.updated_at from public.temas t where t.titulo = 't';

  insert into public.sesiones (id, usuario_id, tema_id, tipo, inicio, fin, segundos, updated_at)
  select gen_random_uuid(), t.usuario_id, t.id, 'estudio', t.updated_at, t.updated_at, 100, t.updated_at
    from public.temas t where t.titulo = 't';

  insert into public.cantes (id, usuario_id, tema_id, segundos, updated_at)
  select gen_random_uuid(), t.usuario_id, t.id, 100, t.updated_at
    from public.temas t where t.titulo = 't';

  insert into public.keypoints (id, usuario_id, tema_id, anverso, reverso, updated_at)
  select gen_random_uuid(), t.usuario_id, t.id, 'a', 'r', t.updated_at
    from public.temas t where t.titulo = 't';

  insert into public.notas (id, usuario_id, tema_id, texto, updated_at)
  select gen_random_uuid(), t.usuario_id, t.id, 'n', t.updated_at
    from public.temas t where t.titulo = 't';

  insert into public.simulacros (id, usuario_id, tipo, updated_at)
  select gen_random_uuid(), t.usuario_id, 'cante', t.updated_at
    from public.temas t where t.titulo = 't';
end;
$$;

analyze;

begin;
do $$ begin perform pruebas.como('11111111-1111-4111-8111-111111111111'); end $$;
do $$
declare
  a uuid := '11111111-1111-4111-8111-111111111111';
  t text;
  r record;
  plan text;
  idx text;
  fallos text := '';
begin
  foreach t in array pruebas.tablas() loop
    idx := t || '_pull_idx';
    plan := '';
    for r in execute format(
      'explain (costs off) select * from public.%I
         where usuario_id = %L and updated_at > now() - interval ''1 hour''
         order by updated_at', t, a)
    loop
      plan := plan || r."QUERY PLAN" || E'\n';
    end loop;

    if position(idx in plan) = 0 then
      fallos := fallos || t || ' [' || replace(trim(plan), E'\n', ' | ') || '] ';
    end if;
  end loop;

  perform pruebas.comprobar('indices',
    'el pull incremental (usuario_id + updated_at) usa el índice *_pull_idx en las 9 tablas',
    fallos = '', coalesce(nullif(fallos, ''), 'las 9 usan su índice de pull'));
end;
$$;
commit;

-- Y el índice de pull NO puede ser parcial: tiene que devolver también tumbas.
do $$
declare n int;
begin
  perform pruebas.servidor();
  select count(*) into n
    from pg_indexes
   where schemaname = 'public'
     and indexname like '%\_pull\_idx'
     and indexdef ilike '%where%';
  perform pruebas.comprobar('indices', 'ningún índice de pull es parcial (las tumbas deben bajar)',
    n = 0, 'índices de pull con WHERE: ' || n);

  select count(*) into n from pg_indexes where schemaname = 'public' and indexname like '%\_pull\_idx';
  perform pruebas.comprobar('indices', 'existen los 9 índices de pull',
    n = 9, 'encontrados: ' || n);
end;
$$;

-- ============================================================================
-- 9 · Resumen
-- ============================================================================

\echo ''
\echo '================================ RESULTADOS ================================'
select n,
       bloque,
       case when ok then 'OK   ' else 'FALLO' end as estado,
       nombre,
       detalle
  from pruebas.resultados
 order by n;

\echo ''
select count(*) filter (where ok)     as ok,
       count(*) filter (where not ok) as fallos,
       count(*)                       as total
  from pruebas.resultados;

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
  insert into public.vueltas (id, usuario_id, tema_id, fecha)
    values (pruebas.id(p_pref, 9), p_uid, pruebas.id(p_pref, 2), now());
  -- El endpoint lleva el prefijo del usuario: es único por navegador, así que
  -- dos usuarios de prueba no pueden compartirlo.
  insert into public.suscripciones_aviso (id, usuario_id, endpoint, clave_p256dh, clave_auth, user_agent)
    values (pruebas.id(p_pref, 10), p_uid, 'https://push.ejemplo.es/' || p_pref,
            'p256dh-' || p_pref, 'auth-' || p_pref, 'Firefox en Linux');
end;
$$;

-- Las once tablas con usuario_id (perfiles va aparte: su RLS es contra la PK).
create function pruebas.tablas()
returns text[]
language sql
immutable
as $$
  select array['materias','temas','epigrafes','progreso_temas',
               'sesiones','cantes','keypoints','notas','simulacros',
               'vueltas','suscripciones_aviso'];
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
  perform pruebas.comprobar('rls', 'select: A no ve ninguna fila de B en las 11 tablas',
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
    fallos = '', coalesce(nullif(fallos, ''), 'las 12 tablas rechazan el delete'));

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
-- 8 · vueltas y avisos (0003)
-- ============================================================================

-- --------------------------------------------------------------- vueltas ----
-- B siembra unas cuantas vueltas propias para que el aislamiento se pruebe
-- contra filas que existen de verdad, no contra una tabla vacía.
begin;
do $$ begin perform pruebas.como('22222222-2222-4222-8222-222222222222'); end $$;
do $$
declare
  b uuid := '22222222-2222-4222-8222-222222222222';
  mat uuid := pruebas.id('bbbb2222', 401);
  tema uuid := pruebas.id('bbbb2222', 402);
begin
  insert into public.materias (id, usuario_id, nombre) values (mat, b, 'Fiscal');
  insert into public.temas (id, usuario_id, materia_id, numero, titulo) values (tema, b, mat, 9, 'T9');
  insert into public.vueltas (id, usuario_id, tema_id, fecha)
  select pruebas.id('bbbb2222', 402 + g), b, tema, now() - (g || ' days')::interval
    from generate_series(1, 4) g;
end;
$$;
commit;

begin;
do $$ begin perform pruebas.como('11111111-1111-4111-8111-111111111111'); end $$;
do $$
declare
  a uuid := '11111111-1111-4111-8111-111111111111';
  b uuid := '22222222-2222-4222-8222-222222222222';
  mat uuid := pruebas.id('aaaa1111', 401);
  tema uuid := pruebas.id('aaaa1111', 402);
  otro uuid := pruebas.id('aaaa1111', 406);
  v1 uuid := pruebas.id('aaaa1111', 403);
  n int;
  t0 timestamptz;
  t1 timestamptz;
begin
  insert into public.materias (id, usuario_id, nombre) values (mat, a, 'Hipotecario');
  insert into public.temas (id, usuario_id, materia_id, numero, titulo) values
    (tema, a, mat, 4, 'T4'),
    (otro, a, mat, 5, 'T5');
  insert into public.vueltas (id, usuario_id, tema_id, fecha) values
    (v1,                          a, tema, now() - interval '30 days'),
    (pruebas.id('aaaa1111', 404), a, tema, now() - interval '15 days'),
    (pruebas.id('aaaa1111', 405), a, tema, now() - interval '2 days'),
    -- Una vuelta de otro tema, para poder comprobar que la cascada no se lleva
    -- por delante lo que no es suyo.
    (pruebas.id('aaaa1111', 407), a, otro, now() - interval '3 days');

  -- La razón de ser de la tabla: el contador se recompone contando filas.
  select count(*) into n from public.vueltas where tema_id = tema and deleted_at is null;
  perform pruebas.comprobar('vueltas', 'el recuento de un tema sale de contar filas (no del contador en caché)',
    n = 3, 'vueltas contadas: ' || n);

  -- RLS entre dos usuarios.
  select count(*) into n from public.vueltas where usuario_id = b;
  perform pruebas.comprobar('vueltas', 'rls: A no ve ninguna vuelta de B',
    n = 0, 'vueltas de B visibles: ' || n);

  select count(*) into n from public.vueltas;
  perform pruebas.comprobar('vueltas', 'rls: A solo ve las suyas (4 nuevas + la de la siembra)',
    n = 5, 'vueltas visibles: ' || n);

  perform pruebas.comprobar('vueltas', 'rls: A no puede insertar una vuelta a nombre de B',
    pruebas.rechazado(format(
      'insert into public.vueltas (usuario_id, tema_id, fecha) values (%L, %L, now())',
      b, tema)),
    'esperado SQLSTATE 42501');

  perform pruebas.comprobar('vueltas', 'rls: A no puede regalarle una vuelta suya a B',
    pruebas.rechazado(format(
      'update public.vueltas set usuario_id = %L where id = %L', b, v1)),
    'esperado SQLSTATE 42501');

  update public.vueltas set fecha = now() where usuario_id = b;
  get diagnostics n = row_count;
  perform pruebas.comprobar('vueltas', 'rls: A no puede modificar las vueltas de B',
    n = 0, 'filas ajenas tocadas: ' || n);

  -- DELETE imposible: sin política, un delete sin where afecta a 0 filas.
  delete from public.vueltas;
  get diagnostics n = row_count;
  perform pruebas.comprobar('vueltas', 'un delete sin where afecta a 0 filas',
    n = 0, 'filas borradas: ' || n);
  select count(*) into n from public.vueltas;
  perform pruebas.comprobar('vueltas', 'nada ha desaparecido tras el delete',
    n = 5, 'vueltas visibles: ' || n);

  -- El trigger de updated_at es el de 0001, con su avance monótono.
  select updated_at into t0 from public.vueltas where id = v1;
  update public.vueltas set fecha = now() where id = v1;
  select updated_at into t1 from public.vueltas where id = v1;
  perform pruebas.comprobar('vueltas', 'un update avanza updated_at (trigger reutilizado de 0001)',
    t1 > t0, t0 || ' -> ' || t1);

  update public.vueltas set fecha = now(), updated_at = t1 - interval '1 day' where id = v1;
  select updated_at into t0 from public.vueltas where id = v1;
  perform pruebas.comprobar('vueltas', 'una escritura con updated_at más antiguo NO gana',
    t0 = t1, 'updated_at = ' || t0);
end;
$$;
commit;

-- Cascada: borrar el tema tiene que enterrar sus vueltas y hacerlas bajar.
begin;
do $$ begin perform pruebas.como('11111111-1111-4111-8111-111111111111'); end $$;
do $$
declare
  a uuid := '11111111-1111-4111-8111-111111111111';
  tema uuid := pruebas.id('aaaa1111', 402);
  antes timestamptz;
  n int;
begin
  select min(updated_at) into antes from public.vueltas where tema_id = tema;

  update public.temas set deleted_at = now(), updated_at = now() where id = tema;

  select count(*) into n from public.vueltas where tema_id = tema and deleted_at is null;
  perform pruebas.comprobar('cascada', 'borrar un tema arrastra también sus vueltas',
    n = 0, 'vueltas del tema sin enterrar: ' || n);

  select count(*) into n from public.vueltas where tema_id = tema and updated_at > antes;
  perform pruebas.comprobar('cascada', 'las tumbas de las vueltas bajan en el pull incremental',
    n = 3, 'vueltas devueltas por el pull: ' || n);

  -- Y el recuento derivado del tema borrado se queda a cero: una vuelta viva
  -- de un tema que ya no existe inflaría la cuenta.
  select count(*) into n from public.vueltas where tema_id = tema and deleted_at is null;
  perform pruebas.comprobar('cascada', 'el recuento derivado de un tema borrado queda a cero',
    n = 0, 'vueltas vivas: ' || n);

  -- Las vueltas de OTROS temas no se tocan.
  select count(*) into n from public.vueltas
   where usuario_id = a and tema_id <> tema and deleted_at is null;
  perform pruebas.comprobar('cascada', 'la cascada de un tema no toca las vueltas de otros temas',
    n = 1, 'vueltas vivas de otros temas: ' || n);
end;
$$;
commit;

-- ---------------------------------------------------------------- avisos ----
begin;
do $$ begin perform pruebas.como('11111111-1111-4111-8111-111111111111'); end $$;
do $$
declare
  a uuid := '11111111-1111-4111-8111-111111111111';
  b uuid := '22222222-2222-4222-8222-222222222222';
  movil uuid := pruebas.id('aaaa1111', 501);
  portatil uuid := pruebas.id('aaaa1111', 502);
  n int;
  clave text;
  borrada timestamptz;
begin
  -- Varios dispositivos por usuario: es la razón de que sea tabla y no columnas
  -- de perfiles.
  insert into public.suscripciones_aviso (id, usuario_id, endpoint, clave_p256dh, clave_auth, user_agent, zona_horaria)
  values (movil,    a, 'https://fcm.ejemplo.es/movil',    'k1', 'a1', 'Chrome en Android', 'Atlantic/Canary'),
         (portatil, a, 'https://fcm.ejemplo.es/portatil', 'k2', 'a2', 'Firefox en Linux',  'Europe/Madrid');

  select count(*) into n from public.suscripciones_aviso
   where usuario_id = a and deleted_at is null and caducada_at is null;
  perform pruebas.comprobar('avisos', 'un mismo usuario puede tener varios dispositivos suscritos',
    n = 3, 'suscripciones vivas: ' || n);

  -- Aislamiento.
  select count(*) into n from public.suscripciones_aviso where usuario_id = b;
  perform pruebas.comprobar('avisos', 'rls: A no ve las suscripciones de B (ni sus claves)',
    n = 0, 'suscripciones de B visibles: ' || n);

  perform pruebas.comprobar('avisos', 'rls: A no puede registrar un dispositivo a nombre de B',
    pruebas.rechazado(format(
      'insert into public.suscripciones_aviso (usuario_id, endpoint, clave_p256dh, clave_auth)
         values (%L, %L, %L, %L)', b, 'https://fcm.ejemplo.es/robado', 'k', 'a')),
    'esperado SQLSTATE 42501');

  -- El endpoint es único por usuario: resuscribirse no duplica la fila.
  perform pruebas.comprobar('avisos', 'el mismo endpoint no se puede duplicar',
    pruebas.rechazado(
      format('insert into public.suscripciones_aviso (id, usuario_id, endpoint, clave_p256dh, clave_auth)
                values (%L, %L, %L, %L, %L)',
             gen_random_uuid(), a, 'https://fcm.ejemplo.es/movil', 'kx', 'ax'),
      '23505'),
    'esperado SQLSTATE 23505 (unique)');

  -- ...y el upsert por (usuario_id, endpoint) refresca las claves en su sitio.
  -- Va en un sub-bloque con handler para que la falta del índice único (que es
  -- lo que hace posible el ON CONFLICT) salga como comprobación en rojo y no
  -- como un error que se lleve por delante el resto del bloque.
  begin
    insert into public.suscripciones_aviso (id, usuario_id, endpoint, clave_p256dh, clave_auth)
    values (gen_random_uuid(), a, 'https://fcm.ejemplo.es/movil', 'k1-nueva', 'a1-nueva')
    on conflict (usuario_id, endpoint)
      do update set clave_p256dh = excluded.clave_p256dh, clave_auth = excluded.clave_auth;
  exception when others then
    perform pruebas.comprobar('avisos', 'el upsert por (usuario_id, endpoint) es posible',
      false, sqlstate || ' ' || sqlerrm);
  end;

  select clave_p256dh into clave from public.suscripciones_aviso where id = movil;
  select count(*) into n from public.suscripciones_aviso where usuario_id = a;
  perform pruebas.comprobar('avisos', 'resuscribirse refresca las claves sin crear un dispositivo nuevo',
    clave = 'k1-nueva' and n = 3, 'clave=' || clave || ' filas=' || n);

  -- Endpoint muerto: se marca, no se borra.
  update public.suscripciones_aviso set caducada_at = now() where id = movil;
  select count(*) into n from public.suscripciones_aviso where id = movil;
  select deleted_at into borrada from public.suscripciones_aviso where id = movil;
  perform pruebas.comprobar('avisos', 'un endpoint caducado se marca y la fila sigue existiendo',
    n = 1 and borrada is null, 'filas=' || n || ' deleted_at=' || coalesce(borrada::text, 'null'));

  select count(*) into n from public.suscripciones_aviso
   where usuario_id = a and deleted_at is null and caducada_at is null;
  perform pruebas.comprobar('avisos', 'la consulta de envío ignora las caducadas',
    n = 2, 'suscripciones a las que enviar: ' || n);

  -- Y la baja del usuario es otra cosa distinta de la caducidad.
  update public.suscripciones_aviso set deleted_at = now() where id = portatil;
  select count(*) into n from public.suscripciones_aviso
   where usuario_id = a and deleted_at is null and caducada_at is null;
  perform pruebas.comprobar('avisos', 'dar de baja un dispositivo lo saca del envío sin borrar la fila',
    n = 1, 'suscripciones a las que enviar: ' || n);

  delete from public.suscripciones_aviso;
  get diagnostics n = row_count;
  perform pruebas.comprobar('avisos', 'un delete sin where sobre las suscripciones afecta a 0 filas',
    n = 0, 'filas borradas: ' || n);
end;
$$;
commit;

-- Preferencias de aviso: viven en perfiles, con su RLS contra la PK.
begin;
do $$ begin perform pruebas.como('11111111-1111-4111-8111-111111111111'); end $$;
do $$
declare
  a uuid := '11111111-1111-4111-8111-111111111111';
  b uuid := '22222222-2222-4222-8222-222222222222';
  activos boolean;
  hora time;
  dias int[];
  tipos text[];
  n int;
begin
  select avisos_activos, aviso_hora, aviso_dias, aviso_tipos
    into activos, hora, dias, tipos
    from public.perfiles where id = a;
  perform pruebas.comprobar('avisos', 'las preferencias nacen apagadas (el push exige permiso explícito)',
    activos = false, 'avisos_activos = ' || activos);
  perform pruebas.comprobar('avisos', 'los valores por defecto de las preferencias son utilizables',
    hora = '20:00'::time and dias = array[1,2,3,4,5,6,7] and tipos @> array['oxido'],
    'hora=' || hora || ' dias=' || dias::text || ' tipos=' || tipos::text);

  update public.perfiles
     set avisos_activos = true, aviso_hora = '07:30', aviso_dias = array[1,2,3,4,5]
   where id = a;
  select aviso_hora into hora from public.perfiles where id = a;
  perform pruebas.comprobar('avisos', 'el opositor puede cambiar sus preferencias',
    hora = '07:30'::time, 'aviso_hora = ' || hora);

  perform pruebas.comprobar('avisos', 'no se aceptan días fuera de 1..7',
    pruebas.rechazado('update public.perfiles set aviso_dias = array[0,9]', '23514'),
    'esperado SQLSTATE 23514 (check)');
  perform pruebas.comprobar('avisos', 'no se aceptan tipos de aviso inventados',
    pruebas.rechazado('update public.perfiles set aviso_tipos = array[''spam'']', '23514'),
    'esperado SQLSTATE 23514 (check)');

  update public.perfiles set avisos_activos = true where id = b;
  get diagnostics n = row_count;
  perform pruebas.comprobar('avisos', 'rls: A no puede tocar las preferencias de aviso de B',
    n = 0, 'perfiles ajenos tocados: ' || n);
end;
$$;
commit;

-- ============================================================================
-- 0006 · apariencia y hábitos de lista
--
-- Viven en `perfiles`, con su RLS contra la PK. Lo que hay que demostrar es
-- que los DEFAULT dejan la app exactamente como estaba (si no, la migración le
-- cambia la pantalla a todo el mundo), que los checks no dejan entrar basura y
-- que el sepia —lo único que AMPLÍA un check que ya existía— se acepta.
-- ============================================================================

begin;
do $$ begin perform pruebas.como('11111111-1111-4111-8111-111111111111'); end $$;
do $$
declare
  a uuid := '11111111-1111-4111-8111-111111111111';
  b uuid := '22222222-2222-4222-8222-222222222222';
  f record;
  n int;
begin
  select tema, acento, acento_personal, fuente_temas, tamano_tema, densidad,
         orden_temas, vista_programa
    into f
    from public.perfiles where id = a;

  -- Esto es LA prueba de la migración: un perfil que ya existía y al que nadie
  -- ha tocado tiene que seguir dando exactamente la app de siempre.
  perform pruebas.comprobar('apariencia', 'los valores por defecto son la app de siempre',
    f.tema = 'dark' and f.acento = 'lacre' and f.acento_personal is null
      and f.fuente_temas = 'serif' and f.tamano_tema = 17 and f.densidad = 'normal'
      and f.orden_temas = 'numero' and f.vista_programa = 'mural',
    'tema=' || f.tema || ' acento=' || f.acento || ' fuente=' || f.fuente_temas
      || ' tamano=' || f.tamano_tema || ' densidad=' || f.densidad
      || ' orden=' || f.orden_temas || ' vista=' || f.vista_programa);

  update public.perfiles
     set tema = 'sepia', acento = 'personal', acento_personal = '#2F6FB0',
         fuente_temas = 'sans', tamano_tema = 20, densidad = 'compacta',
         orden_temas = 'urgencia', vista_programa = 'lista'
   where id = a;
  select tema, acento_personal, tamano_tema, orden_temas
    into f from public.perfiles where id = a;
  perform pruebas.comprobar('apariencia', 'el opositor puede personalizar la app entera',
    f.tema = 'sepia' and f.acento_personal = '#2F6FB0' and f.tamano_tema = 20
      and f.orden_temas = 'urgencia',
    'tema=' || f.tema || ' color=' || f.acento_personal || ' tamano=' || f.tamano_tema);

  perform pruebas.comprobar('apariencia', 'no se acepta un tono base inventado',
    pruebas.rechazado($x$update public.perfiles set tema = 'fucsia'$x$, '23514'),
    'esperado SQLSTATE 23514 (check)');
  perform pruebas.comprobar('apariencia', 'no se acepta un acento fuera de la paleta',
    pruebas.rechazado($x$update public.perfiles set acento = 'arcoiris'$x$, '23514'),
    'esperado SQLSTATE 23514 (check)');
  perform pruebas.comprobar('apariencia', 'el acento libre tiene que ser un #rrggbb',
    pruebas.rechazado($x$update public.perfiles set acento_personal = 'rojo'$x$, '23514'),
    'esperado SQLSTATE 23514 (check)');
  perform pruebas.comprobar('apariencia', 'un cuerpo de texto ilegible no entra',
    pruebas.rechazado($x$update public.perfiles set tamano_tema = 400$x$, '23514'),
    'esperado SQLSTATE 23514 (check)');
  perform pruebas.comprobar('apariencia', 'tampoco por abajo',
    pruebas.rechazado($x$update public.perfiles set tamano_tema = 4$x$, '23514'),
    'esperado SQLSTATE 23514 (check)');
  perform pruebas.comprobar('apariencia', 'no se acepta una densidad inventada',
    pruebas.rechazado($x$update public.perfiles set densidad = 'holgada'$x$, '23514'),
    'esperado SQLSTATE 23514 (check)');
  perform pruebas.comprobar('apariencia', 'no se acepta una fuente inventada',
    pruebas.rechazado($x$update public.perfiles set fuente_temas = 'comic'$x$, '23514'),
    'esperado SQLSTATE 23514 (check)');
  perform pruebas.comprobar('apariencia', 'no se acepta un criterio de orden inventado',
    pruebas.rechazado($x$update public.perfiles set orden_temas = 'al-azar'$x$, '23514'),
    'esperado SQLSTATE 23514 (check)');
  perform pruebas.comprobar('apariencia', 'no se acepta una vista de programa inventada',
    pruebas.rechazado($x$update public.perfiles set vista_programa = 'carrusel'$x$, '23514'),
    'esperado SQLSTATE 23514 (check)');

  -- El acento libre puede vaciarse: es null mientras el acento no sea el suyo.
  update public.perfiles set acento = 'jade', acento_personal = null where id = a;
  select acento_personal into f from public.perfiles where id = a;
  perform pruebas.comprobar('apariencia', 'el acento libre se puede vaciar',
    f.acento_personal is null, 'acento_personal = ' || coalesce(f.acento_personal, 'null'));

  update public.perfiles set acento = 'cobre' where id = b;
  get diagnostics n = row_count;
  perform pruebas.comprobar('apariencia', 'rls: A no puede cambiarle la apariencia a B',
    n = 0, 'perfiles ajenos tocados: ' || n);
end;
$$;
commit;

-- La apariencia viaja como cualquier otra columna: al tocarla, el reloj del
-- last-write-wins tiene que avanzar. Si no avanzara, el otro dispositivo no se
-- enteraría nunca de que el opositor cambió de tono.
begin;
do $$ begin perform pruebas.como('11111111-1111-4111-8111-111111111111'); end $$;
do $$
declare
  a uuid := '11111111-1111-4111-8111-111111111111';
  antes timestamptz;
  despues timestamptz;
begin
  select updated_at into antes from public.perfiles where id = a;
  update public.perfiles set densidad = 'normal', tamano_tema = 19 where id = a;
  select updated_at into despues from public.perfiles where id = a;
  perform pruebas.comprobar('apariencia', 'cambiar la apariencia mueve updated_at (si no, no viaja)',
    despues > antes, antes::text || ' -> ' || despues::text);
end;
$$;
commit;

-- Ninguna de las tablas nuevas puede tener política de DELETE.
do $$
declare n int;
begin
  perform pruebas.servidor();
  select count(*) into n from pg_policies
   where schemaname = 'public' and cmd = 'DELETE';
  perform pruebas.comprobar('delete', 'ninguna tabla de public tiene política de DELETE (tampoco las de 0003)',
    n = 0, 'políticas de DELETE: ' || n);

  select count(*) into n from pg_tables
   where schemaname = 'public' and not rowsecurity;
  perform pruebas.comprobar('rls', 'todas las tablas de public tienen RLS activada',
    n = 0, 'tablas sin RLS: ' || n);
end;
$$;

-- ============================================================================
-- 9 · Índices del pull incremental
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

  insert into public.vueltas (id, usuario_id, tema_id, fecha, updated_at)
  select gen_random_uuid(), t.usuario_id, t.id, t.updated_at, t.updated_at
    from public.temas t where t.titulo = 't';

  -- Varios dispositivos por usuario de relleno: el endpoint tiene que ser
  -- único dentro de cada uno, de ahí el número en la URL.
  insert into public.suscripciones_aviso (id, usuario_id, endpoint, clave_p256dh, clave_auth, updated_at)
  select gen_random_uuid(), u.id, 'https://fcm.ejemplo.es/' || u.id || '/' || g, 'k', 'a',
         now() - (g || ' days')::interval
    from auth.users u, generate_series(1, 50) g
   where u.email like 'relleno%';
end;
$$;

-- Volumen aparte SOLO para perfiles: el índice del programador de avisos se
-- consulta sobre todos los perfiles a la vez, y con doscientas filas el
-- planificador elige un seq scan por bueno que sea el índice. Estos usuarios
-- llevan otro prefijo de email para no entrar en el relleno de arriba: solo
-- interesan sus perfiles, que crea el trigger al_crear_usuario.
do $$
begin
  perform pruebas.servidor();

  insert into auth.users (id, email)
  select gen_random_uuid(), 'soloperfil' || g || '@ejemplo.es' from generate_series(1, 4000) g;

  -- Uno de cada veinte quiere avisos, repartidos por las 24 horas: así el
  -- índice parcial es pequeño y la consulta del programador, muy selectiva.
  update public.perfiles p
     set avisos_activos = true,
         aviso_hora = (((abs(hashtext(p.id::text)) % 24) || ':00'))::time
    from auth.users u
   where u.id = p.id
     and u.email like 'soloperfil%'
     and abs(hashtext(p.id::text)) % 20 = 0;
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
    'el pull incremental (usuario_id + updated_at) usa el índice *_pull_idx en las 11 tablas',
    fallos = '', coalesce(nullif(fallos, ''), 'las 11 usan su índice de pull'));
end;
$$;
commit;

-- El índice del programador de avisos: "a quién le toca aviso a esta hora".
-- Corre con la service_role sobre todos los perfiles, así que no lleva
-- usuario_id delante y es el único caso así del esquema.
do $$
declare
  r record;
  plan text := '';
begin
  perform pruebas.servidor();
  for r in
    explain (costs off)
    select id from public.perfiles
     where avisos_activos and deleted_at is null and aviso_hora = '08:00'::time
  loop
    plan := plan || r."QUERY PLAN" || E'\n';
  end loop;

  perform pruebas.comprobar('indices', 'la consulta del programador de avisos usa perfiles_aviso_hora_idx',
    position('perfiles_aviso_hora_idx' in plan) > 0, replace(trim(plan), E'\n', ' | '));
end;
$$;

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
  perform pruebas.comprobar('indices', 'existen los 11 índices de pull',
    n = 11, 'encontrados: ' || n);
end;
$$;

-- ============================================================================
-- 9bis · avisos_enviados (0004)
--
-- Es la memoria de qué aviso se mandó. Sin ella el anti-repeticion no existe,
-- asi que el opositor recibiria el mismo "llevas 11 dias sin tocar
-- Hipotecario" cada manana. Y es la unica tabla del esquema que el usuario
-- puede leer pero no escribir: si pudiera insertar, se silenciaria solo.
-- ============================================================================

do $$
declare
  a uuid := '11111111-1111-4111-8111-111111111111';
  b uuid := '22222222-2222-4222-8222-222222222222';
  n int;
  hoy date := current_date;
begin
  -- El cron escribe con el rol de servidor (service_role se salta la RLS).
  perform pruebas.servidor();
  insert into public.avisos_enviados (usuario_id, clave, tipo, titulo, cuerpo, url, dia)
  values (a, 'oxido:tema:' || pruebas.id('aaaa1111', 2), 'oxido',
          'Tema 2 lleva 47 dias parado', 'Repasalo hoy', '/tema/x', hoy);

  -- El tope diario lo impone la base, no solo el codigo: dos pasadas
  -- solapadas del cron no pueden colar un segundo aviso.
  perform pruebas.comprobar('avisos', 'un unico aviso por usuario y dia (indice unico)',
    pruebas.rechazado(format(
      'insert into public.avisos_enviados (usuario_id, clave, tipo, titulo, cuerpo, url, dia)
       values (%L, %L, %L, %L, %L, %L, %L)',
      a, 'racha', 'racha', 'Se te rompe la racha', 'Hoy no has estudiado', '/', hoy),
      '23505'),
    'esperaba violacion de unicidad');

  -- Otro dia si, y otro usuario el mismo dia tambien.
  insert into public.avisos_enviados (usuario_id, clave, tipo, titulo, cuerpo, url, dia)
  values (a, 'racha', 'racha', 'Racha', 'x', '/', hoy - 1),
         (b, 'ritmo:2026-09-01', 'ritmo', 'Ritmo', 'x', '/', hoy);
  select count(*) into n from public.avisos_enviados;
  perform pruebas.comprobar('avisos', 'el tope es por usuario y dia, no global',
    n = 3, 'filas: ' || n);

  -- Aislamiento: cada opositor solo ve su historial.
  perform pruebas.como(a);
  select count(*) into n from public.avisos_enviados;
  perform pruebas.comprobar('avisos', 'la RLS aisla el historial entre usuarios',
    n = 2, 'A ve ' || n || ' filas (deberia ver 2)');

  -- Sin politica de insert: nadie puede fabricarse un historial falso para
  -- silenciarse los avisos a si mismo.
  perform pruebas.comprobar('avisos', 'el usuario NO puede insertar avisos',
    pruebas.rechazado(format(
      'insert into public.avisos_enviados (usuario_id, clave, tipo, titulo, cuerpo, url, dia)
       values (%L, %L, %L, %L, %L, %L, %L)',
      a, 'inventado', 'oxido', 'x', 'x', '/', hoy + 1)),
    'esperaba rechazo por RLS');

  -- Ni borrar el historial para reiniciar el contador. Ojo: sin politica de
  -- DELETE, Postgres NO lanza error; simplemente el DELETE no ve ninguna fila
  -- y borra cero. Hay que comprobar el efecto, no la excepcion.
  delete from public.avisos_enviados;
  select count(*) into n from public.avisos_enviados;
  perform pruebas.comprobar('avisos', 'el borrado del usuario no elimina nada (0 filas afectadas)',
    n = 2, 'A sigue viendo ' || n || ' filas tras intentar borrarlas');

  perform pruebas.servidor();
  select count(*) into n from public.avisos_enviados;
  perform pruebas.comprobar('avisos', 'el historial completo sigue intacto en el servidor',
    n = 3, 'filas totales: ' || n);

  perform pruebas.servidor();
end;
$$;

-- El indice del anti-repeticion tiene que usarse de verdad: esta consulta se
-- hace por cada usuario en cada pasada del cron.
do $$
declare
  plan text;
begin
  perform pruebas.servidor();
  -- Con tres filas el planificador siempre elegira Seq Scan, asi que un
  -- EXPLAIN a secas no dice nada. Apagando seqscan comprobamos lo que de
  -- verdad importa: que EXISTE un indice que cubre esta consulta, la que el
  -- cron hace por cada usuario en cada pasada.
  set local enable_seqscan = off;

  -- En formato texto EXPLAIN devuelve una fila por linea y `into` solo coge
  -- la primera, que nunca menciona el indice. En JSON es una unica fila con
  -- el plan entero.
  execute 'explain (format json) select 1 from public.avisos_enviados
             where usuario_id = ''11111111-1111-4111-8111-111111111111''
               and clave = ''racha''
             order by dia desc limit 1'
    into plan;
  perform pruebas.comprobar('avisos', 'el indice de anti-repeticion se usa',
    plan ilike '%avisos_enviados_clave_idx%',
    'plan: ' || left(plan, 200));
end;
$$;

-- ============================================================================
-- 9ter · transcripción y comparación del cante (0005)
--
-- Las dos columnas que le faltaban a `cantes` para que el trabajo del
-- transcriptor y del modelo saliera del aparato que lo generó. Aquí se
-- comprueba lo que solo falla contra columnas de verdad: que existen, que
-- guardan y devuelven el documento entero, y —lo importante— que el arbitraje
-- last-write-wins las trata como al resto de la fila.
-- ============================================================================

begin;
do $$ begin perform pruebas.como('11111111-1111-4111-8111-111111111111'); end $$;

do $$
declare
  cid uuid := pruebas.id('aaaa1111', 201);
  a uuid := '11111111-1111-4111-8111-111111111111';
  tipo_t text;
  tipo_c text;
  t0 timestamptz;
  tr jsonb;
  cp jsonb;
begin
  select data_type into tipo_t from information_schema.columns
   where table_schema = 'public' and table_name = 'cantes' and column_name = 'transcripcion';
  select data_type into tipo_c from information_schema.columns
   where table_schema = 'public' and table_name = 'cantes' and column_name = 'comparacion';
  perform pruebas.comprobar('cante0005', 'cantes.transcripcion existe y es jsonb',
    tipo_t = 'jsonb', 'tipo = ' || coalesce(tipo_t, '(no existe)'));
  perform pruebas.comprobar('cante0005', 'cantes.comparacion existe y es jsonb',
    tipo_c = 'jsonb', 'tipo = ' || coalesce(tipo_c, '(no existe)'));

  -- Un cante sin transcripción es una fila legítima: la grabación puede estar
  -- pendiente de transcribir, o no haber grabación.
  insert into public.cantes (id, usuario_id, tema_id, segundos, nota)
    values (cid, a, pruebas.id('aaaa1111', 2), 600, 8);
  select transcripcion, comparacion into tr, cp from public.cantes where id = cid;
  perform pruebas.comprobar('cante0005', 'nacen a null (todavía no hay nada)',
    tr is null and cp is null, 'transcripcion=' || coalesce(tr::text, 'null'));

  -- El documento entra y sale entero, anidados incluidos: es lo que
  -- `deFilaCante` vuelve a montar en el cliente.
  update public.cantes
     set transcripcion = '{"texto":"artículo 1857","motor":"prueba/whisper","generado":1,"segundos":600}'::jsonb,
         comparacion   = '{"titular":"floja","cobertura":41,"omisiones":[{"epigrafe":"Concepto","tipo":"articulo","falta":"1875 CC","gravedad":"alta"}],"dichoDeMas":[],"epigrafesIncompletos":[],"literalidad":"parafrasea","generado":2,"modelo":"prueba/modelo"}'::jsonb
   where id = cid;
  select transcripcion, comparacion, updated_at into tr, cp, t0 from public.cantes where id = cid;
  perform pruebas.comprobar('cante0005', 'la transcripción viaja entera',
    tr->>'texto' = 'artículo 1857' and (tr->>'segundos')::int = 600, 'tr = ' || tr::text);
  perform pruebas.comprobar('cante0005', 'la comparación conserva sus omisiones anidadas',
    (cp->'omisiones'->0->>'falta') = '1875 CC' and (cp->>'cobertura')::int = 41,
    'cp = ' || left(cp::text, 120));

  -- LWW: una escritura más vieja no puede llevárselas por delante. Es el caso
  -- del móvil que estuvo sin cobertura y sube un cante sin analizar.
  update public.cantes
     set transcripcion = null, comparacion = null, nota = 3,
         updated_at = t0 - interval '1 day'
   where id = cid;
  select transcripcion, comparacion into tr, cp from public.cantes where id = cid;
  perform pruebas.comprobar('cante0005', 'una escritura perdedora no borra la transcripción',
    tr is not null and cp is not null, 'transcripcion=' || coalesce(tr::text, 'null'));

  -- Y una ganadora sí manda, también para vaciarlas: la granularidad sigue
  -- siendo la fila entera (§4), aquí no hay merge por campos.
  update public.cantes
     set transcripcion = null, nota = 3, updated_at = t0 + interval '1 minute'
   where id = cid;
  select transcripcion into tr from public.cantes where id = cid;
  perform pruebas.comprobar('cante0005', 'una escritura ganadora sí puede vaciarla',
    tr is null, 'transcripcion=' || coalesce(tr::text, 'null'));
end;
$$;
commit;

-- ============================================================================
-- 9quater · El `creado_at` del servidor, que es de donde sale el desfase
--
-- La corrección de deriva de relojes (lib/sync/reloj.ts, docs §4) se apoya en
-- una sola cosa: que `creado_at` lo pone el reloj del SERVIDOR al insertar,
-- aunque el cliente mande su propio `updated_at`, y que el RETURNING se lo
-- devuelve. Si algún día el esquema dejara de cumplirlo, la estimación del
-- desfase se iría a cero en silencio y nadie se enteraría. Por eso está aquí.
-- ============================================================================

begin;
do $$ begin perform pruebas.como('11111111-1111-4111-8111-111111111111'); end $$;

do $$
declare
  mid uuid := pruebas.id('aaaa1111', 202);
  a uuid := '11111111-1111-4111-8111-111111111111';
  futuro timestamptz := now() + interval '10 minutes';
  creado timestamptz;
  antes timestamptz := now();
  devuelto timestamptz;
begin
  -- Un móvil con el reloj diez minutos adelantado inserta una fila.
  insert into public.materias (id, usuario_id, nombre, updated_at)
    values (mid, a, 'reloj adelantado 0005', futuro)
  returning creado_at into devuelto;

  perform pruebas.comprobar('desfase', 'el RETURNING del insert devuelve creado_at',
    devuelto is not null, 'creado_at = ' || coalesce(devuelto::text, 'null'));
  perform pruebas.comprobar('desfase', 'creado_at lo pone el servidor, no el cliente adelantado',
    devuelto < futuro and devuelto >= antes,
    'creado_at = ' || devuelto || ', marca del cliente = ' || futuro);

  -- Y un update posterior no lo mueve: la medida siempre es "cuándo nació la
  -- fila según el servidor", nunca la marca de nadie más.
  update public.materias set nombre = 'editada', updated_at = futuro + interval '1 minute'
   where id = mid;
  select creado_at into creado from public.materias where id = mid;
  perform pruebas.comprobar('desfase', 'creado_at no se mueve con los updates',
    creado = devuelto, creado || ' vs ' || devuelto);
end;
$$;
commit;

-- ============================================================================
-- 10 · Resumen
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

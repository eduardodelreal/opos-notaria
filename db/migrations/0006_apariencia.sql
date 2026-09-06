-- ============================================================================
-- opos-notaria — 0006 · apariencia y hábitos de lista
--
-- El opositor se pasa años delante de esta pantalla. Poder ajustarla a su
-- gusto —acento, tono base, tipografía y cuerpo del texto de los temas,
-- densidad de la interfaz, con qué criterio se ordenan los temas— no es un
-- capricho, y por eso no puede quedarse en el navegador donde la configuró:
-- cambia el orden de los temas en el portátil y el móvil tiene que abrir
-- igual, exactamente como ya pasa con `dias_oxido` o `estilo_feedback`.
--
-- Por qué en `perfiles` y no en tabla aparte: es la misma clase de dato que
-- las preferencias de aviso de 0003 (bloque 4) y el razonamiento es el mismo.
-- Un ajuste único por opositor, que cambia de uvas a peras y que vale en
-- todos sus dispositivos. Nunca habrá más de una fila por usuario, así que
-- una tabla propia solo añadiría una entidad al push, un índice de pull y una
-- fila que crear en el alta, a cambio de nada.
--
-- Lo que NO va aquí, y conviene decirlo: nada de esto es "el tema del
-- dispositivo". Si mañana hiciera falta que un aparato concreto se salte la
-- preferencia común (un portátil viejo con la pantalla lavada), eso sería una
-- columna en `suscripciones_aviso` o una clave de localStorage, no aquí.
--
-- Depende de 0001 (crea public.perfiles) y redefine su check de `tema`.
-- Aplíquese después, como todas.
--
-- Idempotente: se puede reaplicar entero sin miedo.
-- ============================================================================

-- ============================================================================
-- 1 · El tono base admite un tercer valor: sepia
--
-- `tema` ya existía con `check (tema in ('dark','light'))`. El sepia (papel
-- cálido) es lo que pide medio mundo para leer temas durante horas, y ni el
-- oscuro ni el blanco puro lo dan.
--
-- Se hace ampliando el check que ya hay y NO añadiendo una columna nueva: dos
-- columnas que dicen cuál es el fondo acabarían contradiciéndose, y ya
-- sabemos cuál de las dos leería cada pantalla (la que tocara).
--
-- El nombre `perfiles_tema_check` es el que Postgres le puso al check en
-- línea de 0001. El `drop ... if exists` deja el fichero reaplicable; si
-- alguien reaplicara 0001 DESPUÉS de este, el `create table if not exists` no
-- recrearía nada y el check ampliado seguiría en su sitio.
-- ============================================================================

alter table public.perfiles drop constraint if exists perfiles_tema_check;

do $bloque$
begin
  if not exists (select 1 from pg_constraint where conname = 'perfiles_tema_check') then
    alter table public.perfiles add constraint perfiles_tema_check
      check (tema in ('dark', 'light', 'sepia'));
  end if;
end;
$bloque$;

-- ============================================================================
-- 2 · Apariencia
--
-- Todos los DEFAULT son los valores que reproducen la app tal y como era
-- antes de que esto existiera. Es la regla que hace que la migración no le
-- cambie la pantalla a nadie: quien no toque nada, no nota nada.
-- ============================================================================

alter table public.perfiles
  -- Acento de marca: el color del lacre notarial (botón primario, bordes
  -- activos, gráficas). El latón dorado NO se toca y por eso no tiene
  -- columna: es la segunda nota de la casa y lo que hace que la app siga
  -- siendo la misma app con cualquier acento.
  --
  -- Es un enum de texto y no un color libre porque un acento elegido a ojo
  -- sobre un fondo casi negro se deja de leer con una facilidad pasmosa. El
  -- color libre existe (`personal` + acento_personal) pero pasa por la
  -- corrección de contraste del cliente (lib/data/apariencia.ts).
  add column if not exists acento text not null default 'lacre',

  -- El color libre, en `#rrggbb`. Nullable: solo significa algo cuando
  -- `acento = 'personal'`, y guardar '#a82f3c' en todos los perfiles que no
  -- lo usan sería mentir sobre lo que el opositor eligió.
  --
  -- El check es de FORMA, no de legibilidad: el contraste depende del tono
  -- base, que es otra columna, y un check que cruzara las dos rechazaría la
  -- escritura en vez de corregirla, que es justo lo contrario de lo que hay
  -- que hacerle a alguien que está eligiendo un color. La legibilidad la
  -- garantiza el cliente ajustando la luminosidad; aquí solo se impide que
  -- entre algo que no es un color.
  add column if not exists acento_personal text,

  -- Tipografía del TEXTO DE LOS TEMAS. La interfaz no cambia nunca: solo lo
  -- que se lee durante horas.
  add column if not exists fuente_temas text not null default 'serif',

  -- Cuerpo de ese mismo texto, en píxeles. 17 es el 1.0625rem de siempre.
  -- El rango es estrecho a propósito: por debajo de 15 no se lee y por
  -- encima de 24 el epígrafe deja de caber en pantalla y se pierde el hilo.
  add column if not exists tamano_tema int not null default 17,

  -- Densidad de la retícula. No toca los cuerpos de texto, solo el aire.
  add column if not exists densidad text not null default 'normal',

  -- Con qué criterio se listan los temas en el programa, el cante, el crono
  -- y el repaso. 'numero' es el orden de siempre: materia y número, como el
  -- programa impreso.
  add column if not exists orden_temas text not null default 'numero',

  -- Con qué vista abre el programa. Estaba fijo en el código.
  add column if not exists vista_programa text not null default 'mural';

do $bloque$
begin
  -- Los checks van aparte de los `add column` porque "add constraint if not
  -- exists" no existe en Postgres y hay que preguntar por el catálogo. Mismo
  -- patrón que 0003.
  if not exists (select 1 from pg_constraint where conname = 'perfiles_acento_check') then
    alter table public.perfiles add constraint perfiles_acento_check
      check (acento in ('lacre', 'tinta', 'jade', 'cardeno', 'cobre', 'personal'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'perfiles_acento_personal_check') then
    alter table public.perfiles add constraint perfiles_acento_personal_check
      check (acento_personal is null or acento_personal ~ '^#[0-9a-fA-F]{6}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'perfiles_fuente_temas_check') then
    alter table public.perfiles add constraint perfiles_fuente_temas_check
      check (fuente_temas in ('serif', 'sans'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'perfiles_tamano_tema_check') then
    alter table public.perfiles add constraint perfiles_tamano_tema_check
      check (tamano_tema between 15 and 24);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'perfiles_densidad_check') then
    alter table public.perfiles add constraint perfiles_densidad_check
      check (densidad in ('normal', 'compacta'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'perfiles_orden_temas_check') then
    alter table public.perfiles add constraint perfiles_orden_temas_check
      check (orden_temas in ('numero', 'estado', 'urgencia', 'tiempo', 'nota'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'perfiles_vista_programa_check') then
    alter table public.perfiles add constraint perfiles_vista_programa_check
      check (vista_programa in ('mural', 'lista'));
  end if;
end;
$bloque$;

comment on column public.perfiles.acento is
  'Acento de marca (color del lacre). El latón dorado no se personaliza.';
comment on column public.perfiles.acento_personal is
  'Color libre #rrggbb; solo cuenta con acento = ''personal''. El cliente le corrige la luminosidad hasta que contrasta con el fondo.';
comment on column public.perfiles.tamano_tema is
  'Cuerpo del texto de los temas en px. 17 = 1.0625rem, el de siempre.';
comment on column public.perfiles.orden_temas is
  'Criterio de ordenación de los temas en todas las vistas que los listan.';

-- ============================================================================
-- 3 · Lo que NO hace falta tocar
--
--   · el trigger `tocar_updated_at` de `perfiles` ya existe (0001) y arbitra
--     estas columnas como el resto de la fila, sin enterarse de que están.
--   · la RLS de `perfiles` es por fila y va contra la PK (0001): las
--     políticas cubren las columnas nuevas tal cual.
--   · `crear_perfil()` inserta la fila del alta sin nombrar columnas de
--     apariencia, así que los DEFAULT de arriba son los que se aplican: un
--     opositor recién dado de alta tiene la app de siempre.
--   · no hay índices nuevos. Nada de esto se filtra ni se ordena en ninguna
--     consulta: se lee entero con la fila del perfil, una vez por
--     sincronización. Un índice aquí solo engordaría cada escritura.
-- ============================================================================

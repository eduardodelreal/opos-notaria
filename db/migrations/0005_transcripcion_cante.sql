-- ============================================================================
-- opos-notaria — 0005 · transcripción y comparación del cante
--
-- Cierra el hueco que docs/sincronizacion.md §8 daba por asumido: el cante se
-- graba, se transcribe y se compara contra el texto del tema, pero de esos tres
-- resultados solo el audio tenía destino en el servidor. `Cante.transcripcion`
-- y `Cante.comparacion` (lib/data/types.ts) se quedaban en el aparato que los
-- generó.
--
-- No era una pérdida de datos —el binario sí sube, así que en otro dispositivo
-- se pueden regenerar— pero sí una pérdida de DINERO y de tiempo: regenerarlos
-- cuesta una transcripción del audio entero y una llamada al modelo por cada
-- aparato en el que el opositor abra ese cante. Con tres dispositivos y un
-- cante al día, se paga tres veces lo mismo durante toda la oposición.
--
-- Por qué jsonb y no tablas hijas, igual que `epigrafes` y `analisis` en 0001:
-- son documentos inmutables que se leen enteros, no se filtran por dentro y no
-- se editan campo a campo. Una tabla hija solo añadiría filas que sincronizar
-- para un dato que nace y muere de una pieza.
--
-- Por qué NO son `not null`: un cante viejo, uno sin grabación y uno cuya
-- transcripción todavía no ha terminado son filas legítimas sin estos campos.
-- `null` significa exactamente eso, "aquí todavía no hay nada", y es lo que
-- `fundirCante()` (lib/sync/fusion.ts) mira para no pisar con un hueco lo que
-- el otro dispositivo sí tiene.
--
-- Depende de 0001 (crea public.cantes). Aplíquese después, como todas.
--
-- Idempotente: se puede reaplicar entero sin miedo.
-- ============================================================================

-- TranscripcionCante: { texto, motor, generado, segundos? }.
-- El texto de un cante de diez minutos son unos pocos kB; el peso real de la
-- fila lo sigue marcando `epigrafes` y `analisis`, no esto.
alter table public.cantes
  add column if not exists transcripcion jsonb;

-- ComparacionCante: { titular, cobertura, omisiones[], dichoDeMas[],
-- epigrafesIncompletos[], literalidad, generado, modelo }.
alter table public.cantes
  add column if not exists comparacion jsonb;

comment on column public.cantes.transcripcion is
  'Transcripción del audio (TranscripcionCante). Viaja para no pagarla otra vez en cada dispositivo.';
comment on column public.cantes.comparacion is
  'Comparación de la transcripción con el texto del tema (ComparacionCante). Misma razón.';

-- No llevan índice, y es deliberado: no se filtra ni se ordena por dentro de
-- ellas en ninguna consulta de la app. Un índice GIN aquí solo engordaría cada
-- escritura de un cante para nada.

-- Tampoco hace falta tocar nada más:
--   · el trigger `tocar_updated_at` de `cantes` ya existe (0001) y arbitra
--     estas dos columnas como el resto de la fila, sin enterarse de que están.
--   · la RLS de `cantes` es por fila, no por columna: las políticas de 0001
--     cubren las columnas nuevas tal cual.
--   · la cascada de borrado del tema entierra el cante entero, así que se
--     lleva también la transcripción sin nombrarla.

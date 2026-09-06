-- ============================================================================
-- opos-notaria — 0002 · Storage para las grabaciones de cante
--
-- Bucket privado cantes-audio. Convenio de rutas, y toda la seguridad depende
-- de él:
--
--     <usuario_id>/<cante_id>.webm
--
-- El primer segmento de la ruta ES el uid del dueño. Las políticas comparan
-- ese segmento con auth.uid(), así que un opositor no puede ni leer ni escribir
-- fuera de su carpeta aunque adivine el uuid de un cante ajeno.
--
-- Requiere ejecutarse con un rol que pueda tocar storage.objects (el SQL editor
-- de Supabase y `supabase db push` lo hacen; un cliente anon no).
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------------ bucket --
-- 50 MB por archivo: un cante de 10 minutos en opus/webm ronda los 5 MB, así
-- que sobra de largo incluso grabando el turno entero de un simulacro.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cantes-audio',
  'cantes-audio',
  false,
  52428800,
  array[
    'audio/webm',
    'audio/ogg',
    'audio/mpeg',
    'audio/mp4',
    'audio/aac',
    'audio/wav'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------- políticas --
-- Sobre storage.objects, acotadas al bucket. La RLS de storage.objects ya viene
-- activada por Supabase; no hace falta (ni se puede, sin ser owner) tocarla.

drop policy if exists "cantes-audio: leer lo propio"        on storage.objects;
drop policy if exists "cantes-audio: subir a mi carpeta"    on storage.objects;
drop policy if exists "cantes-audio: reemplazar lo propio"  on storage.objects;
drop policy if exists "cantes-audio: borrar lo propio"      on storage.objects;

create policy "cantes-audio: leer lo propio" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'cantes-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "cantes-audio: subir a mi carpeta" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'cantes-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Reintentar una subida cortada a media biblioteca tiene que poder pisar el
-- objeto anterior, de ahí el update (upsert: true en el cliente).
create policy "cantes-audio: reemplazar lo propio" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'cantes-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'cantes-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Aquí SÍ hay delete físico, al contrario que en las tablas. Un binario de
-- audio no necesita tumba: el tombstone que se sincroniza es la fila de
-- `cantes` con deleted_at, y el objeto de Storage solo es un adjunto suyo.
-- Guardar audios de cantes borrados sería pagar almacenamiento por nada.
create policy "cantes-audio: borrar lo propio" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'cantes-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- Notas para quien implemente el cliente
--
-- · El bucket es privado: no hay URL pública. Para reproducir un cante se pide
--   una URL firmada con createSignedUrl(path, segundos), corta (minutos, no
--   días) porque se regenera en cada reproducción sin coste.
--
-- · La subida del audio es una FASE APARTE del push de la fila. Orden correcto:
--     1. guardar el cante en IndexedDB con el blob y audio_path calculado
--     2. push de la fila `cantes` (barato, va siempre)
--     3. subida del binario cuando haya red decente
--   Si el paso 3 falla, la fila ya está a salvo y el audio se reintenta. Al
--   revés — esperar al audio para subir la fila — es justo el escenario que
--   pierde el cante en una biblioteca con wifi malo.
--
-- · audio_path se rellena en el cliente al crear el cante, no después de subir:
--   es determinista (<uid>/<cante_id>.webm) y así la fila ya sabe dónde estará
--   su audio. Un audio que aún no existe da 404 al firmar, y el cliente lo
--   trata como "grabación pendiente de subir", no como error.
-- ============================================================================

-- ============================================================================
-- 0004 · Memoria de avisos enviados
--
-- Sin esta tabla el motor de avisos no tiene dónde recordar QUÉ mandó, así que
-- el tope de "uno al día" funciona (sale de `ultimo_envio` en la suscripción)
-- pero el anti-repetición no: el opositor recibiría el mismo "llevas 11 días
-- sin tocar Hipotecario" cada mañana hasta que lo tocara.
--
-- Idempotente: se puede reaplicar sin miedo.
-- ============================================================================

create table if not exists public.avisos_enviados (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users on delete cascade,
  -- Clave estable del aviso: "oxido:tema:<uuid>", "racha", "ritmo:<lunes>".
  -- Es lo que se compara para no repetir.
  clave      text not null,
  tipo       text not null,
  -- Se guardan título y cuerpo tal y como se enviaron: sin esto no hay forma
  -- de saber qué leyó el opositor cuando venga diciendo que el aviso estaba
  -- mal, y los textos los genera código que cambia.
  titulo     text not null,
  cuerpo     text not null,
  url        text not null,
  -- Día LOCAL del usuario, no del servidor. Es la unidad del "uno al día":
  -- alguien en Canarias y alguien en Madrid no comparten medianoche.
  dia        date not null,
  enviado_at timestamptz not null default now()
);

-- El tope diario, impuesto por la base y no solo por el código: dos pasadas
-- solapadas del cron no pueden saltárselo.
create unique index if not exists avisos_enviados_dia_idx
  on public.avisos_enviados (usuario_id, dia);

-- Para la consulta del anti-repetición: "¿mandé esta misma clave ayer?".
create index if not exists avisos_enviados_clave_idx
  on public.avisos_enviados (usuario_id, clave, dia desc);

alter table public.avisos_enviados enable row level security;

-- Solo lectura para el opositor. Lo escribe el cron con `service_role`, que se
-- salta la RLS. Sin política de insert, nadie puede fabricarse un historial
-- falso para silenciarse los avisos a sí mismo.
drop policy if exists "datos propios: select" on public.avisos_enviados;
create policy "datos propios: select" on public.avisos_enviados
  for select using (auth.uid() = usuario_id);

-- Esta tabla NO lleva `updated_at` ni `deleted_at`, a diferencia del resto del
-- esquema: no se sincroniza con el cliente ni se edita nunca. Es un registro
-- de hechos, de solo-añadir, que vive únicamente en el servidor.

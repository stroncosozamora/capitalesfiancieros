-- Control privado de frecuencia para el envío de informes.
-- Ejecutar una vez desde Supabase SQL Editor.
create table if not exists public.report_email_sends (
  id uuid primary key default gen_random_uuid(),
  request_fingerprint text not null,
  send_bucket text not null,
  created_at timestamptz not null default now(),
  unique (request_fingerprint, send_bucket)
);

alter table public.report_email_sends enable row level security;
revoke all on public.report_email_sends from anon, authenticated;

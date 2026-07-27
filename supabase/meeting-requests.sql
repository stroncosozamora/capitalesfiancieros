-- Solicitudes de reunión y control de disponibilidad.
-- Ejecutar una vez desde Supabase SQL Editor.
create table if not exists public.meeting_requests (
  id uuid primary key default gen_random_uuid(),
  meeting_date date not null,
  meeting_time time not null,
  full_name text not null,
  email text not null,
  phone text,
  topic text not null,
  meeting_mode text not null check (meeting_mode in ('online', 'presencial')),
  notes text,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);

create unique index if not exists meeting_requests_active_slot
  on public.meeting_requests (meeting_date, meeting_time)
  where status in ('pending', 'confirmed');

alter table public.meeting_requests enable row level security;
revoke all on public.meeting_requests from anon, authenticated;

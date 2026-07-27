-- Esquema aplicado desde Supabase SQL Editor para recomendaciones públicas.
-- Los roles anon y authenticated no tienen acceso; solo las funciones privadas de Vercel.
create extension if not exists pgcrypto;

create type public.recommendation_status as enum ('pending', 'approved', 'rejected');

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 5 and 100),
  email text not null check (char_length(email) between 5 and 254),
  opinion text not null check (char_length(opinion) between 20 and 1200),
  status public.recommendation_status not null default 'pending',
  official_reply text check (official_reply is null or char_length(official_reply) <= 1200),
  likes_count integer not null default 0 check (likes_count >= 0),
  request_fingerprint text,
  consent_given boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create table public.recommendation_likes (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.recommendations(id) on delete cascade,
  visitor_hash text not null,
  created_at timestamptz not null default now(),
  unique (recommendation_id, visitor_hash)
);

create or replace function public.set_recommendation_timestamps()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.published_at = now();
  elsif new.status is distinct from 'approved' then
    new.published_at = null;
  end if;
  return new;
end;
$$;

create trigger recommendations_set_timestamps
before update on public.recommendations
for each row execute function public.set_recommendation_timestamps();

create or replace function public.update_recommendation_likes_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.recommendations
      set likes_count = likes_count + 1
      where id = new.recommendation_id;
    return new;
  end if;
  update public.recommendations
    set likes_count = greatest(0, likes_count - 1)
    where id = old.recommendation_id;
  return old;
end;
$$;

create trigger recommendation_likes_update_count
after insert or delete on public.recommendation_likes
for each row execute function public.update_recommendation_likes_count();

alter table public.recommendations enable row level security;
alter table public.recommendation_likes enable row level security;
revoke all on public.recommendations from anon, authenticated;
revoke all on public.recommendation_likes from anon, authenticated;

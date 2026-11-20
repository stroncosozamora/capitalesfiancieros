begin;

create schema if not exists cf_private;
revoke all on schema cf_private from public;
grant usage on schema cf_private to authenticated;

create table public.cf_staff (
  user_id uuid primary key references auth.users on delete cascade,
  role text not null check (role in ('admin', 'agent'))
);
create unique index cf_single_admin on public.cf_staff (role) where role = 'admin';

create table public.cf_agent_requests (
  user_id uuid primary key references auth.users on delete cascade,
  email text not null default (auth.jwt() ->> 'email'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  requested_at timestamptz not null default now()
);

create table public.cf_advisories (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null default auth.uid() references auth.users on delete cascade,
  client_id uuid not null references auth.users on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  summary text not null check (char_length(btrim(summary)) between 1 and 8000),
  scenario jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  check (agent_id <> client_id)
);
create index cf_advisories_agent on public.cf_advisories (agent_id, created_at desc);
create index cf_advisories_published_client on public.cf_advisories (client_id, created_at desc) where published_at is not null;

create function cf_private.is_staff(allowed text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cf_staff
    where user_id = auth.uid() and role = any(allowed)
  );
$$;

create function cf_private.is_confirmed_client(candidate uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and cf_private.is_staff(array['admin','agent'])
    and exists (select 1 from auth.users where id = candidate and email_confirmed_at is not null)
    and not exists (select 1 from public.cf_staff where user_id = candidate);
$$;

create function cf_private.activate_agent() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not cf_private.is_staff(array['admin']) then
    raise exception 'Approval requires the administrator';
  end if;
  if new.status = 'approved' then
    insert into public.cf_staff (user_id, role) values (new.user_id, 'agent')
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger cf_activate_agent after update of status on public.cf_agent_requests
for each row execute function cf_private.activate_agent();

revoke execute on all functions in schema cf_private from public;
grant execute on function cf_private.is_staff(text[]), cf_private.is_confirmed_client(uuid) to authenticated;

alter table public.cf_staff enable row level security;
alter table public.cf_agent_requests enable row level security;
alter table public.cf_advisories enable row level security;

revoke all on public.cf_staff, public.cf_agent_requests, public.cf_advisories from public, anon, authenticated;
grant select on public.cf_staff, public.cf_agent_requests, public.cf_advisories to authenticated;
grant insert (user_id), update (status) on public.cf_agent_requests to authenticated;
grant insert (client_id, title, summary, scenario), update (published_at) on public.cf_advisories to authenticated;

create policy staff_read on public.cf_staff for select to authenticated
using (user_id = (select auth.uid()) or (select cf_private.is_staff(array['admin'])));

create policy requests_read on public.cf_agent_requests for select to authenticated
using (user_id = (select auth.uid()) or (select cf_private.is_staff(array['admin'])));
create policy requests_insert on public.cf_agent_requests for insert to authenticated
with check (
  user_id = (select auth.uid()) and status = 'pending'
  and not (select cf_private.is_staff(array['admin','agent']))
);
create policy requests_review on public.cf_agent_requests for update to authenticated
using (status = 'pending' and (select cf_private.is_staff(array['admin'])))
with check (status in ('approved','declined') and (select cf_private.is_staff(array['admin'])));

create policy advisory_read on public.cf_advisories for select to authenticated
using (
  (client_id = (select auth.uid()) and published_at is not null)
  or (agent_id = (select auth.uid()) and (select cf_private.is_staff(array['agent'])))
  or (select cf_private.is_staff(array['admin']))
);
create policy advisory_create on public.cf_advisories for insert to authenticated
with check (
  agent_id = (select auth.uid()) and (select cf_private.is_staff(array['admin','agent']))
  and published_at is null and cf_private.is_confirmed_client(client_id)
);
create policy advisory_publish on public.cf_advisories for update to authenticated
using (
  published_at is null and (
    (agent_id = (select auth.uid()) and (select cf_private.is_staff(array['agent'])))
    or (select cf_private.is_staff(array['admin']))
  )
)
with check (
  published_at is not null and (
    (agent_id = (select auth.uid()) and (select cf_private.is_staff(array['agent'])))
    or (select cf_private.is_staff(array['admin']))
  )
);

commit;

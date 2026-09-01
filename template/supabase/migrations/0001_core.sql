-- Core: profiles mirrored from auth.users, with RLS from the first migration.
-- Retrofitting multi-tenant RLS later is the most painful migration there is;
-- if this app will ever have companies/teams, add company_id here on day one.

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

alter table public.profiles enable row level security;

create policy "read own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

create policy "update own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Supabase's default privileges grant everything on new public tables to
-- anon + authenticated, so RLS would be the ONLY write gate (audit finding H1).
-- Grant explicitly, column-scoped, and revoke the rest.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, updated_at) on public.profiles to authenticated;

-- Mirror new signups into profiles. SECURITY DEFINER needs an empty
-- search_path, or a caller-controlled schema can shadow the objects it uses.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

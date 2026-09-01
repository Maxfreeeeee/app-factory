-- Response cache for expensive model calls, keyed by a hash of the inputs.
-- Scope the key to the user whenever the cached value could contain anything
-- user-specific — a global key on user content leaks across accounts.

create table if not exists public.ai_cache (
  cache_key  text primary key,
  response   jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.ai_cache enable row level security;
revoke all on public.ai_cache from anon, authenticated;

create index if not exists ai_cache_expires_at_idx on public.ai_cache (expires_at);

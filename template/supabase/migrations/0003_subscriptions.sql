-- Entitlements. The client may READ its own row and nothing else; only the
-- service role (the RevenueCat webhook) writes. Entitlement decided on the
-- server is the difference between a paywall and a suggestion.

create table if not exists public.subscriptions (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  status     text not null default 'expired' check (status in ('active', 'expired', 'cancelled')),
  product_id text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy "read own subscription" on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;
-- Deliberately no insert/update/delete grant: a client that can write this
-- table can grant itself Pro.

-- Webhook replay protection (audit finding H3). A payment provider retries
-- aggressively; without this, one purchase event can be applied many times.
create table if not exists public.processed_events (
  event_id     text primary key,
  source       text not null,
  processed_at timestamptz not null default now()
);

alter table public.processed_events enable row level security;
revoke all on public.processed_events from anon, authenticated;

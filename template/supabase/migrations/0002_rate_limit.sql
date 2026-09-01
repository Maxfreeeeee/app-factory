-- Durable per-user rate limiting, enforced in Postgres so it survives edge
-- worker cold starts and is shared across the fleet.

create table if not exists public.rate_limits (
  user_id      uuid not null references auth.users(id) on delete cascade,
  bucket       text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (user_id, bucket, window_start)
);

alter table public.rate_limits enable row level security;
-- No policies and no grants: service role only. A client that could read this
-- learns other users' usage; one that could write it lifts its own limit.
revoke all on public.rate_limits from anon, authenticated;

/**
 * Consume one request from a fixed window. Returns remaining allowance, or -1
 * when the limit is already used up. Atomic: the upsert is the whole check.
 */
create or replace function public.consume_rate_limit(
  p_user_id        uuid,
  p_bucket         text,
  p_limit          integer,
  p_window_seconds integer
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );
  v_count integer;
begin
  insert into public.rate_limits (user_id, bucket, window_start, count)
  values (p_user_id, p_bucket, v_window, 1)
  on conflict (user_id, bucket, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into v_count;

  if v_count > p_limit then
    return -1;
  end if;
  return p_limit - v_count;
end;
$$;

-- Only the service role calls this; a client must never pick its own limit.
revoke all on function public.consume_rate_limit(uuid, text, integer, integer) from public, anon, authenticated;

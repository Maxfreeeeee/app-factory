import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Service-role client — bypasses RLS. Use ONLY for server-side writes
 * (metrics, plans, subscriptions, jobs, cache, rate limits).
 */
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/**
 * Client scoped to the caller's JWT — all queries run under RLS as that user.
 */
export function userClient(req: Request): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { persistSession: false },
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    },
  );
}

import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { errorResponse } from "./http.ts";

export interface RateLimitRule {
  bucket: string;
  /** requests allowed per window for free users */
  free: number;
  /** requests allowed per window for pro subscribers */
  pro: number;
  windowSeconds: number;
}

/**
 * Internal dev/admin accounts: full pro, no rate limits.
 *
 * Keyed on immutable, server-controlled user IDs (ADMIN_USER_IDS = comma-
 * separated UUIDs) — NEVER on the email, which a user picks at signup. An
 * earlier app in this family granted admin to any address ending in a magic
 * domain; with open signup that was a self-service admin bypass.
 */
export function isAdminUser(user: { id?: string | null }): boolean {
  const ids = (Deno.env.get("ADMIN_USER_IDS") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return Boolean(user.id && ids.includes(user.id));
}

/** One entry per rate-limited endpoint. Add this app's own buckets here. */
export const RATE_LIMITS: Record<string, RateLimitRule> = {
  // Abuse guard on self-service account deletion — same for every tier, and
  // generous enough never to block a legitimate retry.
  "delete-account": { bucket: "delete-account", free: 10, pro: 10, windowSeconds: 3600 },
};

export async function isPro(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("subscriptions")
    .select("status, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data || data.status !== "active") return false;
  return !data.expires_at || new Date(data.expires_at) > new Date();
}

/**
 * Consume one request from the user's quota (fixed window, enforced
 * atomically in Postgres). Returns a 429 Response when exhausted, else null.
 */
export async function enforceRateLimit(
  admin: SupabaseClient,
  userId: string,
  rule: RateLimitRule,
  pro: boolean,
): Promise<Response | null> {
  const limit = pro ? rule.pro : rule.free;
  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_user_id: userId,
    p_bucket: rule.bucket,
    p_limit: limit,
    p_window_seconds: rule.windowSeconds,
  });
  if (error) {
    console.error("rate limit rpc failed", error);
    // Fail CLOSED on infrastructure errors for endpoints that cost money.
    return errorResponse("Rate limiter unavailable, try again shortly", 503);
  }
  if (data === -1) {
    return errorResponse(
      pro ? "Daily limit reached. Try again tomorrow." : "Free daily limit reached.",
      429,
      { "Retry-After": String(rule.windowSeconds), "x-upgrade-available": pro ? "false" : "true" },
    );
  }
  return null;
}

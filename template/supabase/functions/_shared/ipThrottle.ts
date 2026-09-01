// Best-effort in-memory IP burst limiter for PUBLIC (unauthenticated) endpoints.
//
// Authenticated endpoints use the durable Postgres per-user limiter
// (enforceRateLimit). This one is for endpoints with no user identity
// (webhook, cron, the support page): it caps requests per client IP within a
// short window to blunt naive floods / brute-force.
//
// Honest limitations: state lives in ONE edge-worker instance (not shared
// across the fleet) and resets on cold start, so it is defence-in-depth, not a
// hard distributed guarantee — Supabase's platform edge provides the primary
// DDoS protection. Limits are generous so legitimate senders (e.g. RevenueCat
// bursts, pg_cron) are never blocked. Fails OPEN on any error.

import { errorResponse } from "./http.ts";

interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>();

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Consume one hit for this IP within `bucket`. Returns a graceful 429 Response
 * (with Retry-After) when the per-window limit is exceeded, otherwise null.
 */
export function ipThrottle(req: Request, bucket: string, limit: number, windowSeconds: number): Response | null {
  try {
    const now = Date.now();
    const key = `${bucket}:${clientIp(req)}`;
    const existing = buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      // Bound memory: opportunistically drop expired buckets.
      if (buckets.size > 5000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
      return null;
    }
    existing.count += 1;
    if (existing.count > limit) {
      return errorResponse("Too many requests", 429, {
        "Retry-After": String(Math.max(1, Math.ceil((existing.resetAt - now) / 1000))),
      });
    }
    return null;
  } catch {
    return null; // never block legitimate traffic on an internal error
  }
}

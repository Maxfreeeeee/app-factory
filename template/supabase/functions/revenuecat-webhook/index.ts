// Entitlement is decided here, server-side, and nowhere else.
//
// Two protections the first version of this file lacked (audit finding H3):
// a constant-time secret comparison, and an idempotency record so a retried
// or replayed delivery cannot be applied twice.
import { adminClient } from "../_shared/supabase.ts";
import { json, errorResponse, preflight } from "../_shared/http.ts";
import { ipThrottle } from "../_shared/ipThrottle.ts";

function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  // Compare a fixed number of bytes so the loop count never depends on input.
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const burst = ipThrottle(req, "revenuecat-webhook", 120, 60);
  if (burst) return burst;

  const expected = Deno.env.get("REVENUECAT_WEBHOOK_AUTH") ?? "";
  const got = req.headers.get("Authorization") ?? "";
  if (!expected || !timingSafeEqual(expected, got)) {
    return errorResponse("Unauthorized", 401);
  }

  // Third-party payload: many evolving fields, so no strict schema here.
  const body = await req.json().catch(() => null);
  const event = body?.event;
  if (!event?.id || !event?.app_user_id) return errorResponse("Malformed event", 400);

  const admin = adminClient();

  // Idempotency: the insert is the lock. A duplicate delivery loses the race
  // and returns 200 without touching the entitlement.
  const { error: dupe } = await admin
    .from("processed_events")
    .insert({ event_id: event.id, source: "revenuecat" });
  if (dupe) {
    if (dupe.code === "23505") return json({ ok: true, duplicate: true });
    console.error("idempotency insert failed", dupe);
    return errorResponse("Could not record event", 500);
  }

  const active = !["CANCELLATION", "EXPIRATION", "SUBSCRIPTION_PAUSED"].includes(event.type);
  const { error } = await admin.from("subscriptions").upsert({
    user_id: event.app_user_id,
    status: active ? "active" : "expired",
    product_id: event.product_id ?? null,
    expires_at: event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error("subscription upsert failed", error);
    return errorResponse("Could not apply entitlement", 500);
  }
  return json({ ok: true });
});

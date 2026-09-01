// App Store 5.1.1(v): an app that creates accounts must offer in-app deletion.
// Deleting is irreversible and identity-bound, so it demands a recent sign-in.
import { adminClient, userClient } from "../_shared/supabase.ts";
import { requireUser, requireRecentAuth } from "../_shared/auth.ts";
import { enforceRateLimit, RATE_LIMITS } from "../_shared/rateLimit.ts";
import { json, errorResponse, preflight } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const supabase = userClient(req);
  const auth = await requireUser(supabase);
  if ("response" in auth) return auth.response;

  const stale = requireRecentAuth(req);
  if (stale) return stale;

  const admin = adminClient();
  const limited = await enforceRateLimit(admin, auth.user.id, RATE_LIMITS["delete-account"], true);
  if (limited) return limited;

  // Storage first: deleting the auth user cascades the database rows away, and
  // with them any record of which objects belonged to this account.
  // TODO(app): remove this app's storage objects for auth.user.id here,
  // paginating — list() returns at most 1000 entries per call.

  const { error } = await admin.auth.admin.deleteUser(auth.user.id);
  if (error) {
    console.error("delete-account failed", error);
    return errorResponse("Could not delete the account. Please try again.", 500);
  }
  return json({ ok: true });
});

import { SupabaseClient, User } from "npm:@supabase/supabase-js@2";
import { errorResponse } from "./http.ts";

export type AuthResult = { user: User } | { response: Response };

/** Resolve the calling user from the request JWT (RLS-scoped client). */
export async function requireUser(supabase: SupabaseClient): Promise<AuthResult> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { response: errorResponse("Unauthorized", 401) };
  }
  return { user: data.user };
}

/**
 * Re-authentication gate for sensitive actions (account deletion, email change).
 *
 * Supabase access tokens carry an `amr` (Authentication Methods Reference)
 * claim listing each auth event with its timestamp. A refreshed session keeps
 * the ORIGINAL sign-in timestamp, so this genuinely proves the user typed
 * their password / completed Apple sign-in within the window — the client
 * must call signInWithPassword / signInWithIdToken again right before
 * invoking the sensitive endpoint.
 */
export function requireRecentAuth(req: Request, maxAgeSeconds = 300): Response | null {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const payload = decodeJwtPayload(token);
  if (!payload) return errorResponse("Unauthorized", 401);

  const amr = (payload.amr ?? []) as Array<{ method: string; timestamp: number }>;
  const now = Math.floor(Date.now() / 1000);
  const fresh = amr.some(
    (e) =>
      ["password", "oauth", "otp"].includes(e.method) &&
      now - e.timestamp <= maxAgeSeconds,
  );
  if (!fresh) {
    return errorResponse(
      "Recent authentication required. Please sign in again and retry.",
      403,
      { "x-reauth-required": "true" },
    );
  }
  return null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    const pad = part.length % 4 === 0 ? "" : "=".repeat(4 - (part.length % 4));
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/") + pad;
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

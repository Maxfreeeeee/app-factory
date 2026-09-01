import { supabase } from "./supabase";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Invoke an Edge Function with the current session's JWT and typed errors. */
export async function invokeFunction<T>(
  name: string,
  body: unknown = {},
  opts: { retries?: number } = {},
): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new ApiError("Not signed in", 401);

  // 502/503/504 come from the gateway before the function runs (mobile
  // networks) — only idempotent endpoints opt into retries.
  const retries = opts.retries ?? 0;
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (![502, 503, 504].includes(res.status) || attempt >= retries) break;
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(payload.error ?? `Request failed (${res.status})`, res.status);
  return payload as T;
}

// One typed method per edge function. Keep this list the single source of truth
// for what the client is allowed to call.
export const api = {
  deleteAccount: () => invokeFunction<{ ok: true }>("delete-account"),
};

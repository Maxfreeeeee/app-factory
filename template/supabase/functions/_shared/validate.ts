// Dependency-free request-body validation for edge functions.
//
// OWASP-aligned input handling: schema-based, typed checks, explicit length /
// range limits, and STRICT mode — any field NOT declared in the schema is
// rejected (guards against mass-assignment and unexpected-input attacks).
// Invalid input yields a clean HTTP 400 (never a 500 / stack trace).
//
// Use for endpoints that accept a CLIENT-supplied body. Do NOT use its strict
// "reject unknown fields" behaviour on third-party webhooks (e.g. RevenueCat),
// whose payloads carry many evolving fields.

import { errorResponse } from "./http.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FieldSpec =
  | { type: "string"; required?: boolean; minLength?: number; maxLength?: number; enum?: readonly string[]; pattern?: RegExp }
  | { type: "number"; required?: boolean; min?: number; max?: number; integer?: boolean }
  | { type: "boolean"; required?: boolean }
  | { type: "uuid"; required?: boolean }
  | { type: "array"; required?: boolean; minItems?: number; maxItems?: number };

export type Schema = Record<string, FieldSpec>;

export class ValidationError extends Error {}

function checkField(key: string, v: unknown, spec: FieldSpec): unknown {
  switch (spec.type) {
    case "string": {
      if (typeof v !== "string") throw new ValidationError(`${key} must be a string`);
      if (spec.minLength != null && v.length < spec.minLength) throw new ValidationError(`${key} is too short`);
      if (spec.maxLength != null && v.length > spec.maxLength) throw new ValidationError(`${key} is too long`);
      if (spec.enum && !spec.enum.includes(v)) throw new ValidationError(`${key} must be one of: ${spec.enum.join(", ")}`);
      if (spec.pattern && !spec.pattern.test(v)) throw new ValidationError(`${key} has an invalid format`);
      return v;
    }
    case "uuid": {
      if (typeof v !== "string" || !UUID_RE.test(v)) throw new ValidationError(`${key} must be a valid id`);
      return v;
    }
    case "number": {
      if (typeof v !== "number" || !Number.isFinite(v)) throw new ValidationError(`${key} must be a number`);
      if (spec.integer && !Number.isInteger(v)) throw new ValidationError(`${key} must be an integer`);
      if (spec.min != null && v < spec.min) throw new ValidationError(`${key} must be >= ${spec.min}`);
      if (spec.max != null && v > spec.max) throw new ValidationError(`${key} must be <= ${spec.max}`);
      return v;
    }
    case "boolean": {
      if (typeof v !== "boolean") throw new ValidationError(`${key} must be a boolean`);
      return v;
    }
    case "array": {
      if (!Array.isArray(v)) throw new ValidationError(`${key} must be an array`);
      if (spec.minItems != null && v.length < spec.minItems) throw new ValidationError(`${key} needs at least ${spec.minItems} item(s)`);
      if (spec.maxItems != null && v.length > spec.maxItems) throw new ValidationError(`${key} allows at most ${spec.maxItems} item(s)`);
      return v;
    }
  }
}

export function validateObject<T = Record<string, unknown>>(body: unknown, schema: Schema): T {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  const obj = body as Record<string, unknown>;
  // STRICT: reject any field not declared in the schema (mass-assignment guard).
  for (const key of Object.keys(obj)) {
    if (!(key in schema)) throw new ValidationError(`Unexpected field: ${key}`);
  }
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema)) {
    const v = obj[key];
    if (v === undefined || v === null) {
      if (spec.required) throw new ValidationError(`Missing required field: ${key}`);
      continue;
    }
    out[key] = checkField(key, v, spec);
  }
  return out as T;
}

/**
 * Read + validate a JSON request body against `schema`.
 * - An empty body is treated as `{}` (fine for endpoints whose fields are all
 *   optional); required fields are still enforced.
 * - Malformed JSON, wrong types, out-of-range values, over-length strings, and
 *   unexpected fields all return a 400 with a safe message.
 * Returns `{ data }` on success or `{ response }` (the 400) on failure.
 */
export async function parseBody<T = Record<string, unknown>>(
  req: Request,
  schema: Schema,
): Promise<{ data: T } | { response: Response }> {
  let raw: unknown = {};
  const text = await req.text().catch(() => "");
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      return { response: errorResponse("Invalid JSON body", 400) };
    }
  }
  try {
    return { data: validateObject<T>(raw, schema) };
  } catch (e) {
    return { response: errorResponse(e instanceof ValidationError ? e.message : "Invalid request", 400) };
  }
}

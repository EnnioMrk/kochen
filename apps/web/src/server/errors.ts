import type { Context } from "hono";
import type { ErrorCode } from "@kochen/contracts";

const GERMAN: Record<string, string> = {
  unauthenticated: "Bitte melde dich an.",
  not_member: "Dein Konto hat noch keinen Zugang. Bitte stelle eine Anfrage.",
  forbidden: "Du hast keine Berechtigung für diese Aktion.",
  not_found: "Nicht gefunden.",
  validation_failed: "Die Eingabe ist ungültig.",
  limit_exceeded: "Die Grenze wurde überschritten.",
  ai_unavailable: "Die KI ist gerade nicht erreichbar. Bitte später erneut versuchen.",
  rate_limited: "Zu viele Anfragen. Bitte warte einen Moment.",
  extraction_failed: "Das Rezept konnte nicht erkannt werden.",
  conflict: "Das kollidiert mit einem vorhandenen Eintrag.",
  internal: "Ein Fehler ist aufgetreten.",
};

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message?: string,
    readonly detail?: unknown,
  ) {
    super(message ?? GERMAN[code] ?? GERMAN.internal!);
    this.name = "ApiError";
  }
}

export const unauthenticated = () => new ApiError("unauthenticated", 401);
export const notMember = () => new ApiError("not_member", 403);
export const forbidden = () => new ApiError("forbidden", 403);
export const notFound = () => new ApiError("not_found", 404);
export const invalid = (detail?: unknown) =>
  new ApiError("validation_failed", 400, undefined, detail);
export const conflict = (message?: string) => new ApiError("conflict", 409, message);
export const limitExceeded = (detail?: unknown) =>
  new ApiError("limit_exceeded", 413, undefined, detail);
export const aiUnavailable = () => new ApiError("ai_unavailable", 503);
export const rateLimited = () => new ApiError("rate_limited", 429);

export function ok<T>(c: Context, data: T, status = 200) {
  return c.json({ ok: true as const, data }, status as 200);
}

export function errorResponse(error: unknown, c: Context) {
  if (error instanceof ApiError) {
    return c.json(
      { ok: false as const, error: error.message, code: error.code, ...(error.detail ? { detail: error.detail } : {}) },
      error.status as 400,
    );
  }
  const message = error instanceof Error ? error.message : "unknown";
  console.error(JSON.stringify({ level: "error", message, stack: error instanceof Error ? error.stack : undefined }));
  return c.json({ ok: false as const, error: GERMAN.internal!, code: "internal" }, 500);
}

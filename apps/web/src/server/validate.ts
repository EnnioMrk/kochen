import type { Context } from "hono";
import type { z } from "zod";
import { invalid } from "./errors";

export async function body<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw invalid("invalid_json");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw invalid(parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
  }
  return parsed.data;
}

export function query<T extends z.ZodTypeAny>(c: Context, schema: T): z.infer<T> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) {
    throw invalid(parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
  }
  return parsed.data;
}

export function linkToken(c: Context): string | null {
  return c.req.header("x-link-token") ?? null;
}

export function idParam(c: Context, name = "id"): string {
  const value = c.req.param(name);
  if (!value || !/^[0-9a-f-]{36}$/i.test(value)) throw invalid(`bad_${name}`);
  return value;
}

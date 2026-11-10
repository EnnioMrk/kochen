import { createProvider, AiUnavailableError, type AiProvider } from "@kochen/ai";
import { aiUnavailable, rateLimited } from "./errors";

let provider: AiProvider | null = null;
let failures = 0;
/** 0 means "closed". Only a real failure opens the breaker. */
let openedAt = 0;

/** Circuit breaker: 3 failures open it for 60 seconds. */
export async function aiCall<T>(fn: (provider: AiProvider) => Promise<T>): Promise<T> {
  if (openedAt !== 0 && performance.now() - openedAt < 60_000) throw aiUnavailable();
  try {
    provider ??= createProvider();
    const result = await fn(provider);
    failures = 0;
    return result;
  } catch (error) {
    if (error instanceof AiUnavailableError) {
      failures += 1;
      if (failures >= 3) openedAt = performance.now();
    }
    throw aiUnavailable();
  }
}

const buckets = new Map<string, number[]>();

export function rateLimit(key: string, max: number, windowMs = 3_600_000): void {
  const now = Date.now();
  const list = (buckets.get(key) ?? []).filter((at) => now - at < windowMs);
  if (list.length >= max) throw rateLimited();
  list.push(now);
  buckets.set(key, list);
}

export function aiReady(): boolean {
  try {
    provider ??= createProvider();
    return true;
  } catch {
    return false;
  }
}

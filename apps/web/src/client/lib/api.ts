export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

import { clearToken, logout as platformLogout, PlatformError, platformToken } from "./platform";

const DEV_TOKEN_KEY = "kochen.devToken";

export function devToken(): string {
  return localStorage.getItem(DEV_TOKEN_KEY) ?? "dev:local:local@test:Test";
}

export function setDevToken(value: string): void {
  localStorage.setItem(DEV_TOKEN_KEY, value);
}

export async function authToken(force = false): Promise<string> {
  if (import.meta.env.DEV) {
    const dev = localStorage.getItem(DEV_TOKEN_KEY);
    if (dev) return dev;
  }
  try {
    return await platformToken(force);
  } catch (error) {
    if (error instanceof PlatformError) {
      const code = error.status === 401 || error.status === 403 || error.status === 0 ? "unauthenticated" : "internal";
      throw new ApiError(code, error.message, error.status || 503);
    }
    throw error;
  }
}

export async function logout(): Promise<void> {
  clearToken();
  await platformLogout().catch(() => undefined);
}

type ApiOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  linkToken?: string | null;
  raw?: boolean;
  retry?: boolean;
};

function linkTokenFor(path: string): string | null {
  const match = path.match(/^\/api\/recipes\/([0-9a-f-]{36})/i);
  if (!match?.[1]) return null;
  return sessionStorage.getItem(`kochen.link:${match[1]}`);
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const token = await authToken();
  const headers = new Headers(options.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }
  const link = options.linkToken ?? linkTokenFor(path);
  if (link) headers.set("x-link-token", link);

  const response = await fetch(path, {
    ...options,
    headers,
    body:
      options.body === undefined
        ? undefined
        : options.body instanceof FormData
          ? options.body
          : JSON.stringify(options.body),
  });

  if (response.status === 401 && !options.retry) {
    clearToken();
    return api<T>(path, { ...options, retry: true });
  }

  if (options.raw) {
    if (!response.ok) throw new ApiError("http_" + response.status, "Anfrage fehlgeschlagen.", response.status);
    return response as unknown as T;
  }

  const data = (await response.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error: string; code: string; detail?: unknown }
    | null;

  if (!response.ok || !data || data.ok === false) {
    const code = data && data.ok === false ? data.code : "internal";
    const message = data && data.ok === false ? data.error : "Anfrage fehlgeschlagen.";
    throw new ApiError(code, message, response.status, data && data.ok === false ? data.detail : undefined);
  }
  return data.data;
}

export const qk = {
  me: ["me"] as const,
  recipes: (scope: string) => ["recipes", scope] as const,
  recipe: (id: string) => ["recipe", id] as const,
  comments: (id: string) => ["comments", id] as const,
  diff: (id: string) => ["diff", id] as const,
  tags: (q: string) => ["tags", q] as const,
  categories: ["categories"] as const,
  friends: ["friends"] as const,
  friendRequests: ["friend-requests"] as const,
  profile: (id: string) => ["profile", id] as const,
  notifications: ["notifications"] as const,
  limits: ["limits"] as const,
  settings: ["settings"] as const,
  job: (id: string) => ["job", id] as const,
  importJob: (id: string) => ["import-job", id] as const,
  search: (q: string) => ["search", q] as const,
  platformCredentials: ["admin", "platforms"] as const,
};

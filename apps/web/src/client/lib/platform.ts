/**
 * The ennio.vip account API.
 *
 * The project page speaks to it with the shared `ennio_session` cookie
 * (SameSite=Lax, Domain=.ennio.vip). The browser does not need the platform
 * overlay: this module draws the German gate and asks the platform for a
 * project token. The password goes straight to api.ennio.vip and is never
 * stored here.
 */

const BASE = (import.meta.env.VITE_PLATFORM_ORIGIN as string | undefined) ?? "https://api.ennio.vip";
export const PROJECT = "kochen";

export type PlatformUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  projects: string[];
};

export type AccessState = {
  projects: string[];
  requests: Array<{ id: string; projectId: string; status: string; message: string; createdAt: string }>;
};

export class PlatformError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "PlatformError";
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/v1${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new PlatformError(0, "Der Kontodienst ist nicht erreichbar. Prüfe deine Verbindung.");
  }
  type Envelope = { ok?: boolean; data?: T; error?: string; code?: string };
  let payload: Envelope | null = null;
  try {
    payload = (await response.json()) as Envelope;
  } catch {
    payload = null;
  }
  if (!response.ok || !payload?.ok) {
    throw new PlatformError(
      response.status,
      germanFor(response.status, payload?.code, payload?.error),
      payload?.code,
    );
  }
  return payload.data as T;
}

function germanFor(status: number, code?: string, message?: string): string {
  if (status === 401) return "E-Mail oder Passwort stimmen nicht.";
  if (status === 403) return "Dieses Konto hat noch keinen Zugang.";
  if (status === 409) return "Für diese Adresse gibt es schon ein Konto. Melde dich an.";
  if (status === 429) return "Zu viele Versuche. Bitte warte einen Moment.";
  if (status === 400) return message ?? "Die Eingabe ist ungültig.";
  if (status >= 500) return "Der Kontodienst hat ein Problem. Bitte später erneut versuchen.";
  return message ?? "Der Kontodienst hat die Anfrage abgelehnt.";
}

export function login(email: string, password: string): Promise<{ user: PlatformUser }> {
  return call("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function signup(email: string, password: string, name: string): Promise<{ user: PlatformUser }> {
  return call("/auth/signup", { method: "POST", body: JSON.stringify({ email, password, name }) });
}

export function session(): Promise<{ user: PlatformUser | null }> {
  return call("/auth/session");
}

export function logout(): Promise<{ signedOut: boolean }> {
  return call("/auth/logout", { method: "POST" });
}

export function requestAccess(message: string): Promise<unknown> {
  return call("/access/requests", {
    method: "POST",
    body: JSON.stringify({ slug: PROJECT, message: message.slice(0, 1000) }),
  });
}

export function accessState(): Promise<AccessState> {
  return call("/access");
}

/* --------------------------------------------------------------- token ---- */

const TOKEN_KEY = "kochen.platformToken";
let memory: { token: string; at: number } | null = null;

function stored(): { token: string; at: number } | null {
  if (memory) return memory;
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token: string; at: number };
    if (typeof parsed.token !== "string" || typeof parsed.at !== "number") return null;
    memory = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function clearToken(): void {
  memory = null;
  sessionStorage.removeItem(TOKEN_KEY);
}

/** One project token, cached for four minutes. The platform token lives five. */
export async function platformToken(force = false): Promise<string> {
  const cached = stored();
  if (!force && cached && Date.now() - cached.at < 4 * 60 * 1000) return cached.token;
  const data = await call<{ token: string; expiresIn: number }>(
    `/auth/token?aud=${encodeURIComponent(PROJECT)}`,
  );
  const entry = { token: data.token, at: Date.now() };
  memory = entry;
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(entry));
  } catch {
    // Private mode may refuse storage; memory still works for this tab.
  }
  return data.token;
}

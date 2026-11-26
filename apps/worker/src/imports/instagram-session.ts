import { cookieSessionProblem } from "@kochen/core";

/**
 * Instagram needs a signed-in session for an age-restricted or private post.
 * A password alone is not enough: the login answers with a checkpoint. This
 * module signs in when the stored cookies have no `sessionid`, keeps the
 * session in memory, and reports the reason when Instagram asks for a
 * confirmation.
 */

const BASE = "https://www.instagram.com";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const APP_ID = "936619743392459";
const SESSION_DAYS = 30;
const FAILURE_COOLDOWN_MS = 10 * 60_000;

type LoginInput = {
  username: string | null;
  password: string | null;
  cookies: string | null;
};

type LoginOutcome = { session: string | null; problem: string | null };

let cache: { cookies: string; expiresAt: number } | null = null;
let problem: string | null = null;
let blockedUntil = 0;

/** The reason the last sign-in did not finish, for the import error. */
export function instagramLoginProblem(): string | null {
  return problem;
}

export function hasInstagramSession(cookies: string | null | undefined): boolean {
  return Boolean(cookies) && cookieSessionProblem("instagram", cookies ?? "") === null;
}

/** A cookie header from a Netscape file, for the sign-in request. */
export function instagramCookieHeader(cookies: string | null | undefined): string {
  const pairs = readNetscape(cookies ?? "");
  return [...pairs.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

/**
 * The stored cookies plus a session from a sign-in. Returns the input when a
 * session already exists or the sign-in cannot run.
 */
export async function instagramCookiesWithSession(login: LoginInput): Promise<string> {
  const stored = login.cookies ?? "";
  if (hasInstagramSession(stored)) return stored;
  if (cache && cache.expiresAt > Date.now()) return mergeSession(stored, cache.cookies);
  if (!login.username || !login.password) return stored;
  if (Date.now() < blockedUntil) return stored;

  const outcome = await signIn(login.username, login.password, stored);
  if (!outcome.session) {
    problem = outcome.problem;
    blockedUntil = Date.now() + FAILURE_COOLDOWN_MS;
    return stored;
  }
  cache = { cookies: outcome.session, expiresAt: Date.now() + SESSION_DAYS * 86_400_000 };
  problem = null;
  return mergeSession(stored, outcome.session);
}

async function signIn(
  username: string,
  password: string,
  stored: string,
): Promise<LoginOutcome> {
  try {
    const page = await fetch(`${BASE}/`, {
      headers: { "user-agent": UA, accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!page.ok) return { session: null, problem: "Instagram hat die Anmeldeseite nicht geliefert." };
    const html = await page.text();
    const fromPage = readSetCookies(page.headers.getSetCookie());
    const csrf = fromPage.get("csrftoken") ?? readNetscape(stored).get("csrftoken") ?? "";
    if (!csrf) return { session: null, problem: "Instagram hat kein CSRF-Token geliefert." };
    const rollout = /"rollout_hash":"([^"]+)"/.exec(html)?.[1] ?? "1";

    const body = new URLSearchParams({
      username,
      enc_password: `#PWD_INSTAGRAM_BROWSER:0:${Math.floor(Date.now() / 1000)}:${password}`,
      queryParams: "{}",
      optIntoOneTap: "false",
      trustedDeviceRecords: "{}",
    });
    const response = await fetch(`${BASE}/api/v1/web/accounts/login/ajax/`, {
      method: "POST",
      headers: {
        "user-agent": UA,
        accept: "*/*",
        "content-type": "application/x-www-form-urlencoded",
        "x-csrftoken": csrf,
        "x-instagram-ajax": rollout,
        "x-ig-app-id": APP_ID,
        "x-requested-with": "XMLHttpRequest",
        origin: BASE,
        referer: `${BASE}/`,
        cookie: [...fromPage.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
      },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000),
    });

    const text = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // A non-JSON answer is a block, not a login.
    }
    const set = readSetCookies(response.headers.getSetCookie());
    const sessionId = set.get("sessionid");
    if (data.authenticated === true && sessionId) {
      const now = Math.floor(Date.now() / 1000);
      const all = new Map<string, string>([...fromPage, ...set]);
      all.set("sessionid", sessionId);
      const rows = [...all.entries()]
        .filter(([name, value]) => Boolean(name) && Boolean(value))
        .map(([name, value]) => netscapeRow(name, value, now));
      return { session: rows.join("\n"), problem: null };
    }

    if (data.checkpoint_url || data.message === "checkpoint_required") {
      return {
        session: null,
        problem:
          "Instagram verlangt eine Bestätigung dieser Anmeldung. Öffne Instagram im Browser, bestätige die Anmeldung und importiere danach erneut.",
      };
    }
    if (data.two_factor_required === true) {
      return {
        session: null,
        problem:
          "Instagram verlangt einen Sicherheitscode. Schließe die Anmeldung im Browser ab und exportiere die Cookies.",
      };
    }
    if (data.message === "bad_password" || data.user === false) {
      return {
        session: null,
        problem:
          "Instagram hat Benutzername oder Passwort abgelehnt. Prüfe die Zugangsdaten im Admin.",
      };
    }
    return {
      session: null,
      problem:
        "Instagram hat die Anmeldung ohne Sitzung beendet. Exportiere die Cookies einer angemeldeten Sitzung.",
    };
  } catch {
    return { session: null, problem: "Instagram war bei der Anmeldung nicht erreichbar." };
  }
}

/** Stored cookies plus the new session rows. The new value wins. */
export function mergeSession(stored: string, session: string): string {
  const rows = new Map<string, string>();
  for (const [name, value] of readNetscape(stored)) rows.set(name, value);
  for (const row of readSessionCookies(session)) rows.set(row.name, row.value);
  const expiry = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86_400;
  const lines = ["# Netscape HTTP Cookie File", "# This file is generated by kochen. Do not edit."];
  for (const [name, value] of rows) lines.push(netscapeRow(name, value, expiry));
  return `${lines.join("\n")}\n`;
}

function netscapeRow(name: string, value: string, expiry: number): string {
  return `.instagram.com\tTRUE\t/\tTRUE\t${expiry}\t${name}\t${value}`;
}

function readSessionCookies(session: string): Array<{ name: string; value: string }> {
  const rows: Array<{ name: string; value: string }> = [];
  for (const line of session.split(/\r?\n/)) {
    const row = parseRow(line);
    if (row) rows.push(row);
  }
  return rows;
}

function readNetscape(cookies: string): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const line of cookies.split(/\r?\n/)) {
    const row = parseRow(line);
    if (row && row.domain.endsWith("instagram.com")) pairs.set(row.name, row.value);
  }
  return pairs;
}

function parseRow(line: string): { domain: string; name: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const parts = trimmed.split("\t");
  if (parts.length < 7) return null;
  const domain = (parts[0] ?? "").trim();
  const name = parts[5]?.trim();
  const value = parts[6]?.trim();
  if (!name || value === undefined) return null;
  return { domain, name, value };
}

function readSetCookies(headers: string[]): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const header of headers) {
    const first = header.split(";")[0] ?? "";
    const index = first.indexOf("=");
    if (index <= 0) continue;
    pairs.set(first.slice(0, index).trim(), first.slice(index + 1).trim());
  }
  return pairs;
}

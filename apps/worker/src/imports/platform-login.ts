import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openSecret } from "@kochen/core";
import { db } from "@kochen/db";

export type PlatformName = "youtube" | "instagram" | "tiktok";

/** Where a signed-in visitor goes to check a login. */
export const PLATFORM_TEST_URLS: Record<PlatformName, string> = {
  // "Me at the zoo" is the first YouTube video and has stayed public.
  youtube: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  instagram: "https://www.instagram.com/instagram/",
  tiktok: "https://www.tiktok.com/@tiktok",
};

const PLATFORM_HOSTS: Array<[PlatformName, RegExp]> = [
  ["youtube", /(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$/],
  ["instagram", /(^|\.)instagram\.com$/],
  ["tiktok", /(^|\.)tiktok\.com$/],
];

export function platformOf(url: string): PlatformName | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    for (const [name, pattern] of PLATFORM_HOSTS) {
      if (pattern.test(host)) return name;
    }
    return null;
  } catch {
    return null;
  }
}

function configValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export type PlatformLogin = {
  username: string | null;
  password: string | null;
  cookies: string | null;
  /** A stored secret exists but this process cannot open it. */
  unreadable: boolean;
};

type CredentialRow = {
  username: string | null;
  passwordEnc: string | null;
  cookiesEnc: string | null;
};

/** The stored login for one platform, decrypted. Null when nothing is stored. */
export async function platformLogin(platform: PlatformName): Promise<PlatformLogin | null> {
  let row: CredentialRow | undefined;
  try {
    const sql = db();
    const rows = await sql<CredentialRow[]>`
      select username,
             password_enc as "passwordEnc",
             cookies_enc as "cookiesEnc"
      from platform_credentials
      where platform = ${platform}
    `;
    row = rows[0];
  } catch {
    // No table or no database read: the caller runs signed out.
    return null;
  }
  if (!row) return null;

  const password = row.passwordEnc ? await openSecret(row.passwordEnc) : null;
  const cookies = row.cookiesEnc ? await openSecret(row.cookiesEnc) : null;
  const unreadable =
    (Boolean(row.passwordEnc) && password === null) ||
    (Boolean(row.cookiesEnc) && cookies === null);
  if (!row.username && !password && !cookies) return null;
  return { username: row.username, password, cookies, unreadable };
}

/**
 * yt-dlp arguments for the stored login. Written to a private config file, so
 * no password appears in a process list. An empty list means signed out.
 */
export async function loginArgsFor(platform: PlatformName, dir: string): Promise<string[]> {
  const login = await platformLogin(platform);
  if (!login) return [];

  const lines: string[] = [];
  if (login.cookies) {
    const cookieFile = join(dir, "cookies.txt");
    await writeFile(cookieFile, login.cookies, { mode: 0o600 });
    lines.push(`--cookies ${configValue(cookieFile)}`);
  }
  if (login.username) lines.push(`--username ${configValue(login.username)}`);
  if (login.password) lines.push(`--password ${configValue(login.password)}`);
  if (lines.length === 0) return [];

  const config = join(dir, "yt-dlp.conf");
  await writeFile(config, `${lines.join("\n")}\n`, { mode: 0o600 });
  return ["--config-locations", config];
}

/** Same arguments, chosen by the URL of the import. */
export async function loginArgs(url: string, dir: string): Promise<string[]> {
  const platform = platformOf(url);
  return platform ? loginArgsFor(platform, dir) : [];
}

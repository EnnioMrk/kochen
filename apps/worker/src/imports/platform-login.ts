import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openSecret } from "@kochen/core";
import { db } from "@kochen/db";

export type PlatformName = "youtube" | "instagram" | "tiktok";

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

type CredentialRow = {
  username: string | null;
  passwordEnc: string | null;
  cookiesEnc: string | null;
};

/**
 * yt-dlp arguments for the login an admin stored for this platform. Written to
 * a private config file, so no password appears in a process list. An empty
 * list means the import runs signed out, as before.
 */
export async function loginArgs(url: string, dir: string): Promise<string[]> {
  const platform = platformOf(url);
  if (!platform) return [];

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
    // No table or no database read: the import still runs signed out.
    return [];
  }
  if (!row) return [];

  const lines: string[] = [];
  if (row.cookiesEnc) {
    const cookies = await openSecret(row.cookiesEnc);
    if (cookies) {
      const cookieFile = join(dir, "cookies.txt");
      await writeFile(cookieFile, cookies, { mode: 0o600 });
      lines.push(`--cookies ${configValue(cookieFile)}`);
    }
  }
  const password = row.passwordEnc ? await openSecret(row.passwordEnc) : null;
  if (row.username) lines.push(`--username ${configValue(row.username)}`);
  if (password) lines.push(`--password ${configValue(password)}`);
  if (lines.length === 0) return [];

  const config = join(dir, "yt-dlp.conf");
  await writeFile(config, `${lines.join("\n")}\n`, { mode: 0o600 });
  return ["--config-locations", config];
}

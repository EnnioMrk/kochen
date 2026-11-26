/**
 * A cookie file is only useful when it holds a signed-in session. A visitor
 * who exports the cookies before signing in gets `csrftoken` and `mid`, which
 * look like a login but cannot open a restricted post.
 */

export type CookiePlatform = "youtube" | "instagram" | "tiktok";

type Requirement = { any: string[]; label: string; host: string };

const REQUIREMENTS: Record<CookiePlatform, Requirement> = {
  instagram: { any: ["sessionid"], label: "sessionid", host: "instagram.com" },
  tiktok: { any: ["sessionid", "sid_tt"], label: "sessionid", host: "tiktok.com" },
  youtube: {
    any: ["SID", "__Secure-1PSID", "__Secure-3PSID"],
    label: "SID",
    host: "youtube.com",
  },
};

/** Names of the cookies in a Netscape file, a JSON export, or a header line. */
export function cookieNames(cookies: string): Set<string> {
  const names = new Set<string>();
  const text = cookies.trim();
  if (!text) return names;

  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { cookies?: unknown }).cookies)
          ? ((parsed as { cookies: unknown[] }).cookies)
          : [];
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const name = (item as { name?: unknown }).name;
        if (typeof name === "string" && name) names.add(name);
      }
      if (names.size > 0) return names;
    } catch {
      // Not JSON. Read it as a header line.
    }
  }

  for (const line of text.split(/\r?\n/)) {
    const row = line.trim();
    if (!row || row.startsWith("#")) continue;
    const parts = row.split("\t");
    if (parts.length >= 7) {
      const name = parts[5]?.trim();
      if (name) names.add(name);
      continue;
    }
    for (const pair of row.split(";")) {
      const name = pair.split("=")[0]?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * Null when the cookies hold a signed-in session. Otherwise one German
 * sentence that names the missing cookie.
 */
export function cookieSessionProblem(platform: CookiePlatform, cookies: string): string | null {
  const requirement = REQUIREMENTS[platform];
  const names = cookieNames(cookies);
  if (requirement.any.some((name) => names.has(name))) return null;
  return `Die Cookies enthalten keine ${platform === "youtube" ? "YouTube-" : platform === "instagram" ? "Instagram-" : "TikTok-"}Sitzung (${requirement.label}). Exportiere die Cookies auf ${requirement.host}, während du angemeldet bist.`;
}

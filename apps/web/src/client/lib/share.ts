/**
 * A link shared to the app. Android and Chrome send the address in `url`.
 * Some apps send it inside `text` or `title` instead, so all three are read.
 */

export type SharedPayload = {
  url?: string | null;
  text?: string | null;
  title?: string | null;
};

/** Punctuation that belongs to the sentence, not to the address. */
const TRAILING_PUNCTUATION = /[)\].,;:!?'"»]+$/;

function usableUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(TRAILING_PUNCTUATION, "");
  if (!trimmed) return null;
  // A shared link may arrive without a scheme ("instagram.com/reel/…").
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname.includes(".")) return null;
  return parsed.toString();
}

function firstUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const direct = value.match(/https?:\/\/[^\s<>"']+/i);
  if (direct) return usableUrl(direct[0]);
  const bare = value.match(/(?:^|[\s(])((?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>"']*)?)/i);
  return bare?.[1] ? usableUrl(bare[1]) : null;
}

/** The one link to capture from a share payload, or null when it has none. */
export function sharedLink(payload: SharedPayload): string | null {
  return (
    usableUrl(payload.url ?? "") ??
    firstUrl(payload.text) ??
    firstUrl(payload.title)
  );
}

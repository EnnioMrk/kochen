/**
 * Cache key for one analysed source link.
 *
 * The same recipe under different tracking parameters must land on the same
 * key, so a link is read by the model only once.
 */

/** Query parameters that never change the page content. */
const TRACKING_PARAMS: RegExp[] = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^gbraid$/i,
  /^wbraid$/i,
  /^dclid$/i,
  /^msclkid$/i,
  /^yclid$/i,
  /^twclid$/i,
  /^ttclid$/i,
  /^igshid$/i,
  /^igsh$/i,
  /^si$/i,
  /^mkt_tok$/i,
  /^mc_cid$/i,
  /^mc_eid$/i,
  /^_hsenc$/i,
  /^_hsmi$/i,
  /^is_from_webapp$/i,
  /^sender_device$/i,
  /^web_id$/i,
  /^share_id$/i,
];

const MAX_KEY_LENGTH = 1000;

function isTracking(key: string): boolean {
  return TRACKING_PARAMS.some((pattern) => pattern.test(key));
}

/**
 * Canonical key for a source URL. Returns null when the value is not a public
 * http(s) address. The key keeps the host, the path and the meaningful query,
 * drops the fragment and sorts the query, so the order a share sheet produces
 * does not matter.
 */
export function sourceCacheKey(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (!host.includes(".")) return null;

  let path = url.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (path === "/") path = "";

  const params: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams) {
    if (!key || isTracking(key)) continue;
    params.push([key, value]);
  }
  params.sort((left, right) => {
    if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
    if (left[1] === right[1]) return 0;
    return left[1] < right[1] ? -1 : 1;
  });

  const query = params
    .map(([key, value]) => (value ? `${encodeURIComponent(key)}=${encodeURIComponent(value)}` : encodeURIComponent(key)))
    .join("&");

  const port = url.port ? `:${url.port}` : "";
  const key = `${host}${port}${path}${query ? `?${query}` : ""}`;
  return key.length > MAX_KEY_LENGTH ? key.slice(0, MAX_KEY_LENGTH) : key;
}

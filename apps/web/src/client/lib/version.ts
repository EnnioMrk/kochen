/**
 * Client files carry a content hash in the file name. A build that changes the
 * client changes at least one name; a change to the server, the worker, the
 * docs or the manifest does not. So the page compares the names it loaded with
 * the names the live `index.html` asks for. A reload is offered only when the
 * running client code is behind, not on every deploy.
 */

const CLIENT_ASSET = /\/assets\/[^/?#]+\.(?:js|css)$/;

function names(values: Iterable<string>): string[] {
  const found = new Set<string>();
  for (const value of values) {
    const path = value.split(/[?#]/, 1)[0] ?? value;
    if (CLIENT_ASSET.test(path)) found.add(path);
  }
  return [...found].sort();
}

/** The client script and style names in an HTML document. */
export function assetsInHtml(html: string): string[] {
  return names([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1] ?? ""));
}

/** The client script and style names the running page loaded. */
export function runningAssets(doc: Document): string[] {
  const values: string[] = [];
  for (const el of doc.querySelectorAll("script[src], link[href]")) {
    const value = el.getAttribute("src") ?? el.getAttribute("href");
    if (value) values.push(value);
  }
  return names(values);
}

/**
 * True only when the live page names different client files. A missing answer
 * or a development page (no `/assets/` names) never counts as stale.
 */
export function isStale(running: string[], live: string[] | null): boolean {
  if (!live || live.length === 0 || running.length === 0) return false;
  const now = [...running].sort();
  const next = [...live].sort();
  if (now.length !== next.length) return true;
  return now.some((name, index) => name !== next[index]);
}

/** The client file names of the live build, or null when there is no answer. */
export async function fetchLiveAssets(): Promise<string[] | null> {
  // The timestamp and no-store keep every cache out of the answer.
  const response = await fetch(`/?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) return null;
  const assets = assetsInHtml(await response.text());
  return assets.length > 0 ? assets : null;
}

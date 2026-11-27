/**
 * The running bundle carries the id of the build that made it. `/version.json`
 * carries the id of the build that is live now. A difference means the page
 * runs an old bundle and should offer a reload.
 */

export const appBuildId: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

/** Local development has no version file, so it never counts as stale. */
export function isStale(running: string, latest: string | null): boolean {
  if (!latest || !running || running === "dev" || latest === "dev") return false;
  return running !== latest;
}

/** The id of the live build, or null when the answer is missing or broken. */
export async function fetchBuildId(): Promise<string | null> {
  // The timestamp and no-store keep every cache out of the answer.
  const response = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) return null;
  const data = (await response.json().catch(() => null)) as { id?: unknown } | null;
  return typeof data?.id === "string" && data.id ? data.id : null;
}

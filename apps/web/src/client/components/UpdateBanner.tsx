import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "./ui";
import { appBuildId, fetchBuildId, isStale } from "../lib/version";

const CHECK_MS = 5 * 60_000;

/**
 * A loaded page keeps its bundle until it reloads. This strip appears when a
 * newer build is live, and the button loads it. The check runs on a timer and
 * when the app returns to the foreground, so a phone that slept all night
 * sees the new version on the next look.
 */
export function UpdateBanner() {
  const [stale, setStale] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const latest = await fetchBuildId().catch(() => null);
      if (!stopped && isStale(appBuildId, latest)) setStale(true);
    };

    void check();
    const timer = window.setInterval(() => void check(), CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const onOnline = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  if (!stale) return null;

  const apply = async () => {
    setApplying(true);
    try {
      // Fetch the service worker script too, then load the new shell.
      const registration = await navigator.serviceWorker?.getRegistration();
      await registration?.update();
    } catch {
      // A failed update check must not block the reload.
    }
    window.location.reload();
  };

  return (
    <div role="status" className="border-b border-brand/20 bg-brand/[0.06]">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 sm:px-6">
        <RefreshCw className="size-4 shrink-0 text-brand" aria-hidden />
        <p className="min-w-0 flex-1 text-sm text-ink">
          Eine neue Version ist verfügbar.
        </p>
        <Button size="sm" loading={applying} onClick={() => void apply()}>
          Neu laden
        </Button>
      </div>
    </div>
  );
}

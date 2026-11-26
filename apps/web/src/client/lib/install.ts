/**
 * Install prompt state for the PWA. The browser fires `beforeinstallprompt`
 * early and once; main.tsx imports this module so the event is not missed.
 */

export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: InstallPromptEvent | null = null;
let installedThisSession = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // The browser hides its own banner. The install page owns the button.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installedThisSession = true;
    emit();
  });
}

export function subscribeInstall(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while the browser offers a programmatic install prompt. */
export function installPromptAvailable(): boolean {
  return deferred !== null;
}

/** True when the page already runs as the installed app. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const navigatorStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const media = typeof window.matchMedia === "function"
    ? window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches
    : false;
  return navigatorStandalone || media;
}

export function wasInstalledThisSession(): boolean {
  return installedThisSession;
}

/** iOS and iPadOS never fire the prompt; the page shows Safari steps there. */
export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || touchMac;
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferred;
  if (!event) return "unavailable";
  // The prompt can be used one time only.
  deferred = null;
  emit();
  await event.prompt();
  const choice = await event.userChoice.catch(() => null);
  return choice?.outcome === "accepted" ? "accepted" : "dismissed";
}

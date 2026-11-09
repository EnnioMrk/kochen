import { useEffect, useRef, useState } from "react";

export type WakeLockState = "off" | "requesting" | "on" | "fallback";

type Fallback = {
  video: HTMLVideoElement;
  stream: MediaStream;
  timer: number;
};

/**
 * Keeps the screen awake in cooking mode.
 *
 * Primary: the Screen Wake Lock API. Re-acquired when the tab becomes visible.
 * Fallback: a muted, looping 1-pixel video fed by a canvas (NoSleep method).
 */
export function useWakeLock(active: boolean) {
  const [state, setState] = useState<WakeLockState>("off");
  const sentinel = useRef<WakeLockSentinel | null>(null);
  const fallback = useRef<Fallback | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const stopFallback = () => {
      const current = fallback.current;
      if (!current) return;
      window.clearInterval(current.timer);
      current.video.srcObject = null;
      current.video.remove();
      for (const track of current.stream.getTracks()) track.stop();
      fallback.current = null;
    };

    const startFallback = () => {
      if (cancelled || fallback.current) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 2;
        canvas.height = 2;
        const context = canvas.getContext("2d");
        if (context) {
          context.fillStyle = "#000000";
          context.fillRect(0, 0, 2, 2);
        }
        const stream = canvas.captureStream(1);
        const video = document.createElement("video");
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.setAttribute("aria-hidden", "true");
        video.style.cssText =
          "position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.01;pointer-events:none;";
        video.srcObject = stream;
        document.body.appendChild(video);
        void video.play().catch(() => {});
        const timer = window.setInterval(() => {
          if (!context) return;
          context.fillStyle = context.fillStyle === "#000000" ? "#010101" : "#000000";
          context.fillRect(0, 0, 2, 2);
        }, 1000);
        fallback.current = { video, stream, timer };
        setState("fallback");
      } catch {
        setState("off");
      }
    };

    const request = async () => {
      if (cancelled) return;
      if (sentinel.current) {
        setState("on");
        return;
      }
      setState("requesting");
      if (typeof navigator !== "undefined" && "wakeLock" in navigator && navigator.wakeLock) {
        try {
          const next = await navigator.wakeLock.request("screen");
          if (cancelled) {
            void next.release().catch(() => {});
            return;
          }
          sentinel.current = next;
          setState("on");
          next.addEventListener("release", () => {
            if (!cancelled) setState("off");
          });
          return;
        } catch {
          startFallback();
          return;
        }
      }
      startFallback();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void request();
    };

    void request();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const current = sentinel.current;
      sentinel.current = null;
      if (current) void current.release().catch(() => {});
      stopFallback();
      setState("off");
    };
  }, [active]);

  return {
    state,
    active: state === "on" || state === "fallback",
    fallback: state === "fallback",
  };
}

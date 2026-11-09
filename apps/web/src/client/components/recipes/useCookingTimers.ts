import { useEffect, useRef, useState } from "react";
import type { Timer } from "@kochen/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { errorText } from "../../lib/utils";
import { useToast } from "../ui";

export type CookingTimer = Timer & { recipeId: string };

const TIMERS_KEY = ["timers"] as const;

/**
 * Step timers for cooking mode. The server owns `endsAt`; the client only
 * renders the countdown and recomputes it after a reload.
 */
export function useCookingTimers(recipeId: string) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<string[]>([]);
  const notified = useRef<Set<string>>(new Set());

  const query = useQuery({
    queryKey: TIMERS_KEY,
    queryFn: () => api<CookingTimer[]>("/api/timers"),
    staleTime: 15_000,
  });

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const start = useMutation({
    mutationFn: (input: { stepId: string; seconds: number }) =>
      api<CookingTimer>("/api/timers", {
        method: "POST",
        body: { recipeId, stepId: input.stepId, seconds: input.seconds },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TIMERS_KEY });
    },
    onError: (error) => toast.push(errorText(error), "error"),
  });

  const cancel = useMutation({
    mutationFn: (timerId: string) =>
      api<{ cancelled: boolean }>(`/api/timers/${timerId}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TIMERS_KEY });
    },
    onError: (error) => toast.push(errorText(error), "error"),
  });

  const timers = (query.data ?? []).filter(
    (timer) => timer.recipeId === recipeId && !dismissed.includes(timer.id),
  );

  const remainingMs = (timer: CookingTimer) =>
    new Date(timer.endsAt).getTime() - now;

  const timerFor = (stepId: string): CookingTimer | null => {
    for (let index = timers.length - 1; index >= 0; index -= 1) {
      const timer = timers[index];
      if (timer && timer.stepId === stepId) return timer;
    }
    return null;
  };

  const startTimer = async (stepId: string, seconds: number) => {
    if (seconds <= 0) return;
    // Ask for notifications only on the first useful action, never on load.
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        // The timer still works without notifications.
      }
    }
    start.mutate({ stepId, seconds: Math.round(seconds) });
  };

  const dismiss = (timerId: string) => {
    setDismissed((current) => [...current, timerId]);
    cancel.mutate(timerId);
  };

  useEffect(() => {
    for (const timer of timers) {
      if (new Date(timer.endsAt).getTime() > now) continue;
      if (notified.current.has(timer.id)) continue;
      notified.current.add(timer.id);
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification("Zeit abgelaufen", {
            body: "Der Timer für einen Schritt ist fertig.",
            tag: `kochen-timer-${timer.id}`,
          });
        } catch {
          // Some browsers block the constructor outside a service worker.
        }
      }
    }
  }, [timers, now]);

  return {
    timers,
    timerFor,
    remainingMs,
    startTimer,
    dismiss,
    loading: query.isLoading,
    startPending: start.isPending,
    cancelPending: cancel.isPending,
  };
}

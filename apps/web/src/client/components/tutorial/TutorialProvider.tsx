import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, qk } from "../../lib/api";
import { TutorialOverlay } from "./TutorialOverlay";

/** Local mirror of `users.tutorial_done_at`, in case the call fails. */
const LOCAL_DONE_KEY = "rezeptor.tour.done";

type TutorialContextValue = { start: () => void };

const TutorialContext = createContext<TutorialContextValue | null>(null);

export function useTutorial(): TutorialContextValue {
  const value = useContext(TutorialContext);
  if (!value) throw new Error("useTutorial needs TutorialProvider");
  return value;
}

/**
 * Owns the tour. It starts by itself for an account that has not seen it, and
 * `start()` opens it again from Settings.
 */
export function TutorialProvider({
  autoStart,
  children,
}: {
  autoStart: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const timerRef = useRef(0);

  const start = useCallback(() => {
    // The tour points at elements of the start page.
    navigate("/");
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setOpen(true), 120);
  }, [navigate]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  useEffect(() => {
    if (!autoStart) return;
    let stored = false;
    try {
      stored = window.localStorage.getItem(LOCAL_DONE_KEY) === "1";
    } catch {
      stored = false;
    }
    if (stored) return;
    timerRef.current = window.setTimeout(() => setOpen(true), 500);
    return () => window.clearTimeout(timerRef.current);
  }, [autoStart]);

  const close = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(LOCAL_DONE_KEY, "1");
    } catch {
      /* storage may be off; the account flag still carries the state */
    }
    void api<{ updated: boolean }>("/api/me", { method: "PATCH", body: { tutorialDone: true } })
      .then(() => queryClient.invalidateQueries({ queryKey: qk.me }))
      .catch(() => undefined);
  }, [queryClient]);

  const value = useMemo(() => ({ start }), [start]);

  return (
    <TutorialContext.Provider value={value}>
      {children}
      {open ? <TutorialOverlay onClose={close} /> : null}
    </TutorialContext.Provider>
  );
}

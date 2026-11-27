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
import { api, qk } from "../lib/api";
import { useMe, type SessionUser } from "../lib/session";
import { useToast } from "./ui";
import {
  DEFAULT_THEME,
  THEME_PRESETS,
  applyTheme,
  readStoredChoice,
  resolveTheme,
  sameChoice,
  type ResolvedTheme,
  type ThemeChoice,
} from "../lib/theme";

type ThemeContextValue = {
  /** The saved theme. */
  choice: ThemeChoice;
  /** The theme on screen. It differs from `choice` while a custom palette is previewed. */
  active: ThemeChoice;
  resolved: ResolvedTheme;
  presets: typeof THEME_PRESETS;
  saving: boolean;
  /** Apply and store on the account. */
  save: (choice: ThemeChoice) => Promise<boolean>;
  /** Apply without storing. */
  preview: (choice: ThemeChoice) => void;
  /** Drop a preview and return to the saved theme. */
  restore: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const KEY_PATTERN = /^#[0-9a-f]{6}$/i;

/** A theme from the server may be old or hand-written. Keep only what resolves. */
function normalizeTheme(value: unknown): ThemeChoice | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ThemeChoice>;
  const presets = [...THEME_PRESETS.map((preset) => preset.id), "custom"];
  if (!candidate.preset || !presets.includes(candidate.preset)) return null;
  if (candidate.preset === "custom") {
    const colors = candidate.colors;
    if (
      !colors ||
      !KEY_PATTERN.test(colors.paper ?? "") ||
      !KEY_PATTERN.test(colors.ink ?? "") ||
      !KEY_PATTERN.test(colors.brand ?? "") ||
      !KEY_PATTERN.test(colors.sage ?? "")
    ) {
      return null;
    }
    return {
      preset: "custom",
      colors: { paper: colors.paper!, ink: colors.ink!, brand: colors.brand!, sage: colors.sage! },
      name: typeof candidate.name === "string" ? candidate.name : undefined,
    };
  }
  return { preset: candidate.preset as ThemeChoice["preset"] };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useMe();

  const cached = useRef(readStoredChoice()).current;
  const initial = cached ?? DEFAULT_THEME;
  const [choice, setChoice] = useState<ThemeChoice>(initial);
  const [active, setActive] = useState<ThemeChoice>(initial);
  const [saving, setSaving] = useState(false);
  const saved = useRef<ThemeChoice>(initial);
  const previewing = useRef(false);

  const show = useCallback((next: ThemeChoice, persistCache: boolean) => {
    applyTheme(next, persistCache);
    setActive(next);
  }, []);

  // First paint without a cache: put the default tokens on the document.
  useEffect(() => {
    if (!cached) show(DEFAULT_THEME, true);
    // The inline boot script in index.html already applied a cached theme.
  }, [cached, show]);

  const save = useCallback(
    async (next: ThemeChoice, options?: { silent?: boolean }): Promise<boolean> => {
      const previous = saved.current;
      saved.current = next;
      previewing.current = false;
      setChoice(next);
      show(next, true);
      setSaving(true);
      try {
        await api<{ updated: boolean }>("/api/me", { method: "PATCH", body: { theme: next } });
        queryClient.setQueryData<SessionUser>(qk.me, (old) => (old ? { ...old, theme: next } : old));
        return true;
      } catch {
        saved.current = previous;
        setChoice(previous);
        show(previous, true);
        if (!options?.silent) toast.push("Das Farbschema konnte nicht gespeichert werden.", "error");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [queryClient, show, toast],
  );

  // The account is the source of truth. A device with no account theme keeps
  // its local choice and uploads it once.
  const serverTheme = normalizeTheme(me.data?.theme ?? null);
  const themeKey = serverTheme ? JSON.stringify(serverTheme) : "";
  const serverKnown = Boolean(me.data);

  useEffect(() => {
    if (!serverKnown || previewing.current) return;
    if (serverTheme) {
      if (!sameChoice(serverTheme, saved.current)) {
        saved.current = serverTheme;
        setChoice(serverTheme);
        show(serverTheme, true);
      }
      return;
    }
    if (!sameChoice(saved.current, DEFAULT_THEME)) {
      void save(saved.current, { silent: true });
    }
    // `themeKey` covers the value; `serverKnown` covers the first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKnown, themeKey]);

  const preview = useCallback(
    (next: ThemeChoice) => {
      previewing.current = true;
      show(next, false);
    },
    [show],
  );

  const restore = useCallback(() => {
    previewing.current = false;
    show(saved.current, true);
  }, [show]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      choice,
      active,
      resolved: resolveTheme(active),
      presets: THEME_PRESETS,
      saving,
      save: (next) => save(next),
      preview,
      restore,
    }),
    [active, choice, preview, restore, save, saving],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme needs a ThemeProvider");
  return value;
}

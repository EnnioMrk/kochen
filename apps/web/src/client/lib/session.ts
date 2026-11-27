import { useQuery } from "@tanstack/react-query";
import { api, qk } from "./api";
import type { ThemeChoice } from "./theme";

export type SessionUser = {
  id: string;
  platformSub: string;
  email: string | null;
  name: string;
  role: "member" | "admin" | "owner";
  avatarUrl: string | null;
  friendListVisible: boolean;
  cookingView: "steps" | "overview";
  tutorialDone: boolean;
  /** null or missing means the member still uses the default palette. */
  theme?: ThemeChoice | null;
  unreadNotifications?: number;
  friendRequests?: number;
  deletedAt: string | null;
};

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => api<SessionUser>("/api/me"),
    staleTime: 60_000,
    retry: false,
  });
}

export function useOnline(): boolean {
  return navigator.onLine;
}

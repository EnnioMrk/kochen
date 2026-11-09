import { useQuery } from "@tanstack/react-query";
import { api, qk } from "./api";

export type SessionUser = {
  id: string;
  platformSub: string;
  email: string | null;
  name: string;
  role: "member" | "admin" | "owner";
  avatarUrl: string | null;
  friendListVisible: boolean;
  cookingView: "steps" | "overview";
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

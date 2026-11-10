import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Notification as AppNotification } from "@kochen/contracts";
import {
  Bell,
  Check,
  Clock,
  GitBranch,
  MessageCircle,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { api, qk } from "../lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  PageHeader,
  Skeleton,
  useToast,
} from "../components/ui";
import { PushControl } from "../components/social/PushControl";
import { cn, relativeTime } from "../lib/utils";

function text(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

type Info = { title: string; detail: string | null; to: string | null };

function infoFor(notification: AppNotification): Info {
  const from = text(notification.payload, "from") ?? "Jemand";
  const recipeId = text(notification.payload, "recipeId");
  const recipePath = recipeId ? `/rezept/${recipeId}` : null;
  switch (notification.kind) {
    case "comment":
      return {
        title: `${from} hat kommentiert`,
        detail: text(notification.payload, "recipeTitle"),
        to: recipePath,
      };
    case "reply":
      return {
        title: `${from} hat auf deinen Kommentar geantwortet`,
        detail: text(notification.payload, "recipeTitle"),
        to: recipePath,
      };
    case "friend_request":
      return { title: `${from} möchte mit dir befreundet sein`, detail: null, to: "/freunde" };
    case "friend_accepted": {
      const userId = text(notification.payload, "userId");
      return {
        title: `${from} hat die Freundschaft bestätigt`,
        detail: null,
        to: userId ? `/profil/${userId}` : "/freunde",
      };
    }
    case "variation":
      return {
        title: `${from} hat eine Variante erstellt`,
        detail: text(notification.payload, "title"),
        to: recipePath,
      };
    case "timer":
      return {
        title: "Ein Timer ist abgelaufen",
        detail: text(notification.payload, "recipeTitle"),
        to: recipeId ? `/rezept/${recipeId}/kochen` : null,
      };
    default:
      return { title: "Neues Ereignis", detail: null, to: null };
  }
}

function KindIcon({ kind }: { kind: AppNotification["kind"] }) {
  const className = "size-5";
  switch (kind) {
    case "comment":
    case "reply":
      return <MessageCircle className={className} />;
    case "friend_request":
      return <UserPlus className={className} />;
    case "friend_accepted":
      return <UserCheck className={className} />;
    case "variation":
      return <GitBranch className={className} />;
    case "timer":
      return <Clock className={className} />;
    default:
      return <Bell className={className} />;
  }
}

export function NotificationsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const notificationsQuery = useQuery({
    queryKey: qk.notifications,
    queryFn: () => api<AppNotification[]>("/api/notifications"),
    refetchInterval: 60_000,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.notifications });
    void queryClient.invalidateQueries({ queryKey: qk.me });
  };

  const markOne = useMutation({
    mutationFn: (id: string) => api(`/api/notifications/${id}/read`, { method: "POST" }),
    onSuccess: refresh,
    onError: () => toast.push("Konnte nicht als gelesen markiert werden.", "error"),
  });

  const markAll = useMutation({
    mutationFn: () => api("/api/notifications/read-all", { method: "POST" }),
    onSuccess: () => {
      toast.push("Alle Benachrichtigungen sind gelesen.", "info");
      refresh();
    },
    onError: () => toast.push("Konnte nicht als gelesen markiert werden.", "error"),
  });

  const notifications = notificationsQuery.data ?? [];
  const unread = notifications.filter((notification) => !notification.readAt).length;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Benachrichtigungen"
        subtitle="Kommentare, Freundschaften, Varianten und Timer. Push ist nur ein Hinweis, diese Liste ist der Verlauf."
        actions={
          <Button
            variant="secondary"
            size="sm"
            disabled={unread === 0}
            loading={markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            <Check className="size-4" />
            Alle als gelesen
          </Button>
        }
      />

      <div className="space-y-4">
        <PushControl />

        <Card className="p-2 sm:p-3">
          {notificationsQuery.isPending && (
            <div className="space-y-3 p-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex items-center gap-3">
                  <Skeleton className="size-10 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {notificationsQuery.isError && (
            <div className="p-2">
              <p className="text-sm text-danger">Die Benachrichtigungen konnten nicht geladen werden.</p>
              <Button variant="secondary" size="sm" className="mt-2" onClick={() => void notificationsQuery.refetch()}>
                Erneut versuchen
              </Button>
            </div>
          )}

          {notificationsQuery.data && notifications.length === 0 && (
            <div className="p-2">
              <EmptyState
                title="Keine Benachrichtigungen"
                body="Hier erscheinen Kommentare zu deinen Rezepten, Freundschaftsanfragen, neue Varianten und abgelaufene Timer."
                icon={<Bell className="size-8" />}
              />
            </div>
          )}

          {notifications.length > 0 && (
            <ul className="divide-y divide-line/60">
              {notifications.map((notification) => {
                const info = infoFor(notification);
                const isUnread = !notification.readAt;
                const content = (
                  <>
                    <span
                      className={cn(
                        "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full",
                        isUnread ? "bg-brand/10 text-brand" : "bg-ink/5 text-ink-soft",
                      )}
                    >
                      <KindIcon kind={notification.kind} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm", isUnread ? "font-medium text-ink" : "text-ink-soft")}>
                        {info.title}
                      </span>
                      {info.detail && <span className="mt-0.5 block truncate text-xs text-ink-soft">{info.detail}</span>}
                      <span className="mt-0.5 block text-xs text-ink-soft/80">{relativeTime(notification.createdAt)}</span>
                    </span>
                  </>
                );

                return (
                  <li
                    key={notification.id}
                    className={cn(
                      "flex items-center gap-1 rounded-lg",
                      isUnread && "bg-brand/[0.045]",
                    )}
                  >
                    {info.to ? (
                      <Link
                        to={info.to}
                        onClick={() => {
                          if (isUnread) markOne.mutate(notification.id);
                        }}
                        className="tap flex min-w-0 flex-1 items-start gap-3 rounded-lg px-2 py-3 transition hover:bg-ink/5"
                      >
                        {content}
                      </Link>
                    ) : (
                      <div className="flex min-w-0 flex-1 items-start gap-3 px-2 py-3">{content}</div>
                    )}
                    {isUnread && (
                      <IconButton
                        label="Als gelesen markieren"
                        className="size-9 shrink-0"
                        onClick={() => markOne.mutate(notification.id)}
                      >
                        <span className="size-2.5 rounded-full bg-brand" aria-hidden />
                      </IconButton>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
          <Badge tone={unread > 0 ? "brand" : "neutral"}>
            {unread > 0 ? `${unread} ungelesen` : "alles gelesen"}
          </Badge>
          Die Liste wird jede Minute aktualisiert.
        </div>
      </div>
    </div>
  );
}

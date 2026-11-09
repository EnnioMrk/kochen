import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicUser } from "@kochen/contracts";
import { Check, Copy, QrCode, RefreshCw, UserPlus, Users, X } from "lucide-react";
import { ApiError, api, qk } from "../lib/api";
import { useMe } from "../lib/session";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Skeleton,
  useToast,
} from "../components/ui";
import { formatDate } from "../lib/utils";

type RequestRow = {
  id: string;
  createdAt: string;
  fromId: string;
  fromName: string;
  fromDeleted: string | null;
  toId: string;
  toName: string;
  status: "pending" | "accepted" | "denied";
};

type QrOptions = {
  width?: number;
  margin?: number;
  color?: { dark?: string; light?: string };
};
type QrModule = { toDataURL?: (text: string, options?: QrOptions) => Promise<string> };

function inviteError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "rate_limited") return "Zu viele Anfragen. Bitte warte einen Moment.";
    if (error.code === "unauthenticated" || error.code === "not_member") return "Bitte melde dich an.";
    return error.message || "Die Einladung konnte nicht erstellt werden.";
  }
  return "Die Einladung konnte nicht erstellt werden.";
}

export function FriendsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useMe();

  const friendsQuery = useQuery({
    queryKey: qk.friends,
    queryFn: () => api<PublicUser[]>("/api/friends"),
  });
  const requestsQuery = useQuery({
    queryKey: qk.friendRequests,
    queryFn: () => api<RequestRow[]>("/api/friends/requests"),
  });

  const [invite, setInvite] = useState<{ url: string; expiresAt: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteErrorText, setInviteErrorText] = useState<string | null>(null);

  const [removing, setRemoving] = useState<PublicUser | null>(null);

  const respond = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "accept" | "deny" }) =>
      api(`/api/friends/requests/${id}/${action}`, { method: "POST" }),
    onSuccess: (_data, variables) => {
      toast.push(variables.action === "accept" ? "Freundschaft bestätigt." : "Anfrage abgelehnt.", "success");
      void queryClient.invalidateQueries({ queryKey: qk.friends });
      void queryClient.invalidateQueries({ queryKey: qk.friendRequests });
      void queryClient.invalidateQueries({ queryKey: qk.me });
    },
    onError: () => toast.push("Die Anfrage konnte nicht bearbeitet werden.", "error"),
  });

  const removeFriend = useMutation({
    mutationFn: (id: string) => api(`/api/friends/${id}`, { method: "DELETE" }),
    onSuccess: (_data, id) => {
      toast.push("Freund entfernt.", "info");
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: qk.friends });
      void queryClient.invalidateQueries({ queryKey: qk.friendRequests });
      void queryClient.invalidateQueries({ queryKey: qk.me });
      void queryClient.invalidateQueries({ queryKey: qk.profile(id) });
    },
    onError: () => toast.push("Der Freund konnte nicht entfernt werden.", "error"),
  });

  const createInvite = async () => {
    setInviteBusy(true);
    setInviteErrorText(null);
    try {
      const result = await api<{ url: string; expiresAt: string }>("/api/friends/invites", { method: "POST" });
      setInvite(result);
    } catch (error) {
      setInviteErrorText(inviteError(error));
    } finally {
      setInviteBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!invite?.url) {
      setQr(null);
      return;
    }
    setQrFailed(false);
    void (async () => {
      try {
        // qrcode ships without type declarations.
        const module = (await import("qrcode")) as { default?: QrModule } & QrModule;
        const generator = module.default?.toDataURL ?? module.toDataURL;
        if (!generator) throw new Error("qr_missing");
        const dataUrl = await generator(invite.url, {
          width: 220,
          margin: 1,
          color: { dark: "#211c16", light: "#ffffff" },
        });
        if (!cancelled) setQr(dataUrl);
      } catch {
        if (!cancelled) {
          setQr(null);
          setQrFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invite?.url]);

  const copy = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      toast.push("Link kopiert.", "success");
    } catch {
      toast.push("Kopieren nicht möglich. Markiere den Link und kopiere ihn.", "error");
    }
  };

  const incoming = (requestsQuery.data ?? []).filter(
    (request) => request.status === "pending" && (me.data ? request.fromId !== me.data.id : false),
  );

  const friendListVisible = me.data?.friendListVisible ?? true;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Freunde"
        eyebrow="Nur mit Einladung"
        subtitle="Freundschaften entstehen über einen Einladungslink. Beide Seiten bestätigen."
      />

      <div className="space-y-4">
        {!friendListVisible && (
          <Card className="border-gold/40 bg-gold/5 p-4">
            <p className="text-sm leading-relaxed text-ink-soft">
              Deine Freundesliste ist ausgeblendet. Andere sehen deine Kontakte nicht.{" "}
              <Link to="/einstellungen" className="font-medium text-brand underline-offset-4 hover:underline">
                In den Einstellungen ändern
              </Link>
            </p>
          </Card>
        )}

        {incoming.length > 0 && (
          <Card className="p-4 sm:p-5">
            <h2 className="flex items-center gap-2 text-lg">
              <UserPlus className="size-5 text-brand" />
              Offene Anfragen
            </h2>
            <ul className="mt-3 divide-y divide-line/60">
              {incoming.map((request) => (
                <li key={request.id} className="flex flex-wrap items-center gap-3 py-3">
                  <Avatar name={request.fromName} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {request.fromDeleted ? "gelöschtes Konto" : request.fromName}
                    </span>
                    <span className="block text-xs text-ink-soft">{formatDate(request.createdAt)}</span>
                  </span>
                  <span className="flex gap-2">
                    <Button
                      size="sm"
                      loading={respond.isPending && respond.variables?.id === request.id}
                      onClick={() => respond.mutate({ id: request.id, action: "accept" })}
                    >
                      <Check className="size-4" />
                      Annehmen
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={respond.isPending}
                      onClick={() => respond.mutate({ id: request.id, action: "deny" })}
                    >
                      <X className="size-4" />
                      Ablehnen
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg">
              <QrCode className="size-5 text-sage" />
              Einladen
            </h2>
            {invite && (
              <Button variant="secondary" size="sm" loading={inviteBusy} onClick={() => void createInvite()}>
                <RefreshCw className="size-4" />
                Neuen Link erstellen
              </Button>
            )}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            Erstelle einen Link oder QR-Code. Die andere Person öffnet ihn und sendet eine Anfrage. Du bestätigst sie
            danach hier.
          </p>

          {!invite && (
            <Button className="mt-3" loading={inviteBusy} onClick={() => void createInvite()}>
              <UserPlus className="size-4" />
              Einladungslink erstellen
            </Button>
          )}

          {inviteErrorText && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {inviteErrorText}
            </p>
          )}

          {invite && (
            <div className="mt-4 rounded-xl border border-line/70 bg-paper/60 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                {qr ? (
                  <img
                    src={qr}
                    alt="QR-Code für den Einladungslink"
                    width={160}
                    height={160}
                    className="size-40 shrink-0 self-center rounded-lg border border-line bg-white p-1 sm:self-start"
                  />
                ) : (
                  <div className="flex size-40 shrink-0 items-center justify-center self-center rounded-lg border border-dashed border-line p-3 text-center text-xs leading-relaxed text-ink-soft sm:self-start">
                    {qrFailed ? "QR-Code nicht verfügbar. Der Link funktioniert trotzdem." : "QR-Code wird erstellt …"}
                  </div>
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-soft">Einladungslink</p>
                  <Input
                    readOnly
                    value={invite.url}
                    aria-label="Einladungslink"
                    onFocus={(event) => event.target.select()}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => void copy()}>
                      <Copy className="size-4" />
                      Link kopieren
                    </Button>
                    <Badge tone="gold">gilt 7 Tage</Badge>
                    <Badge tone="neutral">nur einmal</Badge>
                  </div>
                  <p className="text-xs text-ink-soft">Gültig bis {formatDate(invite.expiresAt)}.</p>
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg">
              <Users className="size-5 text-sage" />
              Deine Freunde
            </h2>
            {friendsQuery.data && (
              <Badge tone="neutral">
                {friendsQuery.data.length} {friendsQuery.data.length === 1 ? "Freund" : "Freunde"}
              </Badge>
            )}
          </div>

          {friendsQuery.isPending && (
            <div className="mt-3 space-y-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          )}

          {friendsQuery.isError && (
            <p className="mt-3 text-sm text-danger">Die Freundesliste konnte nicht geladen werden.</p>
          )}

          {friendsQuery.data && friendsQuery.data.length === 0 && (
            <div className="mt-3">
              <EmptyState
                title="Noch keine Freunde"
                body="Lade jemanden mit einem Link oder QR-Code ein. Erst nach der Bestätigung seht ihr eure Rezepte."
              />
            </div>
          )}

          {friendsQuery.data && friendsQuery.data.length > 0 && (
            <ul className="mt-3 divide-y divide-line/60">
              {friendsQuery.data.map((friend) => (
                <li key={friend.id} className="flex items-center gap-3 py-2.5">
                  <Avatar name={friend.name} url={friend.avatarUrl} size={38} />
                  <Link
                    to={`/profil/${friend.id}`}
                    className="min-w-0 flex-1 truncate text-sm font-medium text-ink underline-offset-4 hover:underline"
                  >
                    {friend.deletedAt ? "gelöschtes Konto" : friend.name}
                  </Link>
                  <Button variant="ghost" size="sm" className="text-danger" onClick={() => setRemoving(friend)}>
                    <X className="size-4" />
                    Entfernen
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Modal
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title="Freund entfernen?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Abbrechen
            </Button>
            <Button
              variant="danger"
              loading={removeFriend.isPending}
              onClick={() => removing && removeFriend.mutate(removing.id)}
            >
              Freund entfernen
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-soft">
          {removing ? `„${removing.deletedAt ? "gelöschtes Konto" : removing.name}“ wird aus deiner Freundesliste entfernt.` : ""}
          {" "}Ihr könnt euch danach nur über einen neuen Einladungslink wieder verbinden.
        </p>
      </Modal>
    </div>
  );
}

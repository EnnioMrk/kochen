import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, UserPlus, Users } from "lucide-react";
import { ApiError, api } from "../lib/api";
import { Button, Card, EmptyState, PageHeader } from "../components/ui";

function inviteError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "validation_failed" && error.detail === "self_invite") {
      return "Das ist dein eigener Einladungslink. Du kannst dich nicht selbst hinzufügen.";
    }
    if (error.code === "not_found") {
      return "Der Link ist ungültig, abgelaufen oder wurde schon benutzt.";
    }
    if (error.code === "rate_limited") return "Zu viele Anfragen. Bitte warte einen Moment.";
    if (error.code === "unauthenticated" || error.code === "not_member") {
      return "Bitte melde dich an und öffne den Link erneut.";
    }
    return error.message || "Die Anfrage konnte nicht gesendet werden.";
  }
  return "Die Anfrage konnte nicht gesendet werden.";
}

export function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<"pending" | "accepted" | "denied" | null>(null);

  const send = async () => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api<{ status: "pending" | "accepted" | "denied" }>("/api/friends/request", {
        method: "POST",
        body: { token },
      });
      setResult(response.status);
    } catch (caught) {
      setError(inviteError(caught));
    } finally {
      setBusy(false);
    }
  };

  if (!token || token.length < 10) {
    return (
      <div className="mx-auto max-w-lg">
        <PageHeader title="Einladung" />
        <EmptyState
          title="Link unvollständig"
          body="Der Einladungslink enthält keinen gültigen Code. Bitte öffne den vollständigen Link."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Freundschaftsanfrage"
        subtitle="Über diesen Link verbindet ihr eure Konten. Beide Seiten bestätigen."
      />

      <Card className="p-5">
        {result ? (
          <div className="text-center">
            <CheckCircle2 className="mx-auto size-10 text-sage" />
            <h2 className="mt-3 text-xl">
              {result === "accepted" ? "Ihr seid schon befreundet" : "Anfrage gesendet"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              {result === "accepted"
                ? "Die Freundschaft besteht bereits. Du kannst direkt Rezepte teilen."
                : "Warte auf die Bestätigung der anderen Person. Du bekommst eine Benachrichtigung, sobald sie annimmt."}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button onClick={() => navigate("/freunde")}>
                <Users className="size-4" />
                Zu den Freunden
              </Button>
              <Button variant="secondary" onClick={() => navigate("/")}>
                Zu den Rezepten
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                <UserPlus className="size-5" />
              </span>
              <div>
                <h2 className="text-lg">Anfrage senden</h2>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                  Wenn du die Anfrage sendest, sieht die andere Person deinen Namen. Sie entscheidet selbst, ob sie
                  annimmt.
                </p>
              </div>
            </div>

            {error && (
              <p role="alert" className="mt-4 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
                {error}
              </p>
            )}

            <Button className="mt-4 w-full" size="lg" loading={busy} onClick={() => void send()}>
              <UserPlus className="size-4" />
              Freundschaftsanfrage senden
            </Button>

            <p className="mt-3 text-center text-xs text-ink-soft">
              Du musst angemeldet sein. Der Link gilt 7 Tage und nur einmal.{" "}
              <Link to="/freunde" className="underline-offset-4 hover:underline">
                Zu den Freunden
              </Link>
            </p>
          </>
        )}
      </Card>
    </div>
  );
}

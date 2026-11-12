import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlatformCredential, PlatformName, PlatformTestStatus } from "@kochen/contracts";
import { KeyRound } from "lucide-react";
import { api, qk } from "../lib/api";
import { useMe } from "../lib/session";
import { cn, errorText, formatDateTime } from "../lib/utils";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
  useToast,
} from "../components/ui";

const PLATFORMS: Array<{ id: PlatformName; name: string; hint: string }> = [
  {
    id: "youtube",
    name: "YouTube",
    hint: "Für Videos, die der Server ohne Anmeldung nicht laden kann.",
  },
  {
    id: "instagram",
    name: "Instagram",
    hint: "Für Reels und Beiträge, die nur mit Konto sichtbar sind.",
  },
  {
    id: "tiktok",
    name: "TikTok",
    hint: "Für Videos, die der Server ohne Anmeldung nicht laden kann.",
  },
];

function PlatformCard({
  platform,
  name,
  hint,
  credential,
}: {
  platform: PlatformName;
  name: string;
  hint: string;
  credential: PlatformCredential;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState(credential.username ?? "");
  const [password, setPassword] = useState("");
  const [cookies, setCookies] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [testJobId, setTestJobId] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.platformCredentials });

  const save = useMutation({
    mutationFn: () =>
      api<PlatformCredential>(`/api/admin/platforms/${platform}`, {
        method: "PUT",
        body: {
          username,
          ...(password ? { password } : {}),
          ...(cookies ? { cookies } : {}),
        },
      }),
    onSuccess: () => {
      setPassword("");
      setCookies("");
      setTestJobId(null);
      toast.push(`Zugang für ${name} gespeichert.`, "success");
      void invalidate();
    },
    onError: (error) => toast.push(errorText(error), "error"),
  });

  const remove = useMutation({
    mutationFn: () => api(`/api/admin/platforms/${platform}`, { method: "DELETE" }),
    onSuccess: () => {
      setConfirmDelete(false);
      setUsername("");
      setPassword("");
      setCookies("");
      setTestJobId(null);
      toast.push(`Zugang für ${name} entfernt.`, "info");
      void invalidate();
    },
    onError: (error) => toast.push(errorText(error), "error"),
  });

  const startTest = useMutation({
    mutationFn: () =>
      api<{ jobId: string }>(`/api/admin/platforms/${platform}/test`, { method: "POST" }),
    onSuccess: (data) => setTestJobId(data.jobId),
    onError: (error) => toast.push(errorText(error), "error"),
  });

  const test = useQuery({
    queryKey: ["admin", "platform-test", testJobId],
    queryFn: () => api<PlatformTestStatus>(`/api/admin/tests/${testJobId}`),
    enabled: Boolean(testJobId),
    refetchInterval: (query) => (query.state.data?.running ? 1500 : false),
  });

  const stored = credential.hasPassword || credential.hasCookies;
  const testing = startTest.isPending || Boolean(test.data?.running) || test.isFetching;
  const result = test.data?.running ? null : test.data?.result ?? null;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xl">
          <KeyRound className="size-5 text-ink-soft" />
          {name}
        </h2>
        <Badge tone={stored ? "sage" : "neutral"}>
          {stored ? "Zugang hinterlegt" : "Nicht hinterlegt"}
        </Badge>
      </div>
      <p className="text-sm leading-relaxed text-ink-soft">{hint}</p>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Benutzername oder E-Mail">
          <Input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="off"
            placeholder="name@example.com"
          />
        </Field>

        <Field
          label="Passwort"
          hint={
            credential.hasPassword
              ? "Ein Passwort ist gespeichert. Leer lassen, um es zu behalten."
              : "Optional. Wird verschlüsselt gespeichert."
          }
        >
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="••••••••"
          />
        </Field>

        <Field
          label="Cookies (cookies.txt)"
          hint={
            credential.hasCookies
              ? "Cookies sind gespeichert. Leer lassen, um sie zu behalten."
              : "Netscape-Format. Aus dem Browser exportieren und hier einfügen."
          }
        >
          <Textarea
            value={cookies}
            onChange={(event) => setCookies(event.target.value)}
            className="min-h-28 font-mono text-xs"
            placeholder="# Netscape HTTP Cookie File"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={save.isPending}>
            Speichern
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={testing}
            disabled={!stored}
            onClick={() => startTest.mutate()}
          >
            Verbindung testen
          </Button>
          {stored &&
            (confirmDelete ? (
              <>
                <Button
                  // Inside the form, so the type must be explicit.
                  type="button"
                  variant="danger"
                  loading={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  Wirklich entfernen
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirmDelete(false)}
                >
                  Abbrechen
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
              >
                Zugang entfernen
              </Button>
            ))}
        </div>
      </form>

      {testing && (
        <p className="flex items-center gap-2 text-sm text-ink-soft" role="status">
          Der Test liest ein öffentliches Beispiel. Das dauert ein paar Sekunden.
        </p>
      )}

      {result && (
        <div
          role="status"
          className={cn(
            "rounded-xl px-3 py-2 text-sm",
            result.ok ? "bg-sage-soft text-sage-text" : "bg-danger/[0.07] text-ink",
          )}
        >
          <p className="font-medium">
            {result.ok ? "Der Zugang funktioniert." : "Der Test ist fehlgeschlagen."}
          </p>
          <p className="mt-0.5">{result.message}</p>
          {result.title && (
            <p className="mt-0.5 text-xs opacity-80">Gelesen: „{result.title}“</p>
          )}
        </div>
      )}

      {test.isError && (
        <p className="text-sm text-danger" role="alert">
          {errorText(test.error)}
        </p>
      )}

      {stored && (
        <p className="text-xs text-ink-soft">
          Passwort: {credential.hasPassword ? "gesetzt" : "fehlt"} · Cookies:{" "}
          {credential.hasCookies ? "gesetzt" : "fehlen"}
          {credential.updatedByName
            ? ` · zuletzt von ${credential.updatedByName} am ${formatDateTime(credential.updatedAt)}`
            : ""}
        </p>
      )}
    </Card>
  );
}

export function AdminPage() {
  const me = useMe();
  const credentials = useQuery({
    queryKey: qk.platformCredentials,
    queryFn: () => api<PlatformCredential[]>("/api/admin/platforms"),
    enabled: me.data?.role === "admin" || me.data?.role === "owner",
  });

  const admin = me.data?.role === "admin" || me.data?.role === "owner";
  if (me.isPending) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-[var(--radius-card)]" />
      </div>
    );
  }

  if (!admin) {
    return (
      <EmptyState
        title="Kein Zugang"
        body="Diese Seite gehört dem Betreiber."
        icon={<KeyRound className="size-8" />}
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Zugänge"
        subtitle="Anmeldedaten für Plattformen, die den Server sonst blockieren."
      />

      <div className="space-y-4">
        <Card className="border-gold/40 bg-gold/5 p-4">
          <p className="text-sm leading-relaxed text-ink-soft">
            Der Video-Import versucht es zuerst ohne Anmeldung. Instagram und
            TikTok liest er über die öffentliche Einbettseite, also den Text
            unter dem Beitrag. Cookies sind nur der Zusatz, wenn eine Plattform
            den Server blockt. Die Daten bleiben auf dem Server: Passwort und
            Cookies werden verschlüsselt gespeichert und nie wieder angezeigt.
          </p>

          <details className="mt-3 rounded-xl border border-line bg-white/70 px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-ink">
              Anleitung: Cookies exportieren
            </summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-ink-soft">
              <li>
                Installiere im Browser die Erweiterung <strong>„Get cookies.txt
                LOCALLY“</strong>. Sie gibt es für Chrome, Edge und Firefox.
                Safari hat keine passende Erweiterung; nimm Chrome oder Firefox.
              </li>
              <li>
                Melde dich auf der Plattform an, zum Beispiel auf youtube.com.
                Nutze dafür ein eigenes Konto, nicht dein Hauptkonto.
              </li>
              <li>
                Öffne die Erweiterung auf genau dieser Seite und exportiere die
                Cookies. Die Datei heißt meist <code>cookies.txt</code>.
              </li>
              <li>
                Öffne die Datei in einem Texteditor. Kopiere den ganzen Inhalt
                und füge ihn oben in das Feld <strong>Cookies</strong> ein.
                Speichere danach.
              </li>
              <li>
                Tippe auf <strong>Verbindung testen</strong>. Der Test liest ein
                öffentliches Beispiel. Erst wenn er grün ist, greift der Import.
              </li>
            </ol>
            <p className="mt-2 text-xs leading-relaxed text-ink-soft">
              Die Datei beginnt mit <code># Netscape HTTP Cookie File</code>.
              Behandle sie wie ein Passwort: nicht teilen und nicht in ein
              Repository legen. Cookies laufen ab. Ist der Test rot, exportiere
              neu. Ein Passwort allein genügt bei YouTube und TikTok selten; die
              Cookies sind der Teil, der wirklich zählt.
            </p>
          </details>
        </Card>

        {credentials.isPending && (
          <div className="space-y-4">
            {PLATFORMS.map((platform) => (
              <Skeleton key={platform.id} className="h-72 w-full rounded-[var(--radius-card)]" />
            ))}
          </div>
        )}

        {credentials.isError && (
          <Card className="p-4">
            <p className="text-sm text-ink">Die Zugänge konnten nicht geladen werden.</p>
            <p className="mt-1 text-sm text-ink-soft">{errorText(credentials.error)}</p>
            <Button
              variant="secondary"
              className="mt-3"
              onClick={() => void credentials.refetch()}
            >
              Erneut versuchen
            </Button>
          </Card>
        )}

        {credentials.data?.map((credential) => {
          const info = PLATFORMS.find((entry) => entry.id === credential.platform);
          if (!info) return null;
          return (
            <PlatformCard
              key={credential.platform}
              platform={credential.platform}
              name={info.name}
              hint={info.hint}
              credential={credential}
            />
          );
        })}
      </div>
    </div>
  );
}

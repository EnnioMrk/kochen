import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ImportJob, JobState, RecipeInput } from "@kochen/contracts";
import { AlertTriangle, Check, Clock, ImagePlus, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { api, qk } from "../lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  Spinner,
  useToast,
} from "../components/ui";
import { DraftForm } from "../components/capture/DraftForm";
import {
  formatMb,
  importErrorMessage,
  startImport,
  unreadableFileMessage,
  uploadErrorMessage,
  uploadFiles,
} from "../components/capture/upload";
import { PhotoPreviewTile } from "./CapturePage";
import { cn, formatDateTime } from "../lib/utils";

const ACTIVE_STATES = new Set<JobState>(["queued", "fetching", "normalizing", "understanding"]);
const STEP_ORDER: JobState[] = ["queued", "fetching", "normalizing", "understanding"];

/** A screenshot of the same page can still rescue these failures. */
const SCREENSHOT_HELPS = new Set(["extraction_failed", "source_blocked", "invalid_source", "source_unavailable"]);

const STEP_LABELS: Record<string, string> = {
  queued: "In der Warteschlange",
  fetching: "Quelle wird geladen",
  normalizing: "Dateien werden vorbereitet",
  understanding: "Rezept wird erkannt",
  needs_review: "Prüfen",
  done: "Fertig",
  failed: "Fehlgeschlagen",
};

function failedMessage(job: ImportJob): string {
  switch (job.errorCode) {
    case "extraction_failed":
      return "Das Rezept konnte nicht erkannt werden. Versuche es mit einem Foto oder einem Screenshot.";
    case "limit_exceeded":
      return "Die Grenze wurde überschritten. Bitte prüfe Anzahl, Größe und Länge der Dateien.";
    case "ai_unavailable":
      return "Die KI ist gerade nicht erreichbar. Bitte versuche es später erneut.";
    case "invalid_source":
      return "Die Quelle konnte nicht gelesen werden. Bitte prüfe die Datei oder den Link.";
    case "source_unavailable":
      return "Die Quelle ist nicht erreichbar. Bitte prüfe den Link oder versuche es später erneut.";
    case "source_blocked":
      return "Die Seite lässt keinen Abruf vom Server zu.";
    case "media_unavailable":
      return "Der Medienspeicher ist nicht erreichbar oder die Datei fehlt dort. Bitte melde das dem Betreiber.";
    case "tool_missing":
      return "Für diesen Import fehlt ein Werkzeug auf dem Server. Bitte melde das dem Betreiber.";
    case "cancelled":
      return "Der Import wurde abgebrochen.";
    default:
      return "Der Import ist fehlgeschlagen.";
  }
}

function ScreenshotPanel({ reason, onStarted }: { reason: string; onStarted: (id: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const blocked = file ? unreadableFileMessage(file) : null;

  const send = async () => {
    if (!file || busy) return;
    const problem = unreadableFileMessage(file);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    setPercent(0);
    try {
      const keys = await uploadFiles([file], "photo", (_index, value) => setPercent(value));
      const id = await startImport({ kind: "photo", keys });
      onStarted(id);
    } catch (caught) {
      // Stay on the page and show the real reason.
      setError(uploadErrorMessage(caught, "upload"));
      setBusy(false);
    }
  };

  return (
    <Card className="border-gold/40 bg-gold/5 p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-lg">
        <ImagePlus className="size-5 text-gold" />
        Screenshot nachreichen
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-soft">
        {reason} Lade einen Screenshot des Rezepts hoch. Daraus startet ein neuer
        Import.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="tap flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-white/70 px-4 py-3 text-sm font-medium text-ink transition hover:border-brand/50">
          <ImagePlus className="size-4 text-brand" />
          {file ? file.name : "Screenshot auswählen"}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const next = event.target.files?.[0] ?? null;
              setFile(next);
              setError(next ? unreadableFileMessage(next) : null);
              event.target.value = "";
            }}
          />
        </label>
        <Button loading={busy} disabled={!file || Boolean(blocked)} onClick={() => void send()}>
          Hochladen und neu starten
        </Button>
      </div>
      {file && (
        <div className="mt-3 flex items-center gap-3">
          <PhotoPreviewTile file={file} className="size-16 shrink-0 rounded-lg border border-line" />
          <div className="min-w-0">
            <p className="truncate text-sm text-ink">{file.name}</p>
            <p className="text-xs text-ink-soft">{formatMb(file.size)}</p>
          </div>
        </div>
      )}
      {busy && (
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-ink/10">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1 text-xs text-ink-soft">{percent} % hochgeladen</p>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}

export function ImportReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const jobQuery = useQuery({
    queryKey: qk.importJob(id ?? ""),
    queryFn: () => api<ImportJob>(`/api/imports/${id}`),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state && ACTIVE_STATES.has(state) ? 3000 : false;
    },
  });

  const job = jobQuery.data;

  const confirm = async (input: RecipeInput) => {
    if (!id) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      const result = await api<{ recipeId: string }>(`/api/imports/${id}/confirm`, {
        method: "POST",
        body: input,
      });
      toast.push("Rezept gespeichert.", "success");
      await queryClient.invalidateQueries({ queryKey: qk.recipes("mine") });
      navigate(`/rezept/${result.recipeId}`);
    } catch (caught) {
      setConfirmError(importErrorMessage(caught));
    } finally {
      setConfirming(false);
    }
  };

  const cancel = async () => {
    if (!id) return;
    setCancelling(true);
    try {
      await api(`/api/imports/${id}`, { method: "DELETE" });
      toast.push("Der Import wurde abgebrochen.", "info");
      await queryClient.invalidateQueries({ queryKey: qk.importJob(id) });
      navigate("/erfassen");
    } catch (caught) {
      toast.push(importErrorMessage(caught), "error");
      setCancelling(false);
    }
  };

  if (!id || jobQuery.isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Import" />
        <EmptyState
          title="Import nicht gefunden"
          body="Der Import gehört nicht zu deinem Konto oder wurde entfernt."
          action={
            <Button variant="secondary" onClick={() => navigate("/erfassen")}>
              Neu erfassen
            </Button>
          }
        />
      </div>
    );
  }

  if (jobQuery.isPending || !job) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Entwurf prüfen" />
        <Card className="space-y-3 p-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </Card>
      </div>
    );
  }

  const active = ACTIVE_STATES.has(job.state);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Entwurf prüfen"
        subtitle="Prüfe die Angaben. Erst mit „Rezept speichern“ wird das Rezept angelegt."
        titleAddon={
          <Badge tone={job.state === "failed" ? "danger" : job.state === "needs_review" ? "gold" : "brand"}>
            {STEP_LABELS[job.state] ?? "In Arbeit"}
          </Badge>
        }
      />

      {active && (
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin text-brand" />
            <p className="text-sm font-medium text-ink">{STEP_LABELS[job.state] ?? "Wird verarbeitet"}</p>
          </div>
          <div className="mt-4 space-y-2">
            {STEP_ORDER.map((step, index) => {
              const currentIndex = STEP_ORDER.indexOf(job.state);
              const done = currentIndex > index;
              const current = currentIndex === index;
              return (
                <div key={step} className="flex items-center gap-2 text-sm">
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border",
                      done
                        ? "border-sage bg-sage-soft text-sage-text"
                        : current
                          ? "border-brand text-brand"
                          : "border-line text-ink-soft/50",
                    )}
                  >
                    {done ? (
                      <Check className="size-3.5" />
                    ) : current ? (
                      <Spinner className="size-3" />
                    ) : (
                      <span className="size-1.5 rounded-full bg-current" />
                    )}
                  </span>
                  <span className={done || current ? "text-ink" : "text-ink-soft/70"}>{STEP_LABELS[step]}</span>
                </div>
              );
            })}
          </div>
          {job.state === "queued" && (
            <p className="mt-4 flex items-center gap-2 text-sm text-ink-soft">
              <Clock className="size-4" />
              {job.position !== null && job.position !== undefined
                ? `Wartet an Position ${job.position + 1}`
                : "Wartet auf einen freien Platz"}
            </p>
          )}
          <p className="mt-3 text-xs text-ink-soft">
            Die Seite aktualisiert sich automatisch. Das dauert meist unter einer Minute.
          </p>
        </Card>
      )}

      {job.state === "needs_review" && job.draft && (
        <div className="space-y-4">
          {job.draftMeta?.asksForScreenshot && (
            <ScreenshotPanel reason={failedMessage(job)} onStarted={(newId) => navigate(`/import/${newId}`)} />
          )}
          <DraftForm
            draft={job.draft}
            warnings={job.draftMeta?.warnings ?? []}
            servingsEstimated={job.draftMeta?.servingsEstimated ?? false}
            submitting={confirming}
            error={confirmError}
            onSubmit={(input) => void confirm(input)}
          />
          {(job.draft.rawText || job.draft.transcript) && (
            <Card className="p-4">
              {job.draft.rawText && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-ink">
                    Erkannten Text anzeigen
                  </summary>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-paper-2/70 p-3 text-xs leading-relaxed text-ink-soft">
                    {job.draft.rawText}
                  </pre>
                </details>
              )}
              {job.draft.transcript && (
                <details className={job.draft.rawText ? "mt-3" : undefined}>
                  <summary className="cursor-pointer text-sm font-medium text-ink">Transkript anzeigen</summary>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-paper-2/70 p-3 text-xs leading-relaxed text-ink-soft">
                    {job.draft.transcript}
                  </pre>
                </details>
              )}
            </Card>
          )}
        </div>
      )}

      {job.state === "needs_review" && !job.draft && (
        <EmptyState
          title="Der Entwurf fehlt"
          body="Der Import hat keinen Entwurf geliefert. Starte den Import neu."
          action={
            <Button variant="secondary" onClick={() => navigate("/erfassen")}>
              Neu erfassen
            </Button>
          }
        />
      )}

      {job.state === "failed" && (
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
            <div>
              <h2 className="text-lg">{job.errorCode === "cancelled" ? "Abgebrochen" : "Import fehlgeschlagen"}</h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                {/* The worker names the real cause, for example an unreadable
                    HEIC photo or a missing media store. */}
                {job.errorMessage?.trim() || failedMessage(job)}
              </p>
              {job.errorCode && (
                <p className="mt-2 text-xs text-ink-soft/80">Fehlercode: {job.errorCode}</p>
              )}
              <p className="mt-2 text-xs text-ink-soft">Zuletzt aktualisiert: {formatDateTime(job.updatedAt)}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => navigate("/erfassen")}>
              <RefreshCw className="size-4" />
              Erneut versuchen
            </Button>
            <Button variant="secondary" loading={cancelling} onClick={() => void cancel()}>
              <Trash2 className="size-4" />
              Import löschen
            </Button>
          </div>
          <p className="mt-3 text-xs text-ink-soft">
            Beim erneuten Versuch startest du den Import neu. Der bisherige Entwurf bleibt nicht erhalten.
          </p>
        </Card>
      )}

      {job.state === "failed" && SCREENSHOT_HELPS.has(job.errorCode ?? "") && (
        <div className="mt-4">
          <ScreenshotPanel reason={failedMessage(job)} onStarted={(newId) => navigate(`/import/${newId}`)} />
        </div>
      )}

      {job.state === "done" && (
        <EmptyState
          title="Dieser Import ist fertig"
          body="Das Rezept wurde gespeichert."
          action={
            <Button variant="secondary" onClick={() => navigate("/")}>
              Zu meinen Rezepten
            </Button>
          }
        />
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
        <Link
          to="/erfassen"
          className="tap-target inline-flex min-h-11 items-center underline-offset-4 hover:underline"
        >
          Anderen Import starten
        </Link>
        {job.state === "needs_review" && (
          <>
            <span aria-hidden>·</span>
            <button
              type="button"
              className="tap-target inline-flex min-h-11 items-center underline-offset-4 hover:underline disabled:opacity-50"
              disabled={cancelling}
              onClick={() => void cancel()}
            >
              Import verwerfen
            </button>
          </>
        )}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_LIMITS, type Limits } from "@kochen/contracts";
import {
  AlertTriangle,
  Camera,
  Check,
  FileText,
  ImagePlus,
  Link2,
  Loader2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { ApiError, api, qk } from "../lib/api";
import {
  Badge,
  Button,
  Card,
  Field,
  IconButton,
  Input,
  PageHeader,
  Segmented,
  Textarea,
} from "../components/ui";
import {
  checkFiles,
  formatMinutes,
  formatMb,
  importErrorMessage,
  readVideoDuration,
  startImport,
  uploadFiles,
} from "../components/capture/upload";

type Kind = "photo" | "link" | "video" | "text" | "pdf";

const TABS: Array<{ value: Kind; label: string }> = [
  { value: "photo", label: "Fotos" },
  { value: "link", label: "Link" },
  { value: "video", label: "Video" },
  { value: "text", label: "Text" },
  { value: "pdf", label: "PDF" },
];

const PREVIEW_LIMIT = 12;

function validateUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Bitte gib einen Link ein.";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Der Link ist keine gültige Adresse.";
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Der Link muss mit http:// oder https:// beginnen.";
  }
  return null;
}

function ProgressRow({ name, percent }: { name: string; percent: number }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-xs text-ink-soft">
        <span className="min-w-0 truncate">{name}</span>
        <span className="tabular-nums">{percent} %</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-ink/10">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function LimitsCard({ limits, failed }: { limits: Limits; failed: boolean }) {
  const rows = [
    `${limits.maxPhotos} Fotos`,
    `${formatMb(limits.maxPhotoMb * 1024 * 1024)} je Foto`,
    `${formatMb(limits.maxTotalMb * 1024 * 1024)} gesamt`,
    `${limits.maxVideoMinutes} Min. Video`,
    `${limits.maxAudioMinutes} Min. Audio`,
    `${limits.maxPdfPages} PDF-Seiten`,
  ];
  return (
    <Card className="p-4">
      <p className="text-sm font-medium text-ink">Grenzen je Import</p>
      <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {rows.map((row) => (
          <li key={row} className="flex items-center gap-2 text-sm text-ink-soft">
            <Check className="size-4 shrink-0 text-sage" />
            {row}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-ink-soft">
        Dateien werden nie gekürzt. Ist eine Grenze überschritten, wird der Import abgelehnt.
      </p>
      {failed && (
        <p className="mt-2 text-xs text-danger">
          Die Grenzen konnten nicht geladen werden. Es gelten die Standardwerte.
        </p>
      )}
    </Card>
  );
}

export function CapturePage() {
  const navigate = useNavigate();
  const [kind, setKind] = useState<Kind>("photo");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [uploadNames, setUploadNames] = useState<string[]>([]);
  const [progress, setProgress] = useState<number[]>([]);

  const limitsQuery = useQuery({
    queryKey: qk.limits,
    queryFn: () => api<Limits>("/api/imports/limits"),
    staleTime: 5 * 60_000,
  });
  const limits = limitsQuery.data ?? DEFAULT_LIMITS;

  /* ------------------------------------------------------------- photos */
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const previews = useMemo(
    () => photos.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [photos],
  );
  useEffect(() => () => previews.forEach((item) => URL.revokeObjectURL(item.url)), [previews]);

  const addPhotos = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const next = [...photos, ...Array.from(list)];
    setPhotos(next);
    setPhotoError(checkFiles(next, "photo", limits));
    setError(null);
  };

  /* --------------------------------------------------------------- link */
  const [url, setUrl] = useState("");
  const urlError = url.trim() ? validateUrl(url) : null;

  /* -------------------------------------------------------------- video */
  const [videoUrl, setVideoUrl] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const videoUrlError = videoUrl.trim() ? validateUrl(videoUrl) : null;

  const chooseVideo = (file: File | null) => {
    setVideoFile(file);
    setVideoUrl("");
    setVideoError(file ? checkFiles([file], "video", limits) : null);
    setError(null);
  };

  /* --------------------------------------------------------------- text */
  const [text, setText] = useState("");

  /* ---------------------------------------------------------------- pdf */
  const [pdf, setPdf] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const choosePdf = (file: File | null) => {
    setPdf(file);
    setPdfError(file ? checkFiles([file], "pdf", limits) : null);
    setError(null);
  };

  /* ------------------------------------------------------------- upload */
  const run = async (options: { kind: Kind; files?: File[]; url?: string; text?: string }) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    setPhase("Import wird gestartet");
    const files = options.files ?? [];
    setUploadNames(files.map((file) => file.name));
    setProgress(files.map(() => 0));
    try {
      let keys: string[] = [];
      if (files.length > 0) {
        setPhase("Dateien werden hochgeladen");
        keys = await uploadFiles(files, options.kind, (index, percent) =>
          setProgress((current) => current.map((value, itemIndex) => (itemIndex === index ? percent : value))),
        );
        setPhase("Import wird gestartet");
      }
      const id = await startImport({
        kind: options.kind,
        keys,
        ...(options.url ? { url: options.url } : {}),
        ...(options.text ? { text: options.text } : {}),
      });
      navigate(`/import/${id}`);
    } catch (caught) {
      if (
        options.kind === "video" &&
        options.url &&
        caught instanceof ApiError &&
        caught.code === "validation_failed" &&
        caught.detail === "files_missing"
      ) {
        setError("Video-Links nimmt dieser Server noch nicht an. Bitte lade die Videodatei hoch.");
      } else {
        setError(importErrorMessage(caught));
      }
      setPhase(null);
      setBusy(false);
    }
  };

  const submitPhotos = () => {
    const message = checkFiles(photos, "photo", limits);
    if (message) {
      setPhotoError(message);
      return;
    }
    void run({ kind: "photo", files: photos });
  };

  const submitLink = () => {
    const message = validateUrl(url);
    if (message) {
      setError(message);
      return;
    }
    void run({ kind: "link", url: url.trim() });
  };

  const submitVideo = async () => {
    setVideoError(null);
    if (videoUrl.trim()) {
      const message = validateUrl(videoUrl);
      if (message) {
        setVideoError(message);
        return;
      }
      void run({ kind: "video", url: videoUrl.trim() });
      return;
    }
    if (!videoFile) {
      setVideoError("Bitte wähle eine Videodatei oder gib einen Link ein.");
      return;
    }
    const message = checkFiles([videoFile], "video", limits);
    if (message) {
      setVideoError(message);
      return;
    }
    const seconds = await readVideoDuration(videoFile);
    if (seconds !== null && seconds > limits.maxVideoMinutes * 60) {
      setVideoError(
        `Das Video ist ${formatMinutes(seconds)} lang. Erlaubt sind ${limits.maxVideoMinutes} Minuten.`,
      );
      return;
    }
    void run({ kind: "video", files: [videoFile] });
  };

  const submitText = () => {
    if (!text.trim()) {
      setError("Bitte gib einen Text ein.");
      return;
    }
    void run({ kind: "text", text });
  };

  const submitPdf = () => {
    if (!pdf) {
      setPdfError("Bitte wähle eine PDF-Datei.");
      return;
    }
    const message = checkFiles([pdf], "pdf", limits);
    if (message) {
      setPdfError(message);
      return;
    }
    void run({ kind: "pdf", files: [pdf] });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Rezept erfassen"
        eyebrow="Neu"
        subtitle="Wähle eine Quelle. Die KI macht daraus einen Entwurf, den du danach prüfst."
      />

      <div className="mb-5">
        <Segmented
          value={kind}
          options={TABS}
          onChange={(next) => {
            setKind(next);
            setError(null);
          }}
          ariaLabel="Art der Erfassung"
        />
      </div>

      <Card className="space-y-5 p-4 sm:p-6">
        {kind === "photo" && (
          <>
            <div>
              <h2 className="text-xl">Fotos importieren</h2>
              <p className="mt-1 text-sm text-ink-soft">
                Lade Fotos von Kochbuchseiten, Rezeptkarten oder handschriftlichen Notizen hoch.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="tap flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line bg-paper/60 px-4 py-8 text-center transition hover:border-brand/50">
                <ImagePlus className="size-6 text-brand" />
                <span className="text-sm font-medium text-ink">Fotos auswählen</span>
                <span className="text-xs text-ink-soft">JPG, PNG, HEIC oder GIF</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={(event) => {
                    addPhotos(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
              <label className="tap flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line bg-paper/60 px-4 py-8 text-center transition hover:border-brand/50">
                <Camera className="size-6 text-brand" />
                <span className="text-sm font-medium text-ink">Foto aufnehmen</span>
                <span className="text-xs text-ink-soft">Öffnet die Kamera am Telefon</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(event) => {
                    addPhotos(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>

            {previews.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm text-ink-soft">
                    {photos.length} {photos.length === 1 ? "Foto" : "Fotos"} ausgewählt
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPhotos([]);
                      setPhotoError(null);
                    }}
                  >
                    Auswahl entfernen
                  </Button>
                </div>
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {previews.slice(0, PREVIEW_LIMIT).map((item, index) => (
                    <li key={`${item.file.name}-${index}`} className="relative overflow-hidden rounded-lg border border-line">
                      <img src={item.url} alt="" className="aspect-square w-full object-cover" />
                      <IconButton
                        label={`${item.file.name} entfernen`}
                        className="absolute right-0.5 top-0.5 size-7 bg-white/90 text-ink shadow-sm"
                        onClick={() => {
                          const next = photos.filter((_, itemIndex) => itemIndex !== index);
                          setPhotos(next);
                          setPhotoError(next.length > 0 ? checkFiles(next, "photo", limits) : null);
                        }}
                      >
                        <X className="size-3.5" />
                      </IconButton>
                    </li>
                  ))}
                </ul>
                {photos.length > PREVIEW_LIMIT && (
                  <p className="mt-1 text-xs text-ink-soft">Weitere Fotos werden nicht als Vorschau gezeigt.</p>
                )}
              </div>
            )}

            {photoError && (
              <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
                {photoError}
              </p>
            )}

            <Button size="lg" className="w-full sm:w-auto" loading={busy} disabled={photos.length === 0} onClick={submitPhotos}>
              <Upload className="size-4" />
              Fotos importieren
            </Button>
          </>
        )}

        {kind === "link" && (
          <>
            <div>
              <h2 className="text-xl">Link importieren</h2>
              <p className="mt-1 text-sm text-ink-soft">
                Der Import liest die Rezeptseite. Manche Seiten blockieren das automatische Laden.
              </p>
            </div>
            <Field label="Link zum Rezept" error={urlError ?? undefined} hint="Zum Beispiel ein Blog, ein Magazin oder eine Rezeptseite.">
              <div className="relative">
                <Link2 className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-soft" />
                <Input
                  className="pl-10"
                  type="url"
                  inputMode="url"
                  value={url}
                  placeholder="https://…"
                  onChange={(event) => setUrl(event.target.value)}
                />
              </div>
            </Field>
            <Button size="lg" className="w-full sm:w-auto" loading={busy} disabled={!url.trim() || Boolean(urlError)} onClick={submitLink}>
              <Upload className="size-4" />
              Link importieren
            </Button>
          </>
        )}

        {kind === "video" && (
          <>
            <div>
              <h2 className="text-xl">Video importieren</h2>
              <p className="mt-1 text-sm text-ink-soft">
                Lade eine Videodatei hoch. Das Video wird nie gekürzt. Die Länge wird vor dem Upload geprüft.
              </p>
            </div>
            <Field label="Link zum Video" error={videoUrlError ?? undefined} hint="Ein Link zu einem Video, wenn die Plattform das Laden erlaubt.">
              <div className="relative">
                <Video className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-soft" />
                <Input
                  className="pl-10"
                  type="url"
                  inputMode="url"
                  value={videoUrl}
                  placeholder="https://…"
                  onChange={(event) => {
                    setVideoUrl(event.target.value);
                    setVideoFile(null);
                    setVideoError(null);
                  }}
                />
              </div>
            </Field>
            <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-ink-soft">
              <span className="h-px flex-1 bg-line" />
              oder
              <span className="h-px flex-1 bg-line" />
            </div>
            <label className="tap flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line bg-paper/60 px-4 py-8 text-center transition hover:border-brand/50">
              <Video className="size-6 text-brand" />
              <span className="text-sm font-medium text-ink">Videodatei auswählen</span>
              <span className="max-w-full truncate text-xs text-ink-soft">
                {videoFile ? videoFile.name : "MP4, MOV oder WebM"}
              </span>
              <input
                type="file"
                accept="video/*"
                className="sr-only"
                onChange={(event) => {
                  chooseVideo(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
            </label>
            {videoError && (
              <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
                {videoError}
              </p>
            )}
            <div className="rounded-xl bg-paper-2/70 px-4 py-3 text-sm text-ink-soft">
              Klappt der Video-Import nicht, lade einen Screenshot des Rezepts hoch.{" "}
              <button type="button" className="font-medium text-brand underline-offset-4 hover:underline" onClick={() => setKind("photo")}>
                Zu den Fotos
              </button>
            </div>
            <Button
              size="lg"
              className="w-full sm:w-auto"
              loading={busy}
              disabled={!videoUrl.trim() && !videoFile}
              onClick={() => void submitVideo()}
            >
              <Upload className="size-4" />
              {videoUrl.trim() ? "Video-Link importieren" : "Video hochladen"}
            </Button>
          </>
        )}

        {kind === "text" && (
          <>
            <div>
              <h2 className="text-xl">Text importieren</h2>
              <p className="mt-1 text-sm text-ink-soft">Füge ein Rezept als Text ein. Auch eine Nachricht aus dem Chat geht.</p>
            </div>
            <Field label="Rezepttext" hint={`${text.length} von 200.000 Zeichen`}>
              <Textarea
                className="min-h-48"
                value={text}
                maxLength={200000}
                placeholder="Zutaten und Zubereitung einfügen …"
                onChange={(event) => setText(event.target.value)}
              />
            </Field>
            <Button size="lg" className="w-full sm:w-auto" loading={busy} disabled={!text.trim()} onClick={submitText}>
              <FileText className="size-4" />
              Text importieren
            </Button>
          </>
        )}

        {kind === "pdf" && (
          <>
            <div>
              <h2 className="text-xl">PDF importieren</h2>
              <p className="mt-1 text-sm text-ink-soft">
                Eine PDF-Datei mit höchstens {limits.maxPdfPages} Seiten. Jede Seite wird als Bild gelesen.
              </p>
            </div>
            <label className="tap flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line bg-paper/60 px-4 py-10 text-center transition hover:border-brand/50">
              <FileText className="size-6 text-brand" />
              <span className="text-sm font-medium text-ink">PDF auswählen</span>
              <span className="max-w-full truncate text-xs text-ink-soft">
                {pdf ? pdf.name : "Eine Datei, höchstens " + formatMb(limits.maxTotalMb * 1024 * 1024)}
              </span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                onChange={(event) => {
                  choosePdf(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
            </label>
            {pdf && (
              <Button variant="ghost" size="sm" onClick={() => choosePdf(null)}>
                Datei entfernen
              </Button>
            )}
            {pdfError && (
              <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
                {pdfError}
              </p>
            )}
            <Button size="lg" className="w-full sm:w-auto" loading={busy} disabled={!pdf} onClick={submitPdf}>
              <Upload className="size-4" />
              PDF importieren
            </Button>
          </>
        )}

        {busy && phase && (
          <div className="rounded-xl border border-line bg-paper-2/60 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <Loader2 className="size-4 animate-spin text-brand" />
              {phase}
            </p>
            {uploadNames.length > 0 && (
              <div className="mt-3 space-y-2">
                {uploadNames.map((name, index) => (
                  <ProgressRow key={`${name}-${index}`} name={name} percent={progress[index] ?? 0} />
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-ink-soft">Bitte schließe die Seite nicht.</p>
          </div>
        )}

        {error && (
          <div role="alert" className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
            <p className="flex-1 text-sm text-danger">{error}</p>
            <IconButton label="Hinweis schließen" className="size-7 text-danger" onClick={() => setError(null)}>
              <X className="size-4" />
            </IconButton>
          </div>
        )}
      </Card>

      <div className="mt-5 space-y-3">
        {limitsQuery.isPending ? (
          <Card className="p-4">
            <div className="h-4 w-40 animate-pulse rounded bg-ink/5" />
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-4 w-32 animate-pulse rounded bg-ink/5" />
              ))}
            </div>
          </Card>
        ) : (
          <LimitsCard limits={limits} failed={limitsQuery.isError} />
        )}
        <div className="flex items-center gap-2 text-xs text-ink-soft">
          <Badge tone="sage">Entwurf</Badge>
          Nach dem Import prüfst du das Rezept. Erst dann wird es gespeichert.
        </div>
      </div>
    </div>
  );
}

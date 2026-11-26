import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Camera, Link2, Loader2 } from "lucide-react";
import { Button, Input } from "../ui";
import { importErrorMessage, startImport } from "./upload";

/**
 * A pasted link without a scheme is still a link ("instagram.com/reel/…").
 * Returns the full address, or null when it cannot be one.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (!parsed.hostname.includes(".")) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** The fastest way into the app: paste a link, the AI reads the recipe. */
export function CaptureBar() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const href = normalizeUrl(url);
    if (!href) {
      setError("Das ist kein gültiger Link.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await startImport({ kind: "link", keys: [], url: href });
      navigate(`/import/${id}`);
    } catch (caught) {
      setError(importErrorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <section className="rounded-[var(--radius-card)] border border-brand/25 bg-brand/[0.05] p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-lg leading-tight">
          <Link2 className="size-5 text-brand" aria-hidden />
          Rezept per Link erfassen
        </h2>
        <span className="rounded-full bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand-dark">
          Schnellster Weg
        </span>
      </div>

      <form onSubmit={(event) => void submit(event)} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Link2 className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
          <Input
            className="pl-10"
            type="url"
            inputMode="url"
            autoComplete="off"
            aria-label="Link zum Rezept"
            placeholder="https://instagram.com/reel/…"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError(null);
            }}
          />
        </div>
        <Button type="submit" size="lg" className="sm:min-w-40" disabled={busy || !url.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
          Importieren
        </Button>
      </form>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
        <span>Instagram, TikTok, YouTube oder eine Rezeptseite.</span>
        <Link
          to="/erfassen?art=photo"
          className="tap inline-flex min-h-8 items-center gap-1 font-medium text-brand underline-offset-4 hover:underline"
        >
          <Camera className="size-3.5" aria-hidden />
          Oder Fotos erfassen
        </Link>
        <Link to="/erfassen" className="tap inline-flex min-h-8 items-center text-ink-soft underline-offset-4 hover:text-ink hover:underline">
          Alle Wege
        </Link>
      </div>
    </section>
  );
}

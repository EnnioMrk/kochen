import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Link2 } from "lucide-react";
import { BrandMark } from "../components/Brand";
import { Button } from "../components/ui";
import { importErrorMessage, startImport } from "../components/capture/upload";
import { sharedLink } from "../lib/share";

type Phase = { phase: "starting" } | { phase: "error"; message: string };

/**
 * The share target. A link shared from another app opens this page, and the
 * capture starts without a second tap. The worker does the work, so the app
 * can be closed again straight away.
 */
export function ShareTargetPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const key = params.toString();
  const [state, setState] = useState<Phase>({ phase: "starting" });
  const [link, setLink] = useState<string | null>(null);
  const started = useRef<string | null>(null);

  useEffect(() => {
    // One capture per share. A reload or a second render must not repeat it.
    if (started.current === key) return;
    started.current = key;

    const shared = sharedLink({
      url: params.get("url"),
      text: params.get("text"),
      title: params.get("title"),
    });
    if (!shared) {
      setState({ phase: "error", message: "Der geteilte Inhalt enthält keinen Link." });
      return;
    }
    setLink(shared);

    startImport({ kind: "link", keys: [], url: shared })
      .then((id) => navigate(`/import/${id}`, { replace: true }))
      .catch((error: unknown) => {
        setState({ phase: "error", message: importErrorMessage(error) });
      });
    // `key` holds every share parameter; the effect must run once per share.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, navigate]);

  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center"
      style={{
        paddingTop: "calc(2rem + var(--safe-top))",
        paddingBottom: "calc(2rem + var(--safe-bottom))",
      }}
    >
      <BrandMark className="h-16 w-auto" />

      {state.phase === "starting" ? (
        <>
          <h1 className="flex items-center gap-2 text-2xl leading-tight">
            <Loader2 className="size-5 animate-spin text-brand" aria-hidden />
            Link wird erfasst …
          </h1>
          <p className="max-w-md text-sm text-ink-soft">
            Der Import läuft im Hintergrund. Du kannst die App schließen und bekommst eine
            Nachricht, wenn der Entwurf bereit ist.
          </p>
          {link && (
            <p className="flex max-w-md items-center gap-1.5 text-xs text-ink-soft/80">
              <Link2 className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{link}</span>
            </p>
          )}
        </>
      ) : (
        <>
          <h1 className="text-2xl leading-tight">Das Teilen hat nicht geklappt</h1>
          <p className="max-w-md text-sm text-ink-soft">{state.message}</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={() => navigate("/erfassen", { replace: true })}>
              <Link2 className="size-4" aria-hidden />
              Link einfügen
            </Button>
            <Button variant="secondary" onClick={() => navigate("/", { replace: true })}>
              Zu den Rezepten
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

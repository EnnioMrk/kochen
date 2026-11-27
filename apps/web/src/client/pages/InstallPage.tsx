import { useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Download, Share, Smartphone, SquarePlus } from "lucide-react";
import { Button, Card, useToast } from "../components/ui";
import { BrandMark, BrandWordmark } from "../components/Brand";
import {
  installPromptAvailable,
  isIosDevice,
  isStandalone,
  promptInstall,
  subscribeInstall,
  wasInstalledThisSession,
} from "../lib/install";

function Step({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm leading-relaxed text-ink-soft">
      <Check className="mt-0.5 size-4 shrink-0 text-sage" aria-hidden />
      <span>{children}</span>
    </li>
  );
}

export function InstallPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const available = useSyncExternalStore(subscribeInstall, installPromptAvailable, () => false);
  const standalone = isStandalone();
  const installed = standalone || wasInstalledThisSession();
  const ios = isIosDevice();

  const install = async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      toast.push("Die App wird installiert.", "success");
    } else if (outcome === "dismissed") {
      toast.push("Die Installation wurde abgebrochen.", "info");
    } else {
      toast.push("Dein Browser meldet kein Installationsfenster. Nutze die Anleitung unten.", "error");
    }
  };

  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 py-8 sm:px-6"
      style={{
        paddingTop: "calc(1.5rem + var(--safe-top))",
        paddingBottom: "calc(1.5rem + var(--safe-bottom))",
      }}
    >
      <Link
        to="/"
        className="tap inline-flex min-h-10 w-fit items-center gap-1.5 text-sm font-medium text-ink-soft transition hover:text-ink"
      >
        <ArrowLeft className="size-4" />
        Zu den Rezepten
      </Link>

      <div className="mt-8 flex items-center gap-3">
        <BrandMark className="h-14 w-auto" />
        <div>
          <h1 className="text-3xl leading-tight">
            <BrandWordmark className="inline-block h-6 w-auto align-[-2px] text-ink" label="Rezeptor" /> als App
          </h1>
          <p className="mt-1 text-sm text-ink-soft">Auf dem Home-Bildschirm. Ohne App Store.</p>
        </div>
      </div>

      <Card className="mt-6 space-y-4 p-5">
        {installed ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 font-medium text-ink">
              <Check className="size-5 text-sage" />
              Die App ist installiert.
            </p>
            <p className="text-sm leading-relaxed text-ink-soft">
              Öffne Rezeptor über das Symbol auf dem Home-Bildschirm. Die Seite hier kannst du schließen.
            </p>
            <Button className="w-full" onClick={() => navigate("/")}>
              App öffnen
            </Button>
          </div>
        ) : (
          <>
            {available ? (
              <Button size="lg" className="w-full" onClick={() => void install()}>
                <Download className="size-4" />
                App installieren
              </Button>
            ) : (
              <Button size="lg" className="w-full" disabled>
                <Download className="size-4" />
                App installieren
              </Button>
            )}

            {available ? (
              <p className="text-sm leading-relaxed text-ink-soft">
                Ein Tipp auf den Knopf öffnet das Installationsfenster des Browsers. Danach steht
                Rezeptor im App-Menü und auf dem Home-Bildschirm.
              </p>
            ) : ios ? (
              <div className="space-y-2">
                <p className="flex items-center gap-2 font-medium text-ink">
                  <Smartphone className="size-4 text-brand" />
                  So installierst du die App auf iPhone und iPad
                </p>
                <ol className="space-y-2">
                  <Step>
                    Öffne diese Seite in <strong>Safari</strong>.
                  </Step>
                  <Step>
                    Tippe auf <Share className="inline size-4 align-[-2px]" aria-hidden /> <strong>Teilen</strong>.
                  </Step>
                  <Step>
                    Wähle <SquarePlus className="inline size-4 align-[-2px]" aria-hidden />{" "}
                    <strong>Zum Home-Bildschirm</strong> und dann <strong>Hinzufügen</strong>.
                  </Step>
                </ol>
                <p className="text-xs leading-relaxed text-ink-soft">
                  iOS zeigt kein Installationsfenster. Nur Safari kann die App anlegen.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="font-medium text-ink">So installierst du die App</p>
                <ol className="space-y-2">
                  <Step>Öffne das Browsermenü mit den drei Punkten.</Step>
                  <Step>
                    Wähle <strong>App installieren</strong> oder <strong>Zum Startbildschirm</strong>.
                  </Step>
                  <Step>Bestätige die Installation.</Step>
                </ol>
                <p className="text-xs leading-relaxed text-ink-soft">
                  Manche Browser bieten keine Installation an. Chrome, Edge und Safari können es.
                </p>
              </div>
            )}
          </>
        )}
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="text-lg">Was die App kann</h2>
        <ul className="mt-2 space-y-2">
          <Step>Startet ohne Adressleiste, wie eine normale App.</Step>
          <Step>Liegt auf dem Home-Bildschirm oder im App-Menü.</Step>
          <Step>Meldet neue Rezepte und Kommentare als Mitteilung.</Step>
          <Step>Braucht keinen App Store und kein Update über den Store.</Step>
        </ul>
      </Card>

      <p className="mt-6 text-center text-xs leading-relaxed text-ink-soft">
        Diese Seite ist nur für die Installation da.{" "}
        <Link to="/" className="text-brand underline-offset-4 hover:underline">
          Weiter zu den Rezepten
        </Link>
      </p>
    </div>
  );
}

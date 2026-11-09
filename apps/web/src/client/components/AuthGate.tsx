import { useEffect, useState } from "react";
import { ChefHat, Loader2 } from "lucide-react";
import { Button, Field, Input, Textarea } from "./ui";
import {
  accessState,
  login as platformLogin,
  logout as platformLogout,
  requestAccess,
  signup as platformSignup,
} from "../lib/platform";
import { setDevToken } from "../lib/api";
import { clearToken } from "../lib/platform";

type Mode = "login" | "signup" | "request" | "pending";

export function AuthGate({ code, onRetry }: { code: string | undefined; onRetry: () => void }) {
  const [mode, setMode] = useState<Mode>(code === "not_member" ? "request" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dev, setDev] = useState("");

  useEffect(() => {
    if (code === "not_member" && mode === "login") setMode("request");
  }, [code, mode]);

  useEffect(() => {
    if (code !== "not_member") return;
    let alive = true;
    accessState()
      .then((state) => {
        if (!alive) return;
        const pending = state.requests.some(
          (request) => request.status === "pending" && request.message !== undefined,
        );
        if (pending) setMode("pending");
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [code]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await platformLogin(email.trim(), password);
      } else if (mode === "signup") {
        await platformSignup(email.trim(), password, name.trim());
      } else if (mode === "request") {
        await requestAccess(message.trim());
        setMode("pending");
        return;
      }
      clearToken();
      onRetry();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Das hat nicht geklappt.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    clearToken();
    await platformLogout().catch(() => undefined);
    setMode("login");
    setPassword("");
    onRetry();
  }

  const title =
    mode === "login"
      ? "Willkommen zurück"
      : mode === "signup"
        ? "Konto erstellen"
        : mode === "request"
          ? "Zugang anfragen"
          : "Anfrage ist unterwegs";

  const lede =
    mode === "login"
      ? "Melde dich mit deinem ennio.vip-Konto an."
      : mode === "signup"
        ? "Ein Konto reicht für alle privaten Seiten. Der Zugang zu Kochen wird danach freigegeben."
        : mode === "request"
          ? "Dein Konto ist bekannt, aber Kochen ist noch nicht freigegeben. Schreib eine kurze Nachricht – der Betreiber antwortet."
          : "Der Betreiber sieht deine Anfrage. Du bekommst eine E-Mail, sobald sie beantwortet ist.";

  return (
    <div className="paper-grain flex min-h-dvh items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/20">
            <ChefHat className="size-7" />
          </span>
          <h1 className="text-4xl">Kochen</h1>
          <p className="mt-2 text-sm text-ink-soft">Rezepte für Familie und Freunde.</p>
        </div>

        <div className="rounded-[var(--radius-card)] border border-line bg-white/85 p-6 shadow-sm">
          <h2 className="text-xl">{title}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{lede}</p>

          {mode === "pending" ? (
            <div className="mt-6 space-y-3">
              <div className="rounded-xl bg-sage-soft px-4 py-3 text-sm text-sage">
                Deine Anfrage liegt beim Betreiber. Nichts weiter zu tun.
              </div>
              <Button variant="secondary" className="w-full" onClick={() => void signOut()}>
                Abmelden
              </Button>
            </div>
          ) : (
            <form className="mt-5 space-y-3" onSubmit={submit}>
              {mode === "signup" && (
                <Field label="Name">
                  <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
                </Field>
              )}
              {mode !== "request" && (
                <>
                  <Field label="E-Mail">
                    <Input
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </Field>
                  <Field label="Passwort">
                    <Input
                      type="password"
                      required
                      minLength={8}
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </Field>
                </>
              )}
              {mode === "request" && (
                <Field label="Nachricht" hint="Optional. Ein Satz reicht.">
                  <Textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    maxLength={1000}
                    rows={3}
                    placeholder="Wer bist du?"
                  />
                </Field>
              )}

              {error && (
                <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" loading={busy}>
                {mode === "login" ? "Anmelden" : mode === "signup" ? "Konto erstellen" : "Anfrage senden"}
              </Button>

              {mode === "login" && (
                <div className="flex items-center justify-between pt-1 text-sm">
                  <button
                    type="button"
                    className="text-ink-soft underline-offset-4 hover:text-ink hover:underline"
                    onClick={() => {
                      setMode("signup");
                      setError(null);
                    }}
                  >
                    Konto erstellen
                  </button>
                  <a
                    href="https://ennio.vip/login"
                    className="text-ink-soft underline-offset-4 hover:text-ink hover:underline"
                  >
                    Passwort vergessen?
                  </a>
                </div>
              )}

              {mode === "signup" && (
                <button
                  type="button"
                  className="w-full text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline"
                  onClick={() => {
                    setMode("login");
                    setError(null);
                  }}
                >
                  Ich habe schon ein Konto
                </button>
              )}

              {mode === "request" && (
                <Button type="button" variant="ghost" className="w-full" onClick={() => void signOut()}>
                  Mit einem anderen Konto anmelden
                </Button>
              )}
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-ink-soft">
          Zugang nur für freigegebene Konten. Keine öffentliche Seite.
          <br />
          Ein Dienst von{" "}
          <a href="https://ennio.vip" className="underline underline-offset-2 hover:text-ink">
            ennio.vip
          </a>
          .
        </p>

        {import.meta.env.DEV && (
          <details className="mt-6 text-center text-xs text-ink-soft">
            <summary className="cursor-pointer">Lokale Entwicklung</summary>
            <div className="mt-2 space-y-2">
              <Input value={dev} onChange={(event) => setDev(event.target.value)} placeholder="dev:sub:email:Name" />
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() => {
                  setDevToken(dev);
                  onRetry();
                }}
              >
                Mit Dev-Token laden
              </Button>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

export function LoadingScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="flex items-center gap-3 text-ink-soft">
        <Loader2 className="size-5 animate-spin text-brand" />
        <span className="text-sm">Kochen wird geladen …</span>
      </div>
    </div>
  );
}

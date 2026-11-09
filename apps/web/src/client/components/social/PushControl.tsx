import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellRing, Smartphone } from "lucide-react";
import { api } from "../../lib/api";
import { Button, Card, Spinner, useToast } from "../ui";

type PushKey = { publicKey: string; enabled: boolean };

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
}

export function PushControl({ compact = false }: { compact?: boolean }) {
  const toast = useToast();
  const [supported] = useState(
    () =>
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window,
  );
  const [subscribed, setSubscribed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keyQuery = useQuery({
    queryKey: ["push-key"],
    queryFn: () => api<PushKey>("/api/push/key"),
    staleTime: 10 * 60_000,
    retry: false,
  });

  useEffect(() => {
    let cancelled = false;
    if (!supported) {
      setChecking(false);
      return;
    }
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (!cancelled) setSubscribed(Boolean(subscription));
      } catch {
        // A missing registration only means push is off.
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supported]);

  const enable = async () => {
    setError(null);
    const publicKey = keyQuery.data?.publicKey;
    if (!supported) {
      setError("Dieser Browser unterstützt keine Push-Nachrichten.");
      return;
    }
    if (!publicKey) {
      setError("Push ist auf diesem Server nicht eingerichtet.");
      return;
    }
    setBusy(true);
    try {
      const permission = await window.Notification.requestPermission();
      if (permission !== "granted") {
        setError("Benachrichtigungen sind blockiert. Erlaube sie in den Einstellungen des Browsers.");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
        throw new Error("subscription_incomplete");
      }
      await api("/api/push/subscribe", {
        method: "POST",
        body: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } },
      });
      await api("/api/push/setting", { method: "PATCH", body: { enabled: true } });
      setSubscribed(true);
      toast.push("Push ist aktiv.", "success");
    } catch {
      setError("Push konnte nicht aktiviert werden. Bitte versuche es erneut.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setError(null);
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await api("/api/push/subscribe", {
          method: "DELETE",
          body: { endpoint: subscription.endpoint },
        });
        await subscription.unsubscribe();
      }
      await api("/api/push/setting", { method: "PATCH", body: { enabled: false } });
      setSubscribed(false);
      toast.push("Push ist aus.", "info");
    } catch {
      setError("Push konnte nicht ausgeschaltet werden. Bitte versuche es erneut.");
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className="flex flex-wrap items-center gap-2">
        <BellRing className="size-4 text-sage" />
        <span className="text-sm font-medium text-ink">Push-Nachrichten</span>
        {checking ? (
          <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
            <Spinner className="size-3" /> wird geprüft
          </span>
        ) : subscribed ? (
          <span className="rounded-full bg-sage-soft px-2 py-0.5 text-xs font-medium text-sage">aktiv</span>
        ) : (
          <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs font-medium text-ink-soft">aus</span>
        )}
      </div>

      {!supported ? (
        <p className="text-sm text-ink-soft">Dieser Browser unterstützt keine Push-Nachrichten.</p>
      ) : keyQuery.isPending ? (
        <p className="text-sm text-ink-soft">Push wird geladen …</p>
      ) : keyQuery.isError ? (
        <p className="text-sm text-danger">Der Push-Schlüssel konnte nicht geladen werden.</p>
      ) : !keyQuery.data?.enabled ? (
        <p className="text-sm text-ink-soft">Push ist auf diesem Server nicht eingerichtet.</p>
      ) : subscribed ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" loading={busy} onClick={() => void disable()}>
            Push ausschalten
          </Button>
          <span className="text-xs text-ink-soft">Du bekommst Hinweise zu Kommentaren, Freunden und Timern.</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" loading={busy} onClick={() => void enable()}>
            Push aktivieren
          </Button>
          <span className="text-xs text-ink-soft">Du entscheidest selbst. Der Browser fragt nach Erlaubnis.</span>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-ink-soft">
        <Smartphone className="mt-0.5 size-3.5 shrink-0" />
        Auf dem iPhone geht Push nur, wenn du die App zum Home-Bildschirm hinzufügst.
      </p>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );

  if (compact) return body;
  return <Card className="p-4 sm:p-5">{body}</Card>;
}

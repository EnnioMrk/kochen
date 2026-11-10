import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Limits } from "@kochen/contracts";
import { LogOut, Shield, Sparkles } from "lucide-react";
import { api, logout, qk } from "../lib/api";
import { useMe } from "../lib/session";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Segmented,
  Skeleton,
  Switch,
  useToast,
} from "../components/ui";
import { PushControl } from "../components/social/PushControl";

type Settings = { limits: Limits; features: Record<string, boolean>; appOrigin: string };
type LimitForm = Record<keyof Limits, string>;

const LIMIT_FIELDS: Array<{
  key: keyof Limits;
  label: string;
  unit: string;
  step: string;
  integer: boolean;
}> = [
  { key: "maxPhotos", label: "Fotos je Import", unit: "Anzahl", step: "1", integer: true },
  { key: "maxPhotoMb", label: "Größe je Foto", unit: "MB", step: "0.5", integer: false },
  { key: "maxTotalMb", label: "Gesamtgröße je Import", unit: "MB", step: "0.5", integer: false },
  { key: "maxVideoMinutes", label: "Videolänge", unit: "Minuten", step: "0.5", integer: false },
  { key: "maxAudioMinutes", label: "Audiolänge", unit: "Minuten", step: "0.5", integer: false },
  { key: "maxPdfPages", label: "PDF-Seiten", unit: "Seiten", step: "1", integer: true },
];

function toForm(limits: Limits): LimitForm {
  return {
    maxPhotos: String(limits.maxPhotos),
    maxPhotoMb: String(limits.maxPhotoMb),
    maxTotalMb: String(limits.maxTotalMb),
    maxVideoMinutes: String(limits.maxVideoMinutes),
    maxAudioMinutes: String(limits.maxAudioMinutes),
    maxPdfPages: String(limits.maxPdfPages),
  };
}

export function SettingsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useMe();

  const [cookingView, setCookingView] = useState<"steps" | "overview">("steps");
  const [friendListVisible, setFriendListVisible] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [limitForm, setLimitForm] = useState<LimitForm | null>(null);
  const [limitError, setLimitError] = useState<string | null>(null);

  useEffect(() => {
    if (!me.data) return;
    setCookingView(me.data.cookingView);
    setFriendListVisible(me.data.friendListVisible);
  }, [me.data?.cookingView, me.data?.friendListVisible]);

  const patchMe = useMutation({
    mutationFn: (body: { cookingView?: "steps" | "overview"; friendListVisible?: boolean }) =>
      api<{ updated: boolean }>("/api/me", { method: "PATCH", body }),
    onSuccess: (_data, variables) => {
      toast.push("Einstellung gespeichert.", "success");
      if (variables.friendListVisible !== undefined) setFriendListVisible(variables.friendListVisible);
      if (variables.cookingView !== undefined) setCookingView(variables.cookingView);
      void queryClient.invalidateQueries({ queryKey: qk.me });
    },
    onError: () => {
      toast.push("Die Einstellung konnte nicht gespeichert werden.", "error");
      if (me.data) {
        setCookingView(me.data.cookingView);
        setFriendListVisible(me.data.friendListVisible);
      }
    },
  });

  const isAdmin = me.data?.role === "admin" || me.data?.role === "owner";

  const settingsQuery = useQuery({
    queryKey: qk.settings,
    queryFn: () => api<Settings>("/api/settings"),
    enabled: isAdmin,
  });

  useEffect(() => {
    if (settingsQuery.data) setLimitForm(toForm(settingsQuery.data.limits));
  }, [settingsQuery.data]);

  const saveLimits = useMutation({
    mutationFn: (body: Partial<Limits>) => api<Limits>("/api/settings/limits", { method: "PATCH", body }),
    onSuccess: (limits) => {
      toast.push("Grenzen gespeichert.", "success");
      setLimitForm(toForm(limits));
      void queryClient.invalidateQueries({ queryKey: qk.settings });
      void queryClient.invalidateQueries({ queryKey: qk.limits });
    },
    onError: () => toast.push("Die Grenzen konnten nicht gespeichert werden.", "error"),
  });

  const submitLimits = () => {
    if (!limitForm) return;
    const values: Partial<Limits> = {};
    for (const field of LIMIT_FIELDS) {
      const raw = limitForm[field.key].trim().replace(",", ".");
      const value = Number(raw);
      if (!raw || !Number.isFinite(value) || value <= 0) {
        setLimitError(`Bitte gib für „${field.label}“ eine Zahl größer als 0 ein.`);
        return;
      }
      if (field.integer && !Number.isInteger(value)) {
        setLimitError(`„${field.label}“ muss eine ganze Zahl sein.`);
        return;
      }
      values[field.key] = value;
    }
    setLimitError(null);
    saveLimits.mutate(values);
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await logout();
      queryClient.clear();
      window.location.assign("/");
    } catch {
      toast.push("Abmelden hat nicht geklappt.", "error");
      setSigningOut(false);
    }
  };

  if (me.isPending) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHeader title="Einstellungen" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (!me.data) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Einstellungen" />
        <Card className="p-5">
          <p className="text-sm text-danger">Die Einstellungen konnten nicht geladen werden.</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => void me.refetch()}>
            Erneut versuchen
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title="Einstellungen"
        subtitle="Ansicht, Sichtbarkeit und Benachrichtigungen. Alles gilt nur für dich."
      />

      <Card className="p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-lg">
          <Sparkles className="size-5 text-sage" />
          Kochen
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">
          Lege fest, wie ein Rezept im Kochmodus startet. Du kannst jederzeit umschalten.
        </p>
        <div className="mt-3">
          <Segmented
            value={cookingView}
            ariaLabel="Ansicht beim Kochen"
            fluid
            options={[
              { value: "steps", label: "Schritt für Schritt", shortLabel: "Schritte" },
              { value: "overview", label: "Ganze Übersicht", shortLabel: "Übersicht" },
            ]}
            onChange={(next) => {
              setCookingView(next);
              patchMe.mutate({ cookingView: next });
            }}
          />
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          „Schritt für Schritt“ zeigt einen Schritt groß. „Ganze Übersicht“ zeigt alle Schritte auf einmal.
        </p>
      </Card>

      <Card className="p-4 sm:p-5">
        <h2 className="text-lg">Freunde</h2>
        <Switch
          checked={friendListVisible}
          label="Freundesliste für Freunde sichtbar"
          onChange={(next) => {
            setFriendListVisible(next);
            patchMe.mutate({ friendListVisible: next });
          }}
        />
        <p className="text-sm leading-relaxed text-ink-soft">
          Wenn aus, sehen Freunde deine Kontakte nicht. Deine Rezepte bleiben sichtbar.
        </p>
        <Link to="/freunde" className="mt-2 inline-block text-sm text-brand underline-offset-4 hover:underline">
          Freunde verwalten
        </Link>
      </Card>

      <PushControl />

      <Card className="p-4 sm:p-5">
        <h2 className="text-lg">App</h2>
        <dl className="mt-2 space-y-2 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-ink-soft">Name</dt>
            <dd className="text-ink">Kochen</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-ink-soft">Version</dt>
            <dd className="text-ink">0.1.0</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-ink-soft">Zugang</dt>
            <dd className="text-ink">Nur für freigegebene Konten</dd>
          </div>
        </dl>
        <p className="mt-3 rounded-xl bg-paper-2/70 px-3 py-2 text-xs leading-relaxed text-ink-soft">
          Keine Suchmaschinen: Die App sendet <code>noindex, nofollow</code> und eine <code>robots.txt</code> mit
          Sperre. Es gibt keine öffentliche Seite.
        </p>
      </Card>

      <Card className="p-4 sm:p-5">
        <h2 className="text-lg">Konto</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Angemeldet als {me.data.email ?? me.data.name}. Die Abmeldung beendet die Sitzung in diesem Browser.
        </p>
        <Button variant="secondary" className="mt-3" loading={signingOut} onClick={() => void signOut()}>
          <LogOut className="size-4" />
          Abmelden
        </Button>
      </Card>

      {isAdmin && (
        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg">
              <Shield className="size-5 text-sage" />
              Grenzen für Importe
            </h2>
            <Badge tone="brand">{me.data.role === "owner" ? "Betreiber" : "Verwaltung"}</Badge>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            Diese Werte gelten für alle neuen Importe. Sie ändern keine laufenden Aufträge.
          </p>

          {settingsQuery.isPending && <Skeleton className="mt-3 h-40 w-full" />}

          {settingsQuery.isError && (
            <p className="mt-3 text-sm text-danger">Die Einstellungen des Servers konnten nicht geladen werden.</p>
          )}

          {limitForm && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {LIMIT_FIELDS.map((field) => (
                <Field key={field.key} label={`${field.label} (${field.unit})`}>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={field.integer ? 1 : 0.1}
                    step={field.step}
                    value={limitForm[field.key]}
                    onChange={(event) =>
                      setLimitForm((current) =>
                        current ? { ...current, [field.key]: event.target.value } : current,
                      )
                    }
                  />
                </Field>
              ))}
            </div>
          )}

          {(limitError || saveLimits.isError) && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {limitError ?? "Die Grenzen konnten nicht gespeichert werden."}
            </p>
          )}

          {limitForm && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button loading={saveLimits.isPending} onClick={submitLimits}>
                Grenzen speichern
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (settingsQuery.data) setLimitForm(toForm(settingsQuery.data.limits));
                  setLimitError(null);
                }}
              >
                Zurücksetzen
              </Button>
              <span className="text-xs text-ink-soft">Nur Verwaltung und Betreiber dürfen das ändern.</span>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

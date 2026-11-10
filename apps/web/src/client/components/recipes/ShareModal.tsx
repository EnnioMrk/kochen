import { useEffect, useState } from "react";
import type { Visibility } from "@kochen/contracts";
import { Copy, Link2, QrCode, Trash2 } from "lucide-react";
import { toDataURL } from "qrcode";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { errorText } from "../../lib/utils";
import { Button, Modal, useToast } from "../ui";

/** The contracts package exports `PrivateLink` only as a schema, not as a type. */
type ShareLink = {
  id: string;
  url: string;
  createdAt: string;
  revokedAt: string | null;
};

export function ShareModal({
  recipeId,
  visibility,
  open,
  onClose,
}: {
  recipeId: string;
  visibility: Visibility;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [link, setLink] = useState<ShareLink | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const created = await api<ShareLink>(`/api/recipes/${recipeId}/links`, {
        method: "POST",
      });
      let image: string | null = null;
      try {
        image = await toDataURL(created.url, {
          margin: 1,
          width: 240,
          color: { dark: "#211c16", light: "#ffffff" },
        });
      } catch {
        image = null;
      }
      return { created, image };
    },
    onSuccess: ({ created, image }) => {
      setLink(created);
      setQr(image);
    },
    onError: (error) => toast.push(errorText(error), "error"),
  });

  const revoke = useMutation({
    mutationFn: (linkId: string) =>
      api<{ revoked: boolean }>(`/api/recipes/${recipeId}/links/${linkId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      setLink(null);
      setQr(null);
      create.reset();
      toast.push("Link widerrufen.", "success");
    },
    onError: (error) => toast.push(errorText(error), "error"),
  });

  useEffect(() => {
    if (!open) {
      setLink(null);
      setQr(null);
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.push("Link kopiert.", "success");
    } catch {
      toast.push("Kopieren ging nicht. Markiere den Link und kopiere ihn von Hand.", "error");
    }
  };

  const isPrivate = visibility === "private";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rezept teilen"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Schließen
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-ink-soft">
          Wer den Link hat und angemeldet ist, kann das Rezept lesen und
          kommentieren. Bearbeiten kann es niemand.
        </p>

        {isPrivate && (
          <p className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink">
            Private Rezepte lassen sich nicht teilen. Stelle die Sichtbarkeit
            zuerst auf Freunde oder Mitglieder.
          </p>
        )}

        {!link && !isPrivate && (
          <Button
            className="w-full"
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            <Link2 className="size-4" />
            Link erstellen
          </Button>
        )}

        {link && (
          <div className="space-y-3">
            {qr ? (
              <img
                src={qr}
                alt="QR-Code zum Rezept"
                className="mx-auto size-52 rounded-xl border border-line bg-white p-2"
              />
            ) : (
              <div className="mx-auto flex size-52 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line text-center text-xs text-ink-soft">
                <QrCode className="size-6" />
                Kein QR-Code verfügbar.
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                value={link.url}
                aria-label="Freigabelink"
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink"
              />
              <Button
                variant="secondary"
                className="shrink-0"
                onClick={() => void copy(link.url)}
              >
                <Copy className="size-4" />
                Kopieren
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              loading={revoke.isPending}
              onClick={() => revoke.mutate(link.id)}
            >
              <Trash2 className="size-4" />
              Link widerrufen
            </Button>
            <p className="text-xs leading-relaxed text-ink-soft">
              Der Link läuft nicht ab. Du kannst ihn jederzeit widerrufen.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

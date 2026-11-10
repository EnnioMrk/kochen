import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_LIMITS, type Limits } from "@kochen/contracts";
import { Camera } from "lucide-react";
import { api, qk } from "../../lib/api";
import { cn } from "../../lib/utils";
import { Button, useToast } from "../ui";
import {
  checkFiles,
  unreadableFileMessage,
  uploadErrorMessage,
  uploadFiles,
} from "../capture/upload";

/**
 * One photo control. It reuses the capture upload path, so size limits,
 * content types and error text stay in one place.
 */
export function CoverUpload({
  recipeId,
  label = "Foto hinzufügen",
  className,
  variant = "secondary",
  onUploaded,
}: {
  recipeId: string;
  label?: string;
  className?: string;
  variant?: "primary" | "secondary";
  onUploaded?: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const limitsQuery = useQuery({
    queryKey: qk.limits,
    queryFn: () => api<Limits>("/api/imports/limits"),
    staleTime: 5 * 60_000,
  });
  const limits = limitsQuery.data ?? DEFAULT_LIMITS;

  const upload = async (file: File) => {
    const problem = checkFiles([file], "photo", limits) ?? unreadableFileMessage(file);
    if (problem) {
      toast.push(problem, "error");
      return;
    }
    setBusy(true);
    try {
      const [key] = await uploadFiles([file], "photo");
      if (!key) throw new Error("upload_failed");
      await api(`/api/recipes/${recipeId}/images`, {
        method: "POST",
        body: { key, kind: "cover", position: 0 },
      });
      void queryClient.invalidateQueries({ queryKey: qk.recipe(recipeId) });
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      toast.push("Foto gespeichert.", "success");
      onUploaded?.();
    } catch (error) {
      toast.push(uploadErrorMessage(error, "upload"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
      <Button
        type="button"
        variant={variant}
        loading={busy}
        className={cn("tap-target", className)}
        onClick={() => inputRef.current?.click()}
      >
        <Camera className="size-4" />
        {label}
      </Button>
    </>
  );
}

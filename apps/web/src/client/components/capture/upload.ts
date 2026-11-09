import type { ImportInput, Limits } from "@kochen/contracts";

export type UploadKindValue = "photo" | "pdf" | "video" | "audio" | "text" | "link";
import { ApiError, api, authToken } from "../../lib/api";

export const MB = 1024 * 1024;

const number = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

export function formatMb(bytes: number): string {
  return `${number.format(bytes / MB)} MB`;
}

export function formatMinutes(seconds: number): string {
  return `${number.format(seconds / 60)} Minuten`;
}

export function formatAmount(value: number): string {
  return number.format(value);
}

export function contentTypeFor(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    case "gif":
      return "image/gif";
    case "pdf":
      return "application/pdf";
    case "mp4":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "webm":
      return "video/webm";
    case "m4a":
      return "audio/mp4";
    default:
      return "application/octet-stream";
  }
}

/**
 * Checks the browser-side limits before anything is uploaded.
 * It never trims the selection: it returns one German sentence or null.
 */
export function checkFiles(files: File[], kind: "photo" | "pdf" | "video", limits: Limits): string | null {
  const total = files.reduce((sum, file) => sum + file.size, 0);

  if (kind === "photo") {
    if (files.length > limits.maxPhotos) {
      return `Erlaubt sind ${limits.maxPhotos} Fotos. Du hast ${files.length} ausgewählt.`;
    }
    for (const file of files) {
      if (!contentTypeFor(file).startsWith("image/")) {
        return `„${file.name}“ ist kein Bild. Erlaubt sind JPG, PNG, HEIC und GIF.`;
      }
      if (file.size > limits.maxPhotoMb * MB) {
        return `„${file.name}“ ist ${formatMb(file.size)} groß. Erlaubt sind ${formatMb(limits.maxPhotoMb * MB)} je Foto.`;
      }
    }
  }

  if (kind === "pdf") {
    if (files.length === 0) return "Bitte wähle eine PDF-Datei.";
    if (files.length > 1) return "Bitte wähle nur eine PDF-Datei.";
    const file = files[0];
    if (!file) return "Bitte wähle eine PDF-Datei.";
    if (contentTypeFor(file) !== "application/pdf") return "Die Datei ist keine PDF-Datei.";
    if (file.size > limits.maxTotalMb * MB) {
      return `Die Datei ist ${formatMb(file.size)} groß. Erlaubt sind ${formatMb(limits.maxTotalMb * MB)} insgesamt.`;
    }
    return null;
  }

  if (kind === "video") {
    for (const file of files) {
      const type = contentTypeFor(file);
      if (!type.startsWith("video/") && !type.startsWith("audio/")) {
        return `„${file.name}“ ist keine Video- oder Audiodatei.`;
      }
    }
  }

  if (total > limits.maxTotalMb * MB) {
    return `Deine Auswahl ist ${formatMb(total)} groß. Erlaubt sind ${formatMb(limits.maxTotalMb * MB)} insgesamt.`;
  }
  return null;
}

export function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    const finish = (seconds: number | null) => {
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => finish(null);
    video.src = url;
  });
}

type PresignedFile = { key: string; uploadUrl: string; headers: Record<string, string> };

async function putFile(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (percent: number) => void,
): Promise<void> {
  const local = url.startsWith("/");
  const token = local ? await authToken() : null;
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url, true);
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === "authorization") continue;
      request.setRequestHeader(name, value);
    }
    if (token) request.setRequestHeader("authorization", `Bearer ${token}`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }
      if (request.status === 413) {
        reject(new ApiError("limit_exceeded", "Die Datei ist zu groß für diesen Server.", 413));
        return;
      }
      reject(new ApiError("internal", "Der Upload ist fehlgeschlagen. Bitte versuche es erneut.", request.status));
    };
    request.onerror = () =>
      reject(new ApiError("internal", "Der Upload ist fehlgeschlagen. Prüfe deine Verbindung.", 0));
    request.onabort = () => reject(new ApiError("internal", "Der Upload wurde abgebrochen.", 0));
    request.send(file);
  });
}

export async function uploadFiles(
  files: File[],
  kind: UploadKindValue,
  onProgress?: (index: number, percent: number) => void,
): Promise<string[]> {
  const presign = await api<{ files: PresignedFile[] }>("/api/imports/uploads/presign", {
    method: "POST",
    body: {
      files: files.map((file) => ({
        filename: file.name,
        contentType: contentTypeFor(file),
        size: file.size,
      })),
      kind,
    },
  });
  if (presign.files.length !== files.length) {
    throw new ApiError("internal", "Der Upload konnte nicht vorbereitet werden.", 500);
  }
  const keys: string[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const target = presign.files[index];
    const file = files[index];
    if (!target || !file) continue;
    onProgress?.(index, 0);
    await putFile(target.uploadUrl, file, target.headers, (percent) => onProgress?.(index, percent));
    onProgress?.(index, 100);
    keys.push(target.key);
  }
  return keys;
}

export async function startImport(input: ImportInput): Promise<string> {
  const job = await api<{ id: string }>("/api/imports", { method: "POST", body: input });
  return job.id;
}

const VALIDATION_MESSAGES: Record<string, string> = {
  url_missing: "Bitte gib einen Link ein.",
  url_invalid: "Der Link ist keine gültige Adresse.",
  scheme_not_allowed: "Der Link muss mit http:// oder https:// beginnen.",
  text_missing: "Bitte gib einen Text ein.",
  files_missing: "Bitte wähle eine Datei aus.",
  invalid_json: "Die Anfrage war ungültig.",
  already_confirmed: "Dieser Entwurf wurde schon gespeichert.",
  self_invite: "Das ist dein eigener Einladungslink.",
  bad_request_id: "Die Anfrage ist ungültig.",
};

function limitMessage(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const values = detail as { limit?: unknown; allowed?: unknown; actual?: unknown };
  const allowed = typeof values.allowed === "number" ? values.allowed : null;
  const actual = typeof values.actual === "number" ? values.actual : null;
  if (allowed === null) return null;
  switch (values.limit) {
    case "maxPhotos":
      return `Erlaubt sind ${allowed} Fotos. Du hast ${actual ?? "zu viele"} ausgewählt.`;
    case "maxPhotoMb":
      return `Erlaubt sind ${number.format(allowed)} MB je Datei. Deine Datei hat ${actual !== null ? number.format(actual) : "mehr"} MB.`;
    case "maxTotalMb":
      return `Erlaubt sind ${number.format(allowed)} MB insgesamt. Deine Auswahl hat ${actual !== null ? number.format(actual) : "mehr"} MB.`;
    default:
      return null;
  }
}

export function importErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "limit_exceeded":
        return (
          limitMessage(error.detail) ??
          "Die Grenze wurde überschritten. Bitte prüfe Anzahl, Größe und Länge der Dateien."
        );
      case "ai_unavailable":
        return "Die KI ist gerade nicht erreichbar. Bitte versuche es später erneut.";
      case "rate_limited":
        return "Zu viele Anfragen. Bitte warte einen Moment.";
      case "not_found":
        return "Der Import wurde nicht gefunden.";
      case "unauthenticated":
        return "Bitte melde dich an.";
      case "not_member":
        return "Dein Konto hat noch keinen Zugang.";
      case "forbidden":
        return "Du hast keine Berechtigung für diese Aktion.";
      case "validation_failed": {
        if (typeof error.detail === "string") {
          if (error.detail.startsWith("unsupported_type:")) {
            const type = error.detail.slice("unsupported_type:".length);
            return `Dieser Dateityp wird nicht unterstützt (${type}).`;
          }
          return VALIDATION_MESSAGES[error.detail] ?? "Die Eingabe ist ungültig. Prüfe die Angaben.";
        }
        return "Die Eingabe ist ungültig. Prüfe die Angaben.";
      }
      case "extraction_failed":
        return "Das Rezept konnte nicht erkannt werden. Versuche es mit einem Foto oder Screenshot.";
      case "conflict":
        return error.message || "Das kollidiert mit einem vorhandenen Eintrag.";
      default:
        return error.message || "Etwas ist schiefgelaufen.";
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return "Etwas ist schiefgelaufen.";
}

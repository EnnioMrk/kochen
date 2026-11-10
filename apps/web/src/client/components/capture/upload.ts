import type { ImportInput, Limits } from "@kochen/contracts";

export type UploadKindValue = "photo" | "pdf" | "video" | "audio" | "text" | "link";
import { ApiError, api, authToken } from "../../lib/api";

export const MB = 1024 * 1024;

const number = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** Types a browser reports when it does not know the real type. */
const GENERIC_CONTENT_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/x-unknown",
]);

export const PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
] as const;

/** Every photo message names the same set, so the UI never contradicts itself. */
export const PHOTO_TYPE_TEXT = "Erlaubt sind JPG, PNG, WebP, HEIC, HEIF und GIF.";

export const UNREADABLE_FILE_MESSAGE =
  "Die Datei konnte nicht gelesen werden. iCloud-Fotos musst du zuerst auf das Gerät laden.";

function extensionOf(name: string): string {
  const match = /\.([a-zA-Z0-9]{1,8})$/.exec(name.trim());
  return (match?.[1] ?? "").toLowerCase();
}

/** Resolve a MIME type from the file extension. Empty string when unknown. */
function typeFromExtension(name: string): string {
  switch (extensionOf(name)) {
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
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    default:
      return "";
  }
}

/**
 * The contentType the server will sign. Browsers report "image/jpg" or nothing
 * at all for real photos; both must become the type the server allows.
 */
export function contentTypeFor(file: File): string {
  const declared = file.type.trim().toLowerCase();
  const normalized = declared === "image/jpg" || declared === "image/pjpeg" ? "image/jpeg" : declared;
  if (!GENERIC_CONTENT_TYPES.has(normalized)) return normalized;
  const fromName = typeFromExtension(file.name);
  return fromName || "application/octet-stream";
}

/**
 * A 0-byte file or a file without type and without a known extension cannot be
 * uploaded; the browser would send data that no importer can read.
 */
export function unreadableFileMessage(file: File): string | null {
  if (file.size === 0) return UNREADABLE_FILE_MESSAGE;
  const type = contentTypeFor(file);
  if (!PHOTO_TYPES.includes(type as (typeof PHOTO_TYPES)[number])) return UNREADABLE_FILE_MESSAGE;
  return null;
}

export function formatMb(bytes: number): string {
  return `${number.format(bytes / MB)} MB`;
}

export function formatMinutes(seconds: number): string {
  return `${number.format(seconds / 60)} Minuten`;
}

export function formatAmount(value: number): string {
  return number.format(value);
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
      const type = contentTypeFor(file);
      if (!PHOTO_TYPES.includes(type as (typeof PHOTO_TYPES)[number])) {
        return `„${file.name}“ ist kein Bild. ${PHOTO_TYPE_TEXT}`;
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

/** A large photo over a slow phone connection still has a chance. */
const UPLOAD_TIMEOUT_MS = 120_000;

/** S3 answers an expired signed URL with one of these codes in the XML body. */
const EXPIRED_LINK_BODY = /expiredrequest|signaturedoesnotmatch|accessdenied|request has expired|signature expired/i;

/**
 * Turn the answer of the PUT into an error the message map can classify.
 * The body is only inspected, never shown: it is English XML.
 */
function storageError(status: number, responseText: string, local: boolean): ApiError {
  if (status === 413) {
    return new ApiError("limit_exceeded", "Die Datei ist zu groß für diesen Server.", 413);
  }
  if (local) {
    // The local fallback is our own API: it answers with the normal error codes.
    if (status === 401) return new ApiError("unauthenticated", "Bitte melde dich an.", 401);
    if (status === 403) return new ApiError("forbidden", "Du hast keine Berechtigung für diese Aktion.", 403);
    if (status >= 500) {
      return new ApiError("server_unavailable", "Der Speicher ist nicht erreichbar.", status);
    }
    return new ApiError("internal", "Der Upload ist fehlgeschlagen.", status);
  }
  // Storage host. 403 means the signed URL no longer fits (expired, wrong key).
  if (status === 403 || EXPIRED_LINK_BODY.test(responseText)) {
    return new ApiError("upload_link_expired", "Der Upload-Link ist abgelaufen.", status);
  }
  if (status >= 500) {
    return new ApiError("server_unavailable", "Der Speicher ist nicht erreichbar.", status);
  }
  return new ApiError("storage_rejected", "Der Speicher hat den Upload abgelehnt.", status);
}

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
    request.timeout = UPLOAD_TIMEOUT_MS;
    for (const [name, value] of Object.entries(headers)) {
      const lower = name.toLowerCase();
      // Only the signed headers may be sent; authorization comes from the token
      // below and "accept" would break the signature.
      if (lower === "authorization" || lower === "accept") continue;
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
      reject(storageError(request.status, request.responseText ?? "", local));
    };
    request.ontimeout = () =>
      reject(new ApiError("timeout", "Der Upload hat zu lange gedauert. Prüfe deine Verbindung.", 0));
    request.onerror = () =>
      reject(
        local
          ? // Same-origin API: the request never reached the server.
            new ApiError("network", "Der Server ist nicht erreichbar.", 0)
          : // Storage host, status 0 while the browser is online: a blocked
            // cross-origin PUT (missing CORS policy), not a connection problem.
            new ApiError("storage_rejected", "Der Speicher hat den Upload abgelehnt.", 0),
      );
    request.onabort = () => reject(new ApiError("cancelled", "Der Upload wurde abgebrochen.", 0));
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

export type UploadErrorContext = "upload" | "import";

/** " (HTTP 413)" whenever the server answered with a status. */
function httpSuffix(status: number | null | undefined): string {
  return typeof status === "number" && status > 0 ? ` (HTTP ${status})` : "";
}

function connectionMessage(context: UploadErrorContext): string {
  return context === "upload"
    ? "Der Upload ist nicht durchgekommen. Prüfe deine Verbindung."
    : "Die Anfrage ist nicht durchgekommen. Prüfe deine Verbindung.";
}

function unknownMessage(context: UploadErrorContext): string {
  return context === "upload"
    ? "Der Upload ist fehlgeschlagen. Bitte versuche es erneut."
    : "Etwas ist schiefgelaufen. Bitte versuche es erneut.";
}

function offline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * One map for every upload and import failure. The rules:
 * - the connection is blamed only when the browser is offline, a timeout
 *   fired, or the request never got an answer at all;
 * - a blocked cross-origin PUT (status 0, browser online) is the storage
 *   refusing the upload, not the user's connection;
 * - raw English server text is never shown.
 */
export function uploadErrorMessage(error: unknown, context: UploadErrorContext = "import"): string {
  if (error instanceof ApiError) {
    const status = error.status > 0 ? error.status : null;
    const http = httpSuffix(status);

    if (error.code === "cancelled") return "Der Upload wurde abgebrochen.";
    // No status and the browser says it is offline: the request never left.
    if (offline() && status === null) return connectionMessage(context);

    // A proxy or gateway can answer with HTML, so the code stays "internal".
    // The status alone then tells that the server is away.
    const authCode = error.code === "unauthenticated" || error.code === "forbidden" || error.code === "not_member";
    if (!authCode && status !== null && status >= 502 && status <= 504) {
      return `Der Server ist gerade nicht erreichbar. Bitte versuche es später erneut.${http}`;
    }

    switch (error.code) {
      case "unauthenticated":
        return `Deine Sitzung ist abgelaufen. Bitte melde dich neu an.${http}`;
      case "forbidden":
        return `Du hast keine Berechtigung für diese Aktion.${http}`;
      case "not_member":
        return `Dein Konto hat noch keinen Zugang.${http}`;
      case "not_found":
        return `Der Import wurde nicht gefunden.${http}`;
      case "limit_exceeded":
        return `${
          limitMessage(error.detail) ?? "Die Datei ist zu groß für diesen Server. Bitte verkleinere sie."
        }${http}`;
      case "storage_rejected":
        return `Der Speicher hat den Upload abgelehnt. Bitte melde das dem Betreiber.${http}`;
      case "upload_link_expired":
        return `Der Upload-Link ist abgelaufen. Bitte starte den Upload neu.${http}`;
      case "server_unavailable":
        return `Der Server ist gerade nicht erreichbar. Bitte versuche es später erneut.${http}`;
      case "timeout":
      case "network":
        return connectionMessage(context);
      case "ai_unavailable":
        return `Die KI ist gerade nicht erreichbar. Bitte versuche es später erneut.${http}`;
      case "rate_limited":
        return `Zu viele Anfragen. Bitte warte einen Moment.${http}`;
      case "validation_failed": {
        if (typeof error.detail === "string") {
          if (error.detail.startsWith("unsupported_type:")) {
            const type = error.detail.slice("unsupported_type:".length);
            return `Dieser Dateityp wird nicht unterstützt (${type}). ${PHOTO_TYPE_TEXT}${http}`;
          }
          return `${VALIDATION_MESSAGES[error.detail] ?? "Die Eingabe ist ungültig. Prüfe die Angaben."}${http}`;
        }
        return `Die Eingabe ist ungültig. Prüfe die Angaben.${http}`;
      }
      case "extraction_failed":
        return `Das Rezept konnte nicht erkannt werden. Versuche es mit einem Foto oder Screenshot.${http}`;
      case "conflict":
        return `${error.message || "Das kollidiert mit einem vorhandenen Eintrag."}${http}`;
      case "internal":
        return `Auf dem Server ist ein Fehler aufgetreten. Bitte versuche es später erneut.${http}`;
      default:
        if (offline()) return connectionMessage(context);
        if (status === 413) {
          return `Die Datei ist zu groß für diesen Server. Bitte verkleinere sie.${http}`;
        }
        if (status === 401) return `Deine Sitzung ist abgelaufen. Bitte melde dich neu an.${http}`;
        if (status === 403) return `Du hast keine Berechtigung für diese Aktion.${http}`;
        if (status !== null && status >= 502 && status <= 504) {
          return `Der Server ist gerade nicht erreichbar. Bitte versuche es später erneut.${http}`;
        }
        return unknownMessage(context);
    }
  }

  if (error instanceof Error) {
    if (error.name === "AbortError") return "Der Upload wurde abgebrochen.";
    if (offline()) return connectionMessage(context);
    // fetch rejects with a TypeError when no response ever arrived (DNS,
    // offline, TLS). Its message is English and must not be shown.
    if (error.name === "TypeError" || error.name === "TimeoutError") return connectionMessage(context);
    return unknownMessage(context);
  }

  if (offline()) return connectionMessage(context);
  return unknownMessage(context);
}

/** Import-side name. Always the same map, so there is one path only. */
export function importErrorMessage(error: unknown): string {
  return uploadErrorMessage(error, "import");
}

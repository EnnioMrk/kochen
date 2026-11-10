export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
}

export function relativeTime(value: string | Date): string {
  const then = new Date(value).getTime();
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 1) return "gerade eben";
  if (Math.abs(minutes) < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return `vor ${days} ${days === 1 ? "Tag" : "Tagen"}`;
  return formatDate(value);
}

export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function limitLabel(value: number, unit: string): string {
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value)} ${unit}`;
}

export function errorText(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String((error as Error).message);
  return "Etwas ist schiefgelaufen.";
}

export function downloadUrl(path: string): string {
  return path;
}

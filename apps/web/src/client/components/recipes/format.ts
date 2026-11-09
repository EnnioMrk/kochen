import type { SourceType, Visibility } from "@kochen/contracts";

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  private: "Privat",
  friends: "Freunde",
  members: "Alle Mitglieder",
};

export const SOURCE_LABEL: Record<SourceType, string> = {
  manual: "Selbst eingegeben",
  photo: "Foto",
  link: "Link",
  video: "Video",
  text: "Text",
  pdf: "PDF",
};

/** German decimal text: 4.5 -> "4,5". */
export function decimal(value: number, digits = 1): string {
  return value.toFixed(digits).replace(".", ",");
}

export function ratingLabel(
  avg: number | null | undefined,
  count: number | null | undefined,
): string {
  if (avg === null || avg === undefined) return "Noch keine Bewertung";
  const total = count ?? 0;
  return `${decimal(avg)} von 5 · ${total} ${total === 1 ? "Bewertung" : "Bewertungen"}`;
}

export function durationLabel(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} Std. ${rest} Min.` : `${hours} Std.`;
}

export function servingsLabel(count: number): string {
  return `${count} ${count === 1 ? "Portion" : "Portionen"}`;
}

/** Remaining time as "m:ss" for cooking timers. */
export function timerText(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

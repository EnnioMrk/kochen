/** German text for the warning codes that `normalizeDraft` emits. */
const WARNING_MESSAGES: Record<string, string> = {
  titel_fehlt: "Der Titel fehlt. Bitte ergänze ihn.",
  portionen_fehlen: "Die Portionsangabe fehlt. Es wurden 4 Portionen angenommen.",
  zu_viele_zutaten: "Es wurden nur die ersten 200 Zutaten übernommen.",
  zu_viele_schritte: "Es wurden nur die ersten 100 Schritte übernommen.",
  kein_rezept_gefunden: "Auf der Quelle war kein vollständiges Rezept erkennbar.",
  schema_reparatur: "Einige Felder konnten nicht gelesen werden. Bitte prüfe das Rezept.",
};

function germanWarning(code: string): string {
  const known = WARNING_MESSAGES[code];
  if (known) return known;
  if (code.startsWith("feld:")) return "Ein Feld konnte nicht gelesen werden.";
  // Already human-readable (a prepared-source warning).
  if (/[A-ZÄÖÜ\s]/.test(code)) return code;
  return "Ein Teil der Quelle konnte nicht gelesen werden.";
}

export function germanWarnings(codes: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const code of codes) {
    if (!code) continue;
    const text = germanWarning(code);
    if (seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

export const SCREENSHOT_WARNING =
  "Bitte lade einen Screenshot des Rezepts hoch oder ergänze die Angaben von Hand.";

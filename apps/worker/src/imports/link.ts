import type { ExtractionInput } from "@kochen/ai";
import { JobFailure } from "../errors";
import { fetchPage, parseRecipeJsonLd, readableText } from "../fetch-source";

export type LinkMaterial = {
  /** Parsed schema.org recipe; no model call needed. */
  jsonLd: { draft: Record<string, unknown>; sourceLang: string | null } | null;
  /** Model input when JSON-LD is missing. */
  extraction: ExtractionInput | null;
  rawText: string;
  sourceUrl: string;
};

/**
 * Fetch the page, prefer its JSON-LD recipe, fall back to Readability text.
 * The raw text is kept for the recipe record.
 */
export async function prepareLink(url: string): Promise<LinkMaterial> {
  const page = await fetchPage(url);
  const jsonLd = parseRecipeJsonLd(page.html, page.finalUrl);
  const readable = readableText(page.html, page.finalUrl);

  if (jsonLd) {
    return {
      jsonLd: { draft: jsonLd.draft, sourceLang: jsonLd.sourceLang },
      extraction: null,
      rawText: jsonLd.rawText || readable,
      sourceUrl: page.finalUrl,
    };
  }

  if (readable.length < 40) {
    throw new JobFailure(
      "extraction_failed",
      "Auf der Seite wurde kein lesbarer Rezepttext gefunden.",
    );
  }

  return {
    jsonLd: null,
    extraction: { text: readable, url: page.finalUrl },
    rawText: readable,
    sourceUrl: page.finalUrl,
  };
}

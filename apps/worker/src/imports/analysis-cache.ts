import { db } from "@rezeptor/db";
import { logger } from "../config";

/**
 * Stored result of one analysed link. The draft is the same value the job
 * payload carries under `draft`, so a cache hit writes the same review screen
 * as a fresh run.
 */
export type CachedAnalysis = {
  draft: unknown;
  warnings: string[];
  asksForScreenshot: boolean;
  servingsEstimated: boolean;
  sourceLang: string | null;
  signals: string[];
  captionWeak: boolean;
  rawText: string | null;
  transcript: string | null;
};

export type CacheableAnalysis = CachedAnalysis & {
  urlKey: string;
  sourceUrl: string;
};

/** Bump when a prompt or normaliser change makes old results stale. */
export const CACHE_VERSION = 1;

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function readAnalysisCache(urlKey: string): Promise<CachedAnalysis | null> {
  try {
    const sql = db();
    const rows = await sql<
      {
        draft: unknown;
        warnings: unknown;
        asksForScreenshot: boolean;
        servingsEstimated: boolean;
        sourceLang: string | null;
        signals: unknown;
        captionWeak: boolean;
        rawText: string | null;
        transcript: string | null;
      }[]
    >`
      select draft,
             warnings,
             asks_for_screenshot as "asksForScreenshot",
             servings_estimated as "servingsEstimated",
             source_lang as "sourceLang",
             signals,
             caption_weak as "captionWeak",
             raw_text as "rawText",
             transcript
      from import_analysis_cache
      where url_key = ${urlKey} and version = ${CACHE_VERSION}
    `;
    const row = rows[0];
    if (!row) return null;
    await sql`
      update import_analysis_cache set hits = hits + 1, updated_at = now() where url_key = ${urlKey}
    `;
    return {
      draft: row.draft,
      warnings: asStringList(row.warnings),
      asksForScreenshot: Boolean(row.asksForScreenshot),
      servingsEstimated: Boolean(row.servingsEstimated),
      sourceLang: row.sourceLang,
      signals: asStringList(row.signals),
      captionWeak: Boolean(row.captionWeak),
      rawText: row.rawText,
      transcript: row.transcript,
    };
  } catch (error) {
    // A broken cache must never block the import.
    logger.warn({ err: (error as Error).message }, "analysis_cache_read_failed");
    return null;
  }
}

export async function writeAnalysisCache(entry: CacheableAnalysis): Promise<void> {
  try {
    const sql = db();
    await sql`
      insert into import_analysis_cache (
        url_key, source_url, version, draft, warnings, asks_for_screenshot,
        servings_estimated, source_lang, signals, caption_weak, raw_text, transcript
      ) values (
        ${entry.urlKey},
        ${entry.sourceUrl},
        ${CACHE_VERSION},
        ${sql.json(entry.draft as never)},
        ${sql.json(entry.warnings as never)},
        ${entry.asksForScreenshot},
        ${entry.servingsEstimated},
        ${entry.sourceLang},
        ${sql.json(entry.signals as never)},
        ${entry.captionWeak},
        ${entry.rawText},
        ${entry.transcript}
      )
      on conflict (url_key) do update set
        source_url = excluded.source_url,
        version = excluded.version,
        draft = excluded.draft,
        warnings = excluded.warnings,
        asks_for_screenshot = excluded.asks_for_screenshot,
        servings_estimated = excluded.servings_estimated,
        source_lang = excluded.source_lang,
        signals = excluded.signals,
        caption_weak = excluded.caption_weak,
        raw_text = excluded.raw_text,
        transcript = excluded.transcript,
        updated_at = now()
    `;
  } catch (error) {
    logger.warn({ err: (error as Error).message }, "analysis_cache_write_failed");
  }
}

import {
  AiExtractionError,
  AiUnavailableError,
  createProvider,
  createTranscriber,
  type ExtractionInput,
} from "@rezeptor/ai";
import {
  RecipeInput,
  type RecipeInput as RecipeInputType,
  type SourceType,
} from "@rezeptor/contracts";
import { normalizeDraft, sourceCacheKey, type RawDraft } from "@rezeptor/core";
import { logger } from "../config";
import { JobFailure } from "../errors";
import { assertPublicUrl } from "../fetch-source";
import { readAnalysisCache, writeAnalysisCache } from "../imports/analysis-cache";
import { loadLimits } from "../imports/limits";
import {
  prepareAudio,
  preparePdf,
  preparePhotos,
  type PreparedAudio,
} from "../imports/media-prepare";
import { isSocialUrl, prepareSource, type SourceMaterial } from "../imports/social";
import { prepareVideo, prepareVideoFile, videoSignals, type VideoMaterial } from "../imports/video";
import { SCREENSHOT_WARNING, germanWarnings } from "../imports/warnings";
import { MediaError } from "../media";
import { failJob, finishJob, setState, type JobRow } from "../queue";
import { notifyImportReady } from "./import-notify";
import { MissingToolError, ToolError } from "../tools";

const MAX_TEXT = 200_000;
const transcriber = createTranscriber();

type ImportKind = "photo" | "pdf" | "video" | "audio" | "text" | "link";

type ImportPayload = {
  kind: ImportKind;
  text: string | null;
  url: string | null;
  keys: string[];
};

const IMPORT_KINDS: ImportKind[] = ["photo", "pdf", "video", "audio", "text", "link"];

const SOURCE_TYPES: Record<ImportKind, SourceType> = {
  photo: "photo",
  pdf: "pdf",
  video: "video",
  audio: "text",
  text: "text",
  link: "link",
};

function readPayload(job: JobRow): ImportPayload {
  const payload = job.payload;
  const rawKind = typeof payload.kind === "string" ? payload.kind : job.kind.replace(/^import_/, "");
  if (!IMPORT_KINDS.includes(rawKind as ImportKind)) {
    throw new JobFailure("invalid_source", "Der Importtyp ist unbekannt.");
  }
  const keys = Array.isArray(payload.keys)
    ? payload.keys.filter((key): key is string => typeof key === "string" && key.length > 0)
    : [];
  return {
    kind: rawKind as ImportKind,
    text: typeof payload.text === "string" ? payload.text : null,
    url: typeof payload.url === "string" ? payload.url : null,
    keys,
  };
}

function truncate(value: string | null | undefined, max = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

type AppliedVideo = {
  extractionInput: ExtractionInput;
  rawText: string | null;
  transcript: string | null;
  imageKeys: string[];
  sourceKeys: string[];
  warnings: string[];
};

type AppliedSource = {
  extractionInput: ExtractionInput | null;
  jsonLdDraft: Record<string, unknown> | null;
  sourceLang: string | null;
  rawText: string | null;
  transcript: string | null;
  imageKeys: string[];
  sourceKeys: string[];
  warnings: string[];
  sourceUrl: string | null;
  sourceType: SourceType;
  signals: string[];
  captionWeak: boolean;
};

/**
 * One social/video material into model input. The caption is the first text,
 * then subtitles, then the author comment. Speech wins over raw audio; frames
 * ride along when they exist.
 */
async function applyVideoMaterial(
  video: VideoMaterial,
  url: string | null,
): Promise<AppliedVideo> {
  const warnings = [...video.warnings];
  const caption = truncate(video.caption);
  const authorComment = truncate(video.authorComment);
  const subtitles = truncate(video.captions);

  let videoSpeech: string | null = null;
  if (transcriber && video.audio) {
    try {
      const speech = await transcriber.transcribe(video.audio);
      videoSpeech = truncate(speech.text);
    } catch {
      warnings.push("Die Tonspur konnte nicht verschriftet werden.");
    }
  }

  if (!video.audio && !subtitles && !caption && !authorComment && video.images.length === 0) {
    throw new JobFailure(
      "source_blocked",
      "Das Video ließ sich ohne Anmeldung nicht laden. Es gibt auch keine Beschreibung, aus der ein Rezept entstehen könnte.",
    );
  }

  let extractionInput: ExtractionInput;
  if (videoSpeech) {
    extractionInput = {
      text: videoSpeech,
      images: video.images.length > 0 ? video.images : undefined,
      captions: subtitles ?? undefined,
      caption: caption ?? undefined,
      authorComment: authorComment ?? undefined,
      url: url ?? undefined,
    };
  } else if (video.audio) {
    extractionInput = {
      audio: video.audio,
      images: video.images.length > 0 ? video.images : undefined,
      captions: subtitles ?? undefined,
      caption: caption ?? undefined,
      authorComment: authorComment ?? undefined,
      url: url ?? undefined,
    };
  } else {
    // No speech and no audio: the post text and the frames are all that is left.
    extractionInput = {
      text: [video.title, caption, authorComment, subtitles].filter(Boolean).join("\n\n") || undefined,
      images: video.images.length > 0 ? video.images : undefined,
      url: url ?? undefined,
    };
  }

  return {
    extractionInput,
    rawText: video.rawText,
    transcript: videoSpeech ?? subtitles,
    imageKeys: video.coverKey ? [video.coverKey] : [],
    sourceKeys: video.sourceKeys,
    warnings,
  };
}

async function applySourceMaterial(material: SourceMaterial): Promise<AppliedSource> {
  if (material.kind === "link") {
    return {
      extractionInput: material.link.extraction,
      jsonLdDraft: material.link.jsonLd?.draft ?? null,
      sourceLang: material.link.jsonLd?.sourceLang ?? null,
      rawText: material.link.rawText,
      transcript: null,
      imageKeys: [],
      sourceKeys: [],
      warnings: material.warnings,
      sourceUrl: material.sourceUrl,
      sourceType: "link",
      signals: material.signals,
      captionWeak: material.captionWeak,
    };
  }

  const applied = await applyVideoMaterial(material.video, material.sourceUrl);
  return {
    ...applied,
    jsonLdDraft: null,
    sourceLang: null,
    warnings: [...material.warnings, ...applied.warnings],
    sourceUrl: material.sourceUrl,
    sourceType: "video",
    signals: material.signals,
    captionWeak: material.captionWeak,
  };
}

async function applyUploadedVideo(video: VideoMaterial): Promise<AppliedSource> {
  const applied = await applyVideoMaterial(video, null);
  return {
    ...applied,
    jsonLdDraft: null,
    sourceLang: null,
    sourceUrl: null,
    sourceType: "video",
    signals: videoSignals(video),
    captionWeak: false,
    warnings: applied.warnings,
  };
}

function toJobFailure(error: unknown): JobFailure {
  if (error instanceof JobFailure) return error;
  if (error instanceof AiUnavailableError) {
    return new JobFailure(
      "ai_unavailable",
      "Der KI-Dienst ist gerade nicht erreichbar. Bitte versuche es später erneut.",
      true,
    );
  }
  if (error instanceof AiExtractionError) {
    return new JobFailure(
      "extraction_failed",
      "Das Rezept konnte nicht sicher erkannt werden. Bitte versuche es erneut.",
      true,
    );
  }
  if (error instanceof MediaError) {
    return new JobFailure(
      "media_unavailable",
      "Der Medienspeicher ist gerade nicht erreichbar. Bitte versuche es später erneut.",
      true,
    );
  }
  if (
    error instanceof Error &&
    ("$metadata" in error || error.name.startsWith("S3") || error.name.includes("S3Service"))
  ) {
    return new JobFailure(
      "media_unavailable",
      "Der Medienspeicher ist gerade nicht erreichbar. Bitte versuche es später erneut.",
      true,
    );
  }
  if (error instanceof MissingToolError) {
    return new JobFailure(
      "tool_missing",
      "Für diesen Import fehlt auf dem Server ein benötigtes Werkzeug.",
    );
  }
  if (error instanceof ToolError) {
    logger.warn({ tool: error.tool, detail: error.message.slice(0, 300) }, "tool_failed");
    return new JobFailure("extraction_failed", "Die Quelle konnte nicht verarbeitet werden.", true);
  }
  logger.error({ err: error instanceof Error ? error.message : String(error) }, "import_unhandled");
  return new JobFailure("internal", "Beim Verarbeiten ist ein Fehler aufgetreten.", true);
}

export async function runImportJob(job: JobRow): Promise<void> {
  try {
    await processImport(job);
  } catch (error) {
    const failure = toJobFailure(error);
    await failJob(job, failure.code, failure.message, failure.retryable);
  }
}

async function processImport(job: JobRow): Promise<void> {
  const payload = readPayload(job);
  const limits = await loadLimits();
  const warnings: string[] = [];

  // One link is read once. A known link skips fetch, download and the model.
  const cacheKey = payload.url ? sourceCacheKey(payload.url) : null;
  if (cacheKey) {
    const cached = await readAnalysisCache(cacheKey);
    const parsedCached = cached ? RecipeInput.safeParse(cached.draft) : null;
    if (cached && parsedCached?.success) {
      await setState(job.id, "understanding", 90);
      const cachedPatch: Record<string, unknown> = {
        draft: parsedCached.data,
        warnings: cached.warnings,
        asksForScreenshot: cached.asksForScreenshot,
        servingsEstimated: cached.servingsEstimated,
        sourceLang: cached.sourceLang,
        keys: [],
        sourceKeys: [],
        signals: cached.signals,
        captionWeak: cached.captionWeak,
        cached: true,
      };
      if (cached.rawText) cachedPatch.rawText = cached.rawText;
      if (cached.transcript) cachedPatch.transcript = cached.transcript;
      await finishJob(job.id, "needs_review", cachedPatch);
      await notifyImportReady(job, parsedCached.data.title);
      logger.info(
        { jobId: job.id, kind: job.kind, state: "needs_review", cached: true },
        "import_finished",
      );
      return;
    }
  }

  await setState(job.id, "fetching", 10);

  let audio: PreparedAudio | null = null;
  let extractionInput: ExtractionInput | null = null;
  let jsonLdDraft: Record<string, unknown> | null = null;
  let sourceUrl: string | null = payload.url;
  let rawText: string | null = null;
  let transcript: string | null = null;
  let sourceLang: string | null = null;
  let imageKeys: string[] = [];
  let sourceKeys: string[] = payload.keys;
  let sourceSignals: string[] = [];
  let captionWeak = false;
  let sourceType: SourceType = SOURCE_TYPES[payload.kind];

  const assignSource = (applied: AppliedSource) => {
    extractionInput = applied.extractionInput;
    jsonLdDraft = applied.jsonLdDraft;
    sourceLang = applied.sourceLang;
    rawText = applied.rawText;
    transcript = applied.transcript;
    imageKeys = applied.imageKeys;
    sourceKeys = applied.sourceKeys;
    warnings.push(...applied.warnings);
    sourceUrl = applied.sourceUrl;
    sourceType = applied.sourceType;
    sourceSignals = applied.signals;
    captionWeak = applied.captionWeak;
  };

  switch (payload.kind) {
    case "photo": {
      const prepared = await preparePhotos(payload.keys, limits);
      extractionInput = { images: prepared.images };
      imageKeys = prepared.imageKeys;
      sourceKeys = prepared.sourceKeys;
      warnings.push(...prepared.warnings);
      break;
    }
    case "pdf": {
      const prepared = await preparePdf(payload.keys, limits);
      extractionInput = { images: prepared.images };
      imageKeys = prepared.imageKeys;
      sourceKeys = prepared.sourceKeys;
      warnings.push(...prepared.warnings);
      break;
    }
    case "audio": {
      audio = await prepareAudio(payload.keys, limits);
      sourceKeys = audio.sourceKeys;
      warnings.push(...audio.warnings);
      break;
    }
    case "video": {
      if (payload.url && isSocialUrl(payload.url)) {
        assignSource(await applySourceMaterial(await prepareSource(payload.url, limits)));
      } else if (payload.url) {
        await assertPublicUrl(payload.url);
        const video = await prepareVideo(payload.url, limits);
        assignSource(
          await applySourceMaterial({
            kind: "video",
            video,
            sourceUrl: payload.url,
            signals: videoSignals(video),
            warnings: [],
            captionWeak: false,
          }),
        );
      } else if (payload.keys.length > 0) {
        assignSource(await applyUploadedVideo(await prepareVideoFile(payload.keys, limits)));
      } else {
        throw new JobFailure("invalid_source", "Es wurde kein Video übermittelt.");
      }
      break;
    }
    case "link": {
      if (!payload.url) throw new JobFailure("invalid_source", "Es wurde keine Adresse übermittelt.");
      assignSource(await applySourceMaterial(await prepareSource(payload.url, limits)));
      break;
    }
    case "text": {
      const text = truncate(payload.text);
      if (!text) throw new JobFailure("invalid_source", "Es wurde kein Text übermittelt.");
      rawText = text;
      extractionInput = { text };
      break;
    }
  }

  await setState(job.id, "normalizing", 45);

  let draftRaw: Record<string, unknown>;
  let providerWarnings: string[] = [];
  let resultTranscript: string | null = null;
  let resultSourceLang: string | null = sourceLang;

  if (jsonLdDraft) {
    draftRaw = jsonLdDraft;
    await setState(job.id, "understanding", 65);
  } else {
    await setState(job.id, "understanding", 65);
    const provider = createProvider();

    if (audio) {
      const transcription = transcriber
        ? await transcriber.transcribe(audio.audio)
        : await provider.transcribe(audio.audio);
      transcript = truncate(transcription.text);
      if (!transcript) {
        throw new JobFailure(
          "extraction_failed",
          "In der Audiodatei war keine Sprache erkennbar.",
        );
      }
      extractionInput = { text: transcript };
    }

    if (!extractionInput) {
      throw new JobFailure("invalid_source", "Es lagen keine Daten für die Rezept-Erkennung vor.");
    }

    const result = await provider.extractRecipe(extractionInput);
    draftRaw = result.draft;
    providerWarnings = result.warnings;
    resultTranscript = truncate(result.transcript);
    resultSourceLang = result.sourceLang ?? sourceLang;
  }

  // The spoken word is a source too: a temperature said in the video must
  // reach the detector even when no step repeats it.
  const normalized = normalizeDraft({
    ...(draftRaw as RawDraft),
    transcript: transcript ?? resultTranscript ?? (draftRaw as RawDraft).transcript,
  });
  const recipe: RecipeInputType = {
    ...normalized.recipe,
    sourceType,
    sourceUrl: sourceUrl ?? normalized.recipe.sourceUrl ?? null,
    rawText: truncate(rawText ?? normalized.recipe.rawText),
    transcript: truncate(transcript ?? resultTranscript ?? normalized.recipe.transcript),
    originalLang: truncate(normalized.sourceLang ?? resultSourceLang, 16),
  };

  const parsed = RecipeInput.safeParse(recipe);
  if (!parsed.success) {
    logger.warn(
      { jobId: job.id, issues: parsed.error.issues.map((issue) => issue.path.join(".")) },
      "draft_schema_invalid",
    );
    throw new JobFailure("extraction_failed", "Das erkannte Rezept konnte nicht gespeichert werden.");
  }

  const allWarnings = germanWarnings([...warnings, ...providerWarnings, ...normalized.warnings]);
  if (normalized.asksForScreenshot && !allWarnings.includes(SCREENSHOT_WARNING)) {
    allWarnings.push(SCREENSHOT_WARNING);
  }

  const patch: Record<string, unknown> = {
    draft: parsed.data,
    warnings: allWarnings,
    asksForScreenshot: normalized.asksForScreenshot,
    servingsEstimated: normalized.servingsEstimated,
    sourceLang: parsed.data.originalLang,
    keys: imageKeys,
    sourceKeys,
    signals: sourceSignals,
    captionWeak,
  };
  if (parsed.data.rawText) patch.rawText = parsed.data.rawText;
  if (parsed.data.transcript) patch.transcript = parsed.data.transcript;

  // Keep the result for the next import of the same link.
  if (cacheKey && sourceUrl) {
    await writeAnalysisCache({
      urlKey: cacheKey,
      sourceUrl,
      draft: parsed.data,
      warnings: allWarnings,
      asksForScreenshot: normalized.asksForScreenshot,
      servingsEstimated: normalized.servingsEstimated,
      sourceLang: parsed.data.originalLang ?? null,
      signals: sourceSignals,
      captionWeak,
      rawText: typeof patch.rawText === "string" ? patch.rawText : null,
      transcript: typeof patch.transcript === "string" ? patch.transcript : null,
    });
  }

  await finishJob(job.id, "needs_review", patch);
  await notifyImportReady(job, parsed.data.title);

  logger.info(
    {
      jobId: job.id,
      kind: job.kind,
      state: "needs_review",
      warnings: allWarnings.length,
      asksForScreenshot: normalized.asksForScreenshot,
    },
    "import_finished",
  );
}

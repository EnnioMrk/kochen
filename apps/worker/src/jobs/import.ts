import {
  AiExtractionError,
  AiUnavailableError,
  createProvider,
  createTranscriber,
  type ExtractionInput,
} from "@kochen/ai";
import {
  RecipeInput,
  type RecipeInput as RecipeInputType,
  type SourceType,
} from "@kochen/contracts";
import { normalizeDraft, type RawDraft } from "@kochen/core";
import { logger } from "../config";
import { JobFailure } from "../errors";
import { assertPublicUrl } from "../fetch-source";
import { prepareLink } from "../imports/link";
import { loadLimits } from "../imports/limits";
import {
  prepareAudio,
  preparePdf,
  preparePhotos,
  type PreparedAudio,
} from "../imports/media-prepare";
import { prepareVideo, prepareVideoFile, type VideoMaterial } from "../imports/video";
import { SCREENSHOT_WARNING, germanWarnings } from "../imports/warnings";
import { MediaError } from "../media";
import { failJob, finishJob, setState, type JobRow } from "../queue";
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
      let video: VideoMaterial;
      if (payload.url) {
        await assertPublicUrl(payload.url);
        video = await prepareVideo(payload.url, limits);
        sourceUrl = payload.url;
      } else if (payload.keys.length > 0) {
        video = await prepareVideoFile(payload.keys, limits);
      } else {
        throw new JobFailure("invalid_source", "Es wurde kein Video übermittelt.");
      }
      let videoSpeech: string | null = null;
      if (transcriber && video.audio) {
        try {
          const speech = await transcriber.transcribe(video.audio);
          videoSpeech = truncate(speech.text);
          transcript = videoSpeech;
        } catch (error) {
          warnings.push("Die Tonspur konnte nicht verschriftet werden.");
        }
      }
      if (!video.audio && !video.captions && !video.authorComment) {
        throw new JobFailure(
          "source_blocked",
          "Das Video ließ sich ohne Anmeldung nicht laden. Es gibt auch keine Beschreibung, aus der ein Rezept entstehen könnte.",
        );
      }
      if (videoSpeech) {
        extractionInput = {
          text: videoSpeech,
          images: video.images.length > 0 ? video.images : undefined,
          captions: video.captions ?? undefined,
          authorComment: video.authorComment ?? undefined,
          url: payload.url ?? undefined,
        };
      } else if (video.audio) {
        extractionInput = {
          audio: video.audio,
          images: video.images.length > 0 ? video.images : undefined,
          captions: video.captions ?? undefined,
          authorComment: video.authorComment ?? undefined,
          url: payload.url ?? undefined,
        };
      } else {
        // Blocked media: title, captions and the description are all that is left.
        extractionInput = {
          text: [video.title, video.captions, video.authorComment]
            .filter(Boolean)
            .join("\n\n"),
          url: payload.url ?? undefined,
        };
      }
      rawText = video.rawText;
      transcript = videoSpeech ?? video.captions;
      imageKeys = video.coverKey ? [video.coverKey] : [];
      sourceKeys = video.sourceKeys;
      warnings.push(...video.warnings);
      break;
    }
    case "link": {
      if (!payload.url) throw new JobFailure("invalid_source", "Es wurde keine Adresse übermittelt.");
      const link = await prepareLink(payload.url);
      sourceUrl = link.sourceUrl;
      rawText = link.rawText;
      extractionInput = link.extraction;
      if (link.jsonLd) {
        jsonLdDraft = link.jsonLd.draft;
        sourceLang = link.jsonLd.sourceLang;
      }
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

  const normalized = normalizeDraft(draftRaw as RawDraft);
  const recipe: RecipeInputType = {
    ...normalized.recipe,
    sourceType: SOURCE_TYPES[payload.kind],
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
  };
  if (parsed.data.rawText) patch.rawText = parsed.data.rawText;
  if (parsed.data.transcript) patch.transcript = parsed.data.transcript;

  await finishJob(job.id, "needs_review", patch);
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

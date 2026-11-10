import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { Limits } from "@kochen/contracts";
import { env } from "../config";
import { JobFailure } from "../errors";
import { getObject, mediaKey, putObject } from "../media";
import { sniffAudio } from "../media-inspect";
import { formatMinutes, probeDuration } from "./media-prepare";
import { run, runOrFail } from "../tools";

const MB = 1024 * 1024;
// Audio plus up to 12 frames must stay below the inline model request limit.
const MAX_INLINE_AUDIO_BYTES = 9 * MB;
const MAX_FRAMES = 12;
const FRAME_INTERVAL_SECONDS = 5;
const MAX_FRAME_EDGE = 768;

export type VideoMaterial = {
  audio: { data: string; mime: string };
  images: Array<{ data: string; mime: string }>;
  captions: string | null;
  authorComment: string | null;
  rawText: string | null;
  coverKey: string | null;
  sourceKeys: string[];
  warnings: string[];
  title: string | null;
  durationS: number | null;
};

const MISSING_YTDLP = "Video-Import ist nicht verfügbar: yt-dlp fehlt auf dem Server.";
const MISSING_FFMPEG = "Video-Import ist nicht verfügbar: ffmpeg fehlt auf dem Server.";

/** A URL source: metadata first, then the duration limit. Never cut. */
export async function prepareVideo(url: string, limits: Limits): Promise<VideoMaterial> {
  const dir = await mkdtemp(join(env.tmpRoot, "kochen-video-"));
  try {
    const meta = await fetchMetadata(url, dir);
    const durationS = typeof meta.duration === "number" && meta.duration > 0 ? meta.duration : null;
    assertDuration(durationS, limits);

    const warnings: string[] = [];
    if (durationS === null) warnings.push("Die Länge des Videos konnte nicht geprüft werden.");

    const description =
      typeof meta.description === "string" ? meta.description.trim().slice(0, 8000) : null;
    const title = typeof meta.title === "string" ? meta.title.slice(0, 200) : null;

    const captions = await fetchCaptions(url, dir, warnings);
    const audioInput = await downloadAudio(url, dir);
    const audio = await convertAudio(audioInput, dir, warnings);
    const videoInput = await downloadVideo(url, dir, warnings);
    const frames = videoInput ? await extractFrames(videoInput, dir, warnings) : [];
    const coverKey = await saveCover(frames, warnings);

    return {
      audio,
      images: frames.map((frame) => ({ data: frame.toString("base64"), mime: "image/jpeg" })),
      captions,
      authorComment: description,
      rawText: description,
      coverKey,
      sourceKeys: [],
      warnings,
      title,
      durationS,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** An uploaded video file (keys path). Same pipeline, no yt-dlp. */
export async function prepareVideoFile(keys: string[], limits: Limits): Promise<VideoMaterial> {
  const key = keys[0];
  if (!key) throw new JobFailure("invalid_source", "Es wurde kein Video übermittelt.");

  const bytes = await getObject(key);
  if (bytes.byteLength > limits.maxTotalMb * MB) {
    throw new JobFailure(
      "limit_exceeded",
      `Das Video ist ${(bytes.byteLength / MB).toFixed(1).replace(".", ",")} MB groß. Erlaubt sind höchstens ${limits.maxTotalMb} MB.`,
    );
  }
  const info = sniffAudio(bytes);
  if (!info) {
    throw new JobFailure(
      "invalid_source",
      "Das Video hat ein unbekanntes Format. Erlaubt sind MP4, MOV, WebM und M4V.",
    );
  }

  const dir = await mkdtemp(join(env.tmpRoot, "kochen-video-"));
  try {
    const input = join(dir, `source.${info.extension}`);
    await writeFile(input, bytes);

    const warnings: string[] = [];
    const durationS = await probeDuration(input);
    assertDuration(durationS, limits);
    if (durationS === null) warnings.push("Die Länge des Videos konnte nicht geprüft werden.");

    const audio = await convertAudio(input, dir, warnings);
    const frames = await extractFrames(input, dir, warnings);
    const coverKey = await saveCover(frames, warnings);

    return {
      audio,
      images: frames.map((frame) => ({ data: frame.toString("base64"), mime: "image/jpeg" })),
      captions: null,
      authorComment: null,
      rawText: null,
      coverKey,
      sourceKeys: [key],
      warnings,
      title: null,
      durationS,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function assertDuration(durationS: number | null, limits: Limits): void {
  if (durationS !== null && durationS > limits.maxVideoMinutes * 60) {
    throw new JobFailure(
      "limit_exceeded",
      `Das Video dauert ${formatMinutes(durationS)}. Erlaubt sind höchstens ${limits.maxVideoMinutes} Minuten.`,
    );
  }
}

async function saveCover(frames: Buffer[], warnings: string[]): Promise<string | null> {
  const first = frames[0];
  if (!first) return null;
  try {
    const cover = await sharp(first)
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    const key = mediaKey("imports/video", "cover.jpg");
    await putObject(key, cover, "image/jpeg");
    return key;
  } catch {
    warnings.push("Das Vorschaubild konnte nicht gespeichert werden.");
    return null;
  }
}

async function fetchMetadata(url: string, dir: string): Promise<Record<string, unknown>> {
  let stdout: string;
  try {
    const result = await runOrFail(
      "yt-dlp",
      ["--dump-single-json", "--no-playlist", "--no-warnings", "-o", join(dir, "meta.%(ext)s"), url],
      MISSING_YTDLP,
      { timeoutMs: 120_000, maxBuffer: 64 * MB },
    );
    stdout = result.stdout;
  } catch (error) {
    if (error instanceof JobFailure) throw error;
    throw new JobFailure(
      "source_unavailable",
      "Das Video konnte nicht geladen werden. Die Plattform blockiert möglicherweise den Zugriff.",
      true,
    );
  }
  const line = stdout.trim().split("\n")[0] ?? "";
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    throw new JobFailure("source_unavailable", "Die Videodaten konnten nicht gelesen werden.", true);
  }
}

async function fetchCaptions(url: string, dir: string, warnings: string[]): Promise<string | null> {
  try {
    await run(
      "yt-dlp",
      [
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        "de,en",
        "--sub-format",
        "vtt",
        "--no-playlist",
        "--no-warnings",
        "-o",
        join(dir, "subs.%(ext)s"),
        url,
      ],
      { timeoutMs: 120_000, maxBuffer: 8 * MB },
    );
  } catch {
    return null;
  }
  const files = (await readdir(dir)).filter(
    (name) => name.startsWith("subs.") && name.endsWith(".vtt"),
  );
  if (files.length === 0) return null;
  files.sort((a, b) => {
    const score = (name: string) => (name.includes(".de.") ? 0 : name.includes(".en.") ? 1 : 2);
    return score(a) - score(b);
  });
  const file = files[0];
  if (!file) return null;
  try {
    const raw = await readFile(join(dir, file), "utf8");
    const text = cleanVtt(raw);
    if (!text) return null;
    return text.slice(0, 40_000);
  } catch {
    warnings.push("Die Untertitel des Videos konnten nicht gelesen werden.");
    return null;
  }
}

function cleanVtt(raw: string): string {
  return raw
    .replace(/^WEBVTT[^\n]*/i, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^\d+$/.test(line)) return false;
      if (line.includes("-->")) return false;
      if (/^(NOTE|STYLE|REGION)\b/.test(line)) return false;
      return true;
    })
    .map((line) => line.replace(/<[^>]+>/g, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function downloadAudio(url: string, dir: string): Promise<string> {
  try {
    await runOrFail(
      "yt-dlp",
      ["-f", "bestaudio", "--no-playlist", "--no-warnings", "-o", join(dir, "audio.%(ext)s"), url],
      MISSING_YTDLP,
      { timeoutMs: 10 * 60_000, maxBuffer: 8 * MB },
    );
  } catch (error) {
    if (error instanceof JobFailure) throw error;
    throw new JobFailure(
      "extraction_failed",
      "Die Tonspur des Videos konnte nicht geladen werden.",
      true,
    );
  }
  const files = (await readdir(dir)).filter(
    (name) => name.startsWith("audio.") && !name.endsWith(".part"),
  );
  const input = files[0];
  if (!input) throw new JobFailure("extraction_failed", "Das Video enthält keine lesbare Tonspur.");
  return join(dir, input);
}

async function convertAudio(
  input: string,
  dir: string,
  warnings: string[],
): Promise<{ data: string; mime: string }> {
  const wavPath = join(dir, "audio.wav");
  try {
    await runOrFail(
      "ffmpeg",
      ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath],
      MISSING_FFMPEG,
      { timeoutMs: 10 * 60_000, maxBuffer: 8 * MB },
    );
  } catch (error) {
    if (error instanceof JobFailure) throw error;
    throw new JobFailure("extraction_failed", "Die Tonspur des Videos konnte nicht umgewandelt werden.");
  }

  // Keep the canonical 16 kHz mono PCM WAV. Parakeet TDT rejects other rates.
  const bytes = await readFile(wavPath);
  return { data: bytes.toString("base64"), mime: "audio/wav" };
}

async function downloadVideo(
  url: string,
  dir: string,
  warnings: string[],
): Promise<string | null> {
  try {
    await run(
      "yt-dlp",
      [
        "-f",
        "bv*[height<=480]/b[height<=480]/b",
        "--no-playlist",
        "--no-warnings",
        "--max-filesize",
        "400M",
        "-o",
        join(dir, "video.%(ext)s"),
        url,
      ],
      { timeoutMs: 10 * 60_000, maxBuffer: 8 * MB },
    );
  } catch {
    warnings.push("Es konnten keine Einzelbilder aus dem Video gelesen werden.");
    return null;
  }
  const files = (await readdir(dir)).filter(
    (name) => name.startsWith("video.") && !name.endsWith(".part"),
  );
  const input = files[0];
  return input ? join(dir, input) : null;
}

async function extractFrames(
  input: string,
  dir: string,
  warnings: string[],
): Promise<Buffer[]> {
  try {
    await run(
      "ffmpeg",
      [
        "-y",
        "-i",
        input,
        "-vf",
        `fps=1/${FRAME_INTERVAL_SECONDS}`,
        "-frames:v",
        String(MAX_FRAMES),
        "-q:v",
        "4",
        join(dir, "frame-%02d.jpg"),
      ],
      { timeoutMs: 5 * 60_000, maxBuffer: 8 * MB },
    );
  } catch {
    warnings.push("Es konnten keine Einzelbilder aus dem Video gelesen werden.");
    return [];
  }

  const files = (await readdir(dir))
    .filter((name) => name.startsWith("frame-") && name.endsWith(".jpg"))
    .sort();
  const images: Buffer[] = [];
  for (const frame of files.slice(0, MAX_FRAMES)) {
    try {
      const raw = await readFile(join(dir, frame));
      const resized = await sharp(raw)
        .resize({
          width: MAX_FRAME_EDGE,
          height: MAX_FRAME_EDGE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
      images.push(resized);
    } catch {
      // A single unreadable frame must not lose the import.
    }
  }
  return images;
}

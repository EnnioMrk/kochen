import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { Limits } from "@rezeptor/contracts";
import { env } from "../config";
import { JobFailure } from "../errors";
import { getObject, mediaKey, putObject } from "../media";
import { sniffAudio } from "../media-inspect";
import { formatMinutes, probeDuration } from "./media-prepare";
import { loginArgs, platformOf } from "./platform-login";
import { instagramLoginProblem } from "./instagram-session";
import { platformLabel, publicVideoInfo } from "./public-video";
import { YTDLP_JS_ARGS } from "./ytdlp";
import { run, runOrFail } from "../tools";

const MB = 1024 * 1024;
// Audio plus up to 12 frames must stay below the inline model request limit.
const MAX_INLINE_AUDIO_BYTES = 9 * MB;
const MAX_FRAMES = 12;
const MAX_CAROUSEL_SLIDES = 10;
const MAX_SLIDE_BYTES = 5 * MB;
const FRAME_INTERVAL_SECONDS = 5;
const MAX_FRAME_EDGE = 768;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type VideoMaterial = {
  /** Null when the platform would not serve the media without a login. */
  audio: { data: string; mime: string } | null;
  images: Array<{ data: string; mime: string }>;
  /** Subtitles or a caption track. Not the public post caption. */
  captions: string | null;
  /** The public post text under the video or photo. */
  caption: string | null;
  /** True when the post is a carousel and its slides were read. */
  carousel: boolean;
  /** The author's own comment, when a source can provide it. */
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

/** The cookie file that loginArgs wrote, so the caption fallback can use it. */
async function readCookies(dir: string): Promise<string | null> {
  try {
    return await readFile(join(dir, "cookies.txt"), "utf8");
  } catch {
    return null;
  }
}

/** A URL source: metadata first, then the duration limit. Never cut. */
export async function prepareVideo(url: string, limits: Limits): Promise<VideoMaterial> {
  const dir = await mkdtemp(join(env.tmpRoot, "rezeptor-video-"));
  try {
    const auth = await loginArgs(url, dir);
    let meta: Record<string, unknown>;
    try {
      // A carousel is a playlist. Instagram needs the entries to read slides.
      meta = await fetchMetadata(url, dir, auth, platformOf(url) === "instagram");
    } catch (error) {
      // No media access. A draft from title and description still helps.
      const cookies = await readCookies(dir);
      const info = await publicVideoInfo(url, cookies);
      if (!info) {
        if (platformOf(url) === "instagram") {
          const problem = instagramLoginProblem();
          const base =
            "Instagram gibt diesen Beitrag nicht ohne Anmeldung frei. Das Konto ist altersbeschränkt oder privat, oder Instagram drosselt den Abruf.";
          throw new JobFailure(
            "source_blocked",
            problem
              ? `${base} ${problem}`
              : `${base} Hinterlege im Admin die Cookies einer angemeldeten Instagram-Sitzung und versuche es erneut.`,
          );
        }
        throw error;
      }
      const text = [info.title, info.description].filter(Boolean).join("\n\n");
      return {
        audio: null,
        images: [],
        captions: null,
        caption: info.description,
        carousel: false,
        authorComment: null,
        rawText: text || null,
        coverKey: null,
        sourceKeys: [],
        warnings: [
          `${platformLabel(platformOf(url))} hat den Abruf von Ton und Bildern abgelehnt. Der Entwurf stammt aus Titel und Beschreibung. Prüfe ihn besonders genau.`,
        ],
        title: info.title,
        durationS: null,
      };
    }
    const durationS = typeof meta.duration === "number" && meta.duration > 0 ? meta.duration : null;
    assertDuration(durationS, limits);

    const warnings: string[] = [];
    if (durationS === null) warnings.push("Die Länge des Videos konnte nicht geprüft werden.");

    const description =
      typeof meta.description === "string" ? meta.description.trim().slice(0, 8000) : null;
    const title = typeof meta.title === "string" ? meta.title.slice(0, 200) : null;

    const captions = await fetchCaptions(url, dir, warnings, auth);

    // The caption is enough for a draft. A refused audio stream must not lose it.
    let audio: { data: string; mime: string } | null = null;
    try {
      const audioInput = await downloadAudio(url, dir, auth);
      audio = await convertAudio(audioInput, dir, warnings);
    } catch (error) {
      if (error instanceof JobFailure && error.code === "tool_missing") throw error;
      warnings.push("Die Tonspur konnte nicht geladen werden. Der Entwurf stammt aus Text und Bildern.");
    }

    const videoInput = await downloadVideo(url, dir, warnings, auth);
    const frames = videoInput ? await extractFrames(videoInput, dir, warnings) : [];
    const slides = platformOf(url) === "instagram" ? await downloadCarouselImages(meta, warnings) : [];
    const images = [...frames, ...slides].slice(0, MAX_FRAMES);
    const coverKey = await saveCover(images, warnings);

    return {
      audio,
      images: images.map((frame) => ({ data: frame.toString("base64"), mime: "image/jpeg" })),
      captions,
      caption: description,
      carousel: slides.length > 0,
      authorComment: null,
      rawText: [title, description].filter(Boolean).join("\n\n") || null,
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

  const dir = await mkdtemp(join(env.tmpRoot, "rezeptor-video-"));
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
      caption: null,
      carousel: false,
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

/** Stable codes for the review screen. They say what the worker read. */
export function videoSignals(video: VideoMaterial): string[] {
  const signals: string[] = [];
  if (video.caption?.trim()) signals.push("caption");
  if (video.captions?.trim()) signals.push("subtitles");
  if (video.audio) signals.push("audio");
  if (video.images.length > 0) signals.push("frames");
  if (video.carousel) signals.push("carousel");
  if (video.authorComment?.trim()) signals.push("author-comment");
  return signals;
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

async function fetchMetadata(
  url: string,
  dir: string,
  auth: string[],
  allowPlaylist: boolean,
): Promise<Record<string, unknown>> {
  let stdout: string;
  try {
    const result = await runOrFail(
      "yt-dlp",
      [
        "--dump-single-json",
        ...(allowPlaylist ? [] : ["--no-playlist"]),
        "--no-warnings",
        ...YTDLP_JS_ARGS,
        ...auth,
        "-o",
        join(dir, "meta.%(ext)s"),
        url,
      ],
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

function isInstagramCdn(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === "cdninstagram.com" ||
      host.endsWith(".cdninstagram.com") ||
      host === "fbcdn.net" ||
      host.endsWith(".fbcdn.net")
    );
  } catch {
    return false;
  }
}

/** The largest image URL of every carousel entry, in slide order. */
export function carouselThumbnails(meta: Record<string, unknown>): string[] {
  const entries = Array.isArray(meta.entries) ? meta.entries : [];
  const urls: string[] = [];
  for (const entry of entries.slice(0, MAX_CAROUSEL_SLIDES)) {
    if (!entry || typeof entry !== "object") continue;
    const thumbs = Array.isArray((entry as { thumbnails?: unknown }).thumbnails)
      ? ((entry as { thumbnails?: unknown }).thumbnails as unknown[])
      : [];
    let best: { url: string; area: number } | null = null;
    for (const thumb of thumbs) {
      if (!thumb || typeof thumb !== "object") continue;
      const item = thumb as { url?: unknown; width?: unknown; height?: unknown };
      if (typeof item.url !== "string" || !isInstagramCdn(item.url)) continue;
      const width = typeof item.width === "number" ? item.width : 0;
      const height = typeof item.height === "number" ? item.height : 0;
      const area = width * height;
      if (!best || area > best.area) best = { url: item.url, area };
    }
    if (best && !urls.includes(best.url)) urls.push(best.url);
  }
  return urls;
}

async function downloadCarouselImages(
  meta: Record<string, unknown>,
  warnings: string[],
): Promise<Buffer[]> {
  const urls = carouselThumbnails(meta);
  if (urls.length === 0) return [];
  const images: Buffer[] = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": UA },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) continue;
      const type = response.headers.get("content-type") ?? "";
      if (!type.startsWith("image/")) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > MAX_SLIDE_BYTES) continue;
      const resized = await sharp(bytes)
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
      // One broken slide must not lose the post.
    }
  }
  if (images.length === 0) {
    warnings.push("Die Bilder des Karussells konnten nicht geladen werden.");
  }
  return images;
}

async function fetchCaptions(url: string, dir: string, warnings: string[], auth: string[]): Promise<string | null> {
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
        ...YTDLP_JS_ARGS,
        ...auth,
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

async function downloadAudio(url: string, dir: string, auth: string[]): Promise<string> {
  try {
    await runOrFail(
      "yt-dlp",
      ["-f", "bestaudio", "--no-playlist", "--no-warnings", ...YTDLP_JS_ARGS, ...auth, "-o", join(dir, "audio.%(ext)s"), url],
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
  auth: string[],
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
        ...YTDLP_JS_ARGS,
        ...auth,
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

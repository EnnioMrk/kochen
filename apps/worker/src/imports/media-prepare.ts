import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import heicConvert from "heic-convert";
import sharp from "sharp";
import type { Limits } from "@kochen/contracts";
import { env } from "../config";
import { JobFailure } from "../errors";
import { derivedKey, getObject, putObject } from "../media";
import { isPdf, sniffAudio, sniffImage, type ImageFormat } from "../media-inspect";
import { runOrFail } from "../tools";

const MB = 1024 * 1024;
const MAX_MODEL_EDGE = 2048;
const VARIANT_WIDTHS = [320, 800, 1600] as const;
const MAX_INLINE_AUDIO_BYTES = 13 * MB;

/**
 * Read the uploaded source from the media store. A failed getObject (missing
 * object, wrong credentials, S3 or network error) must read as storage, not as
 * an unreadable photo.
 */
async function readSource(key: string): Promise<Uint8Array> {
  try {
    return await getObject(key);
  } catch {
    throw new JobFailure(
      "media_unavailable",
      "Der Medienspeicher ist nicht erreichbar oder die Datei fehlt dort.",
    );
  }
}

export type ModelImage = { data: string; mime: string };

export type PreparedImages = {
  images: ModelImage[];
  /** Keys for the images table (processed variants, never the raw upload). */
  imageKeys: string[];
  /** Original upload keys, kept for cleanup. */
  sourceKeys: string[];
  warnings: string[];
};

export type PreparedAudio = {
  audio: { data: string; mime: string };
  sourceKeys: string[];
  warnings: string[];
};

/* ------------------------------------------------------------------- photo */

async function jpegSource(
  bytes: Uint8Array,
  format: ImageFormat,
  warnings: string[],
): Promise<Buffer> {
  if (format !== "heic") return Buffer.from(bytes);
  try {
    return await sharp(Buffer.from(bytes), { limitInputPixels: 40_000_000, failOn: "none" })
      .rotate()
      .jpeg({ quality: 92 })
      .toBuffer();
  } catch {
    warnings.push("Das HEIC-Foto wurde über den Ersatzpfad umgewandelt. Bitte prüfe die Bildqualität.");
    try {
      const converted = await heicConvert({
        buffer: Buffer.from(bytes),
        format: "JPEG",
        quality: 0.9,
      });
      return Buffer.from(converted);
    } catch {
      throw new JobFailure(
        "extraction_failed",
        "Das HEIC-Foto konnte nicht gelesen werden. Bitte lade es als JPEG hoch.",
      );
    }
  }
}

async function renderJpeg(input: Buffer, edge: number, quality: number): Promise<Buffer> {
  return sharp(input, { limitInputPixels: 40_000_000, failOn: "none" })
    .rotate()
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

/** Download, validate, convert and derive the display variants of photos. */
export async function preparePhotos(keys: string[], limits: Limits): Promise<PreparedImages> {
  if (keys.length === 0) {
    throw new JobFailure("invalid_source", "Es wurden keine Fotos übermittelt.");
  }
  if (keys.length > limits.maxPhotos) {
    throw new JobFailure(
      "limit_exceeded",
      `Es wurden ${keys.length} Fotos übermittelt. Erlaubt sind höchstens ${limits.maxPhotos}.`,
    );
  }

  const images: ModelImage[] = [];
  const imageKeys: string[] = [];
  const warnings: string[] = [];
  let total = 0;

  for (const key of keys) {
    const bytes = await readSource(key);
    total += bytes.byteLength;
    if (bytes.byteLength > limits.maxPhotoMb * MB) {
      throw new JobFailure(
        "limit_exceeded",
        `Ein Foto ist ${formatMb(bytes.byteLength)} groß. Erlaubt sind höchstens ${limits.maxPhotoMb} MB pro Foto.`,
      );
    }
    if (total > limits.maxTotalMb * MB) {
      throw new JobFailure(
        "limit_exceeded",
        `Die Fotos sind zusammen ${formatMb(total)} groß. Erlaubt sind höchstens ${limits.maxTotalMb} MB.`,
      );
    }

    const format = sniffImage(bytes);
    if (!format) {
      throw new JobFailure("invalid_source", "Das Foto ist keine gültige Bilddatei oder beschädigt.");
    }

    const jpeg = await jpegSource(bytes, format, warnings);
    const model = await renderJpeg(jpeg, MAX_MODEL_EDGE, 85);
    images.push({ data: model.toString("base64"), mime: "image/jpeg" });

    let displayKey: string | null = null;
    for (const width of VARIANT_WIDTHS) {
      const variant = await renderJpeg(jpeg, width, 82);
      const variantKey = derivedKey(key, String(width), "jpg");
      await putObject(variantKey, variant, "image/jpeg");
      if (width === 1600) displayKey = variantKey;
    }
    if (displayKey) imageKeys.push(displayKey);
  }

  return { images, imageKeys, sourceKeys: keys, warnings };
}

/* --------------------------------------------------------------------- pdf */

/** Render the first `limits.maxPdfPages` pages (plus one probe) at 200 DPI. */
export async function preparePdf(keys: string[], limits: Limits): Promise<PreparedImages> {
  const key = keys[0];
  if (!key) throw new JobFailure("invalid_source", "Es wurde kein PDF übermittelt.");

  const bytes = await readSource(key);
  if (bytes.byteLength > limits.maxTotalMb * MB) {
    throw new JobFailure(
      "limit_exceeded",
      `Das PDF ist ${formatMb(bytes.byteLength)} groß. Erlaubt sind höchstens ${limits.maxTotalMb} MB.`,
    );
  }
  if (!isPdf(bytes)) {
    throw new JobFailure("invalid_source", "Die Datei ist kein gültiges PDF.");
  }

  const dir = await mkdtemp(join(env.tmpRoot, "kochen-pdf-"));
  try {
    const pdfPath = join(dir, "source.pdf");
    await writeFile(pdfPath, bytes);
    const prefix = join(dir, "page");
    const probePages = limits.maxPdfPages + 1;
    try {
      await runOrFail(
        "pdftoppm",
        ["-r", "200", "-jpeg", "-f", "1", "-l", String(probePages), pdfPath, prefix],
        "PDF-Import ist nicht verfügbar: pdftoppm (poppler-utils) fehlt auf dem Server.",
        { timeoutMs: 180_000, maxBuffer: 8 * MB },
      );
    } catch (error) {
      if (error instanceof JobFailure) throw error;
      throw new JobFailure("extraction_failed", "Aus dem PDF konnten keine Seiten gelesen werden.");
    }

    const files = (await readdir(dir))
      .filter((name) => name.toLowerCase().endsWith(".jpg"))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    if (files.length === 0) {
      throw new JobFailure("extraction_failed", "Aus dem PDF konnten keine Seiten gelesen werden.");
    }
    if (files.length > limits.maxPdfPages) {
      throw new JobFailure(
        "limit_exceeded",
        `Das PDF hat mehr als ${limits.maxPdfPages} Seiten. Erlaubt sind höchstens ${limits.maxPdfPages}.`,
      );
    }

    const images: ModelImage[] = [];
    const warnings: string[] = [];
    let coverKey: string | null = null;
    for (const [index, file] of files.entries()) {
      const page = await readFile(join(dir, file));
      const model = await renderJpeg(page, MAX_MODEL_EDGE, 85);
      images.push({ data: model.toString("base64"), mime: "image/jpeg" });
      if (index === 0) {
        const cover = await renderJpeg(page, 1600, 82);
        coverKey = derivedKey(key, "cover", "jpg");
        await putObject(coverKey, cover, "image/jpeg");
      }
    }
    return {
      images,
      imageKeys: coverKey ? [coverKey] : [],
      sourceKeys: [key],
      warnings,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------------- audio */

/** Download audio, check its duration and make it fit the inline model limit. */
export async function prepareAudio(keys: string[], limits: Limits): Promise<PreparedAudio> {
  const key = keys[0];
  if (!key) throw new JobFailure("invalid_source", "Es wurde keine Audiodatei übermittelt.");

  const bytes = await readSource(key);
  if (bytes.byteLength > limits.maxTotalMb * MB) {
    throw new JobFailure(
      "limit_exceeded",
      `Die Audiodatei ist ${formatMb(bytes.byteLength)} groß. Erlaubt sind höchstens ${limits.maxTotalMb} MB.`,
    );
  }
  const info = sniffAudio(bytes);
  if (!info) {
    throw new JobFailure(
      "invalid_source",
      "Die Audiodatei hat ein unbekanntes Format. Erlaubt sind MP3, M4A, WAV, WebM und OGG.",
    );
  }

  const warnings: string[] = [];
  const dir = await mkdtemp(join(env.tmpRoot, "kochen-audio-"));
  try {
    const inputPath = join(dir, `source.${info.extension}`);
    await writeFile(inputPath, bytes);

    const duration = await probeDuration(inputPath);
    if (duration !== null && duration > limits.maxAudioMinutes * 60) {
      throw new JobFailure(
        "limit_exceeded",
        `Die Audiodatei dauert ${formatMinutes(duration)}. Erlaubt sind höchstens ${limits.maxAudioMinutes} Minuten.`,
      );
    }
    if (duration === null) {
      warnings.push("Die Länge der Audiodatei konnte nicht geprüft werden.");
    }

    // Parakeet TDT needs 16 kHz mono PCM WAV. One canonical form for every
    // provider; the ASR service rejects other sample rates.
    const wavPath = join(dir, "audio.wav");
    try {
      await runOrFail(
        "ffmpeg",
        ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath],
        "Audio-Import ist nicht verfügbar: ffmpeg fehlt auf dem Server.",
        { timeoutMs: 300_000, maxBuffer: 8 * MB },
      );
    } catch (error) {
      if (error instanceof JobFailure) throw error;
      throw new JobFailure("extraction_failed", "Die Audiodatei konnte nicht verarbeitet werden.");
    }
    const wav = await readFile(wavPath);
    return {
      audio: { data: wav.toString("base64"), mime: "audio/wav" },
      sourceKeys: [key],
      warnings,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function probeDuration(path: string): Promise<number | null> {
  let stdout: string;
  try {
    const result = await runOrFail(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
      "Medien-Import ist nicht verfügbar: ffprobe (ffmpeg) fehlt auf dem Server.",
      { timeoutMs: 60_000, maxBuffer: 1 * MB },
    );
    stdout = result.stdout;
  } catch (error) {
    if (error instanceof JobFailure) throw error;
    return null;
  }
  const parsed = Number(stdout.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/* ----------------------------------------------------------------- helpers */

function formatMb(bytes: number): string {
  return `${(bytes / MB).toFixed(1).replace(".", ",")} MB`;
}

export function formatMinutes(seconds: number): string {
  const minutes = seconds / 60;
  const rounded = Math.round(minutes * 10) / 10;
  return `${String(rounded).replace(".", ",")} Minuten`;
}

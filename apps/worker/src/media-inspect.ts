export type ImageFormat = "jpeg" | "png" | "webp" | "heic";

const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
]);

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

/** Magic-byte check: never trust the filename or the client content type. */
export function sniffImage(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4).toLowerCase();
    if (HEIC_BRANDS.has(brand)) return "heic";
  }
  return null;
}

export type AudioInfo = { mime: string; extension: string };

export function sniffAudio(bytes: Uint8Array): AudioInfo | null {
  if (bytes.length < 12) return null;
  if (ascii(bytes, 0, 3) === "ID3") return { mime: "audio/mpeg", extension: "mp3" };
  if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) {
    return { mime: "audio/mpeg", extension: "mp3" };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") {
    return { mime: "audio/wav", extension: "wav" };
  }
  if (ascii(bytes, 4, 4) === "ftyp") return { mime: "audio/mp4", extension: "m4a" };
  if (ascii(bytes, 0, 4) === "OggS") return { mime: "audio/ogg", extension: "ogg" };
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { mime: "audio/webm", extension: "webm" };
  }
  if (ascii(bytes, 0, 4) === "fLaC") return { mime: "audio/flac", extension: "flac" };
  return null;
}

export function isPdf(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, 5) === "%PDF-";
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

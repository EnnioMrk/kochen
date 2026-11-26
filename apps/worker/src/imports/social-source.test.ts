import type { Limits } from "@kochen/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoMaterial } from "./video";

vi.mock("../fetch-source", () => ({
  assertPublicUrl: vi.fn(async (url: string) => new URL(url)),
  fetchPage: vi.fn(),
}));
vi.mock("./video", () => ({
  prepareVideo: vi.fn(),
  videoSignals: vi.fn(() => ["caption"]),
}));
vi.mock("./link", () => ({
  prepareLink: vi.fn(),
}));

import { fetchPage } from "../fetch-source";
import { prepareLink } from "./link";
import { prepareSource } from "./social";
import { prepareVideo } from "./video";

const limits: Limits = {
  maxVideoMinutes: 20,
  maxAudioMinutes: 20,
  maxPhotos: 10,
  maxPhotoMb: 10,
  maxTotalMb: 25,
  maxPdfPages: 10,
};

function material(caption: string): VideoMaterial {
  return {
    audio: null,
    images: [],
    captions: null,
    caption,
    carousel: false,
    authorComment: null,
    rawText: caption,
    coverKey: null,
    sourceKeys: [],
    warnings: [],
    title: null,
    durationS: null,
  };
}

const FULL =
  "Zutaten:\n- 200 g Mehl\n- 2 Eier\n- 100 ml Milch\n\nZubereitung:\n1. Mehl mischen.\n2. Eier einrühren.";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("prepareSource waterfall", () => {
  it("keeps the social video when the caption has a full recipe", async () => {
    vi.mocked(prepareVideo).mockResolvedValue(material(FULL));

    const result = await prepareSource("https://www.instagram.com/reel/abc/", limits);

    expect(result.kind).toBe("video");
    expect(result.captionWeak).toBe(false);
    expect(prepareLink).not.toHaveBeenCalled();
  });

  it("keeps the audio when the caption is thin", async () => {
    vi.mocked(prepareVideo).mockResolvedValue({
      ...material("So good. Full recipe: https://example.com/rezept"),
      audio: { data: "", mime: "audio/wav" },
    });

    const result = await prepareSource("https://www.instagram.com/reel/abc/", limits);

    expect(result.kind).toBe("video");
    expect(result.captionWeak).toBe(true);
    expect(result.warnings.join(" ")).toContain("Tonspur");
    expect(prepareLink).not.toHaveBeenCalled();
  });

  it("prefers the linked website when the caption is thin", async () => {
    vi.mocked(prepareVideo).mockResolvedValue(
      material("So good. Full recipe: https://example.com/rezept"),
    );
    vi.mocked(prepareLink).mockResolvedValue({
      jsonLd: { draft: { title: "Pasta" }, sourceLang: "de" },
      extraction: null,
      rawText: "Pasta",
      sourceUrl: "https://example.com/rezept",
    });

    const result = await prepareSource("https://www.instagram.com/reel/abc/", limits);

    expect(result.kind).toBe("link");
    if (result.kind === "link") {
      expect(result.sourceUrl).toBe("https://example.com/rezept");
      expect(result.signals).toContain("website");
      expect(result.captionWeak).toBe(true);
    }
    expect(prepareLink).toHaveBeenCalledWith("https://example.com/rezept");
  });

  it("resolves an Instagram share link before the post check", async () => {
    vi.mocked(fetchPage).mockResolvedValue({
      finalUrl: "https://www.instagram.com/reel/abc/",
      html: "",
    });
    vi.mocked(prepareVideo).mockResolvedValue(material(FULL));

    const result = await prepareSource("https://www.instagram.com/share/BAabc/", limits);

    expect(result.kind).toBe("video");
    expect(prepareVideo).toHaveBeenCalledWith("https://www.instagram.com/reel/abc/", limits);
  });

  it("imports a /reels/ link and drops its tracking parameters", async () => {
    vi.mocked(prepareVideo).mockResolvedValue(material(FULL));

    const result = await prepareSource(
      "https://www.instagram.com/reels/Df2nAp7u3xm/?lqvp=NHU1bWNjdGlpNDVx",
      limits,
    );

    expect(result.kind).toBe("video");
    expect(prepareVideo).toHaveBeenCalledWith(
      "https://www.instagram.com/reel/Df2nAp7u3xm/",
      limits,
    );
  });

  it("sends a normal recipe page to the link reader", async () => {
    vi.mocked(prepareLink).mockResolvedValue({
      jsonLd: null,
      extraction: { text: "Ein Rezept" },
      rawText: "Ein Rezept",
      sourceUrl: "https://example.com/rezept",
    });

    const result = await prepareSource("https://example.com/rezept", limits);

    expect(result.kind).toBe("link");
    expect(result.signals).toEqual(["website"]);
    expect(prepareVideo).not.toHaveBeenCalled();
  });
});

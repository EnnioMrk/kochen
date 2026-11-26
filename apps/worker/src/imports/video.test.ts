import { describe, expect, it } from "vitest";
import { carouselThumbnails, videoSignals, type VideoMaterial } from "./video";

function material(overrides: Partial<VideoMaterial> = {}): VideoMaterial {
  return {
    audio: null,
    images: [],
    captions: null,
    caption: null,
    carousel: false,
    authorComment: null,
    rawText: null,
    coverKey: null,
    sourceKeys: [],
    warnings: [],
    title: null,
    durationS: null,
    ...overrides,
  };
}

describe("carousel metadata", () => {
  it("takes the largest thumbnail of each slide, in order", () => {
    const meta = {
      entries: [
        {
          thumbnails: [
            { url: "https://scontent.cdninstagram.com/1-small.jpg", width: 320, height: 320 },
            { url: "https://scontent.cdninstagram.com/1-large.jpg", width: 1080, height: 1080 },
          ],
        },
        {
          thumbnails: [
            { url: "https://scontent.xx.fbcdn.net/2.jpg", width: 720, height: 720 },
          ],
        },
      ],
    };
    expect(carouselThumbnails(meta)).toEqual([
      "https://scontent.cdninstagram.com/1-large.jpg",
      "https://scontent.xx.fbcdn.net/2.jpg",
    ]);
  });

  it("ignores entries without a safe Instagram image URL", () => {
    expect(
      carouselThumbnails({
        entries: [
          {},
          { thumbnails: [{ url: "file:///etc/passwd" }] },
          { thumbnails: [{ url: "https://evil.example/slide.jpg" }] },
          null,
        ],
      }),
    ).toEqual([]);
  });
});

describe("source signals", () => {
  it("names every input that is present", () => {
    expect(
      videoSignals(
        material({
          caption: "Zutaten",
          captions: "Untertitel",
          audio: { data: "", mime: "audio/wav" },
          images: [{ data: "", mime: "image/jpeg" }],
          carousel: true,
          authorComment: "Kommentar",
        }),
      ),
    ).toEqual(["caption", "subtitles", "audio", "frames", "carousel", "author-comment"]);
  });
});

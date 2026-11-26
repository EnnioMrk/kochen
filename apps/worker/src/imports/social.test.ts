import { describe, expect, it } from "vitest";
import { captionShape, isSinglePostUrl, isSocialUrl, recipeUrls } from "./social";

const FULL = `Zutaten:
- 200 g Mehl
- 2 Eier
- 100 ml Milch
- 1 Prise Salz

Zubereitung:
1. Mehl und Salz mischen.
2. Eier und Milch einrühren.
3. Teig 20 Minuten ruhen lassen.`;

describe("social caption shape", () => {
  it("accepts a caption with ingredients, quantities and steps", () => {
    const shape = captionShape(FULL);
    expect(shape.hasIngredients).toBe(true);
    expect(shape.hasQuantities).toBe(true);
    expect(shape.hasSteps).toBe(true);
    expect(shape.score).toBe(3);
    expect(shape.weak).toBe(false);
  });

  it("rejects a short caption that only points to the bio", () => {
    const shape = captionShape("So good 😍 full recipe in bio");
    expect(shape.weak).toBe(true);
    expect(shape.hasQuantities).toBe(false);
  });

  it("rejects an ingredient list without amounts", () => {
    const shape = captionShape("Zutaten:\n- Mehl\n- Eier\n- Milch\n\nZubereitung:\n1. Alles mischen.");
    expect(shape.hasIngredients).toBe(true);
    expect(shape.hasSteps).toBe(true);
    expect(shape.hasQuantities).toBe(false);
    expect(shape.weak).toBe(true);
  });
});

describe("recipe links in a caption", () => {
  it("finds a blog link and skips the Instagram link", () => {
    const text =
      "Rezept: https://www.instagram.com/p/C8qCVbrqExp/ und https://example.com/rezept?x=1.";
    expect(recipeUrls(text)).toEqual(["https://example.com/rezept?x=1"]);
  });

  it("returns at most three links and removes social hubs", () => {
    const text = [
      "https://linktr.ee/cook",
      "https://a.example/one",
      "https://b.example/two",
      "https://c.example/three",
      "https://d.example/four",
    ].join(" ");
    expect(recipeUrls(text)).toEqual([
      "https://a.example/one",
      "https://b.example/two",
      "https://c.example/three",
    ]);
  });
});

describe("social URL detection", () => {
  it("recognises the supported platforms", () => {
    expect(isSocialUrl("https://www.instagram.com/reel/abc/")).toBe(true);
    expect(isSocialUrl("https://www.tiktok.com/@cook/video/1")).toBe(true);
    expect(isSocialUrl("https://youtu.be/abc")).toBe(true);
  });

  it("leaves a normal recipe page alone", () => {
    expect(isSocialUrl("https://example.com/rezept")).toBe(false);
  });

  it("accepts one post and rejects a profile or a playlist", () => {
    expect(isSinglePostUrl("https://www.instagram.com/reel/abc/", "instagram")).toBe(true);
    expect(isSinglePostUrl("https://www.instagram.com/reels/abc/", "instagram")).toBe(true);
    expect(isSinglePostUrl("https://www.instagram.com/reels/abc/?igsh=x", "instagram")).toBe(true);
    expect(isSinglePostUrl("https://www.instagram.com/someuser/reel/abc/", "instagram")).toBe(true);
    expect(isSinglePostUrl("https://www.instagram.com/someuser/", "instagram")).toBe(false);
    expect(isSinglePostUrl("https://www.instagram.com/someuser/reels/", "instagram")).toBe(false);
    expect(isSinglePostUrl("https://www.instagram.com/reels/audio/123/", "instagram")).toBe(false);
    expect(isSinglePostUrl("https://www.tiktok.com/@cook/video/123", "tiktok")).toBe(true);
    expect(isSinglePostUrl("https://www.tiktok.com/@cook", "tiktok")).toBe(false);
    expect(isSinglePostUrl("https://www.youtube.com/watch?v=abc", "youtube")).toBe(true);
    expect(isSinglePostUrl("https://www.youtube.com/playlist?list=abc", "youtube")).toBe(false);
  });
});

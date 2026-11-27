import { describe, expect, it } from "vitest";
import { isStale } from "./version";

describe("isStale", () => {
  it("is false while both ids match", () => {
    expect(isStale("2026-11-27T10:00:00.000Z", "2026-11-27T10:00:00.000Z")).toBe(false);
  });

  it("is true when a newer build is live", () => {
    expect(isStale("2026-11-27T10:00:00.000Z", "2026-11-27T12:00:00.000Z")).toBe(true);
  });

  it("is false when the live id is unknown", () => {
    expect(isStale("2026-11-27T10:00:00.000Z", null)).toBe(false);
  });

  it("is false in local development", () => {
    expect(isStale("dev", "2026-11-27T12:00:00.000Z")).toBe(false);
    expect(isStale("2026-11-27T10:00:00.000Z", "dev")).toBe(false);
  });
});

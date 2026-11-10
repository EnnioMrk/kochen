import { describe, expect, it } from "vitest";
import { openSecret, sealSecret } from "../src/secrets";

describe("sealed platform logins", () => {
  it("reads back what it sealed", async () => {
    const sealed = await sealSecret("hunter2 · Deutsche Umlaute äöü · 🍪");
    expect(sealed).toContain(".");
    expect(await openSecret(sealed)).toBe("hunter2 · Deutsche Umlaute äöü · 🍪");
  });

  it("seals the same text differently every time", async () => {
    const first = await sealSecret("same");
    const second = await sealSecret("same");
    expect(first).not.toBe(second);
  });

  it("returns null for a changed ciphertext", async () => {
    const sealed = await sealSecret("secret");
    const [iv, data] = sealed.split(".");
    expect(await openSecret(`${iv}.${data?.slice(0, -4)}AAAA`)).toBeNull();
  });

  it("returns null for text that is not sealed", async () => {
    expect(await openSecret("plain text")).toBeNull();
  });
});

import { beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import sharp from "sharp";

/**
 * Route tests for the share cards. The database and the object store are
 * replaced, so the test runs without Postgres or R2. The crop itself runs on a
 * real JPEG, which is the part that can fail in production.
 */

const state = vi.hoisted(() => ({
  link: true,
  cover: true,
  image: new Uint8Array(0),
  recipe: {
    id: "11111111-1111-4111-8111-111111111111",
    title: 'Ofengemüse mit Feta "extra"',
    description: null,
    servings: 4,
    bakingTime: "35 Min.",
    visibility: "members",
    deletedAt: null,
    owner: { name: "Anna" },
  } as Record<string, unknown>,
}));

vi.mock("@rezeptor/db", () => ({
  db: () => (strings: TemplateStringsArray) => {
    const text = strings.join(" ");
    if (text.includes("private_links")) return Promise.resolve(state.link ? [{ ok: true }] : []);
    if (text.includes("friend_invites")) {
      return Promise.resolve(state.link ? [{ name: "Anna" }] : []);
    }
    if (text.includes("recipe_ingredients")) {
      return Promise.resolve([{ ingredients: 6, steps: 4 }]);
    }
    if (text.includes("r2_key")) {
      return Promise.resolve(state.cover ? [{ key: "covers/test.jpg" }] : []);
    }
    return Promise.resolve([]);
  },
}));

vi.mock("./repo", () => ({
  getRecipeRow: async () => (state.link ? state.recipe : null),
}));

vi.mock("./media", () => ({
  getObject: async () => state.image,
}));

// Only the preview routes: `app.ts` also loads the Bun static adapter, which
// does not exist under the Node test runner.
const { preview } = await import("./preview");
const app = new Hono();
app.route("/", preview);

const ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "abcdefghijklmnop";

function get(path: string) {
  return app.fetch(new Request(`http://localhost${path}`));
}

beforeAll(async () => {
  state.image = new Uint8Array(
    await sharp({
      create: { width: 300, height: 400, channels: 3, background: "#b4552d" },
    })
      .jpeg()
      .toBuffer(),
  );
});

describe("recipe preview page", () => {
  it("shows the recipe title and its own card image", async () => {
    const response = await get(`/r/${ID}?link=${TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Ofengemüse mit Feta &quot;extra&quot;");
  });

  it("keeps the token in the image URL so the crawler may fetch it", async () => {
    const html = await (await get(`/r/${ID}?link=${TOKEN}`)).text();
    expect(html).toContain(`/r/${ID}/preview.jpg?link=${TOKEN}`);
    expect(html).toContain('property="og:image:width" content="1200"');
  });

  it("falls back to the site card without a live link", async () => {
    state.link = false;
    const html = await (await get(`/r/${ID}?link=${TOKEN}`)).text();
    expect(html).not.toContain("Ofengemüse");
    expect(html).toContain('property="og:title" content="Rezeptor"');
    state.link = true;
  });
});

describe("cover card", () => {
  it("serves a 1200x630 JPEG that a chat app can cache", async () => {
    const response = await get(`/r/${ID}/preview.jpg?link=${TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("private");
    const bytes = Buffer.from(await response.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    expect(meta.width).toBe(1200);
    expect(meta.height).toBe(630);
    expect(bytes.length).toBeLessThan(300 * 1024);
  });

  it("sends the static card when the token is not valid", async () => {
    state.link = false;
    const response = await get(`/r/${ID}/preview.jpg?link=${TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    state.link = true;
  });
});

describe("invite preview page", () => {
  it("names the person who invites", async () => {
    const html = await (await get("/f/abcdefghijklmnop")).text();
    expect(html).toContain("Anna lädt dich zu Rezeptor ein");
  });
});

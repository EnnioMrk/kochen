import { describe, expect, it } from "vitest";
import {
  buildChain,
  chainRating,
  canRate,
  isValidStars,
  averageRating,
} from "../src/ratings";
import {
  formatAmount,
  formatIngredient,
  mergeAmount,
  presentAmount,
  scaleAmount,
} from "../src/units";
import { buildShoppingList } from "../src/shopping";
import { accessFor } from "../src/visibility";
import { diffLines } from "../src/diff";
import { compileFilter, FilterValidationError, personTokens } from "../src/filter";
import { normalizeDraft, normalizeUnit, parseAmount } from "../src/normalize";
import {
  detectBaking,
  durationFromStepText,
  estimateServings,
  orderByFirstStepMention,
} from "../src/import-quality";

describe("units", () => {
  it("scales 3 eggs by 1.5 to 4 1/2, never a third", () => {
    const scaled = scaleAmount(3, "stueck", 1.5);
    expect(scaled).toBe(4.5);
    expect(formatAmount(scaled)).toBe("4 ½");
  });

  it("keeps count steps of one half", () => {
    expect(scaleAmount(1, "stueck", 1 / 3)).toBe(0.5);
    expect(scaleAmount(3, "stueck", 1 / 3)).toBe(1);
  });

  it("rounds grams to 5 and ml to 10", () => {
    expect(scaleAmount(100, "g", 1 / 3)).toBe(35);
    expect(scaleAmount(100, "ml", 1 / 3)).toBe(30);
    expect(scaleAmount(2, "tl", 1 / 3)).toBe(0.75);
    expect(scaleAmount(1, "el", 1 / 3)).toBe(0.5);
  });

  it("keeps floats out of the result", () => {
    const value = scaleAmount(200, "g", 1.5);
    expect(value).toBe(300);
    expect(String(value)).not.toContain("000000");
  });

  it("promotes large amounts for display", () => {
    expect(presentAmount(1500, "g")).toEqual({ amount: 1.5, unit: "kg" });
    expect(presentAmount(2000, "ml")).toEqual({ amount: 2, unit: "l" });
    expect(presentAmount(500, "g")).toEqual({ amount: 500, unit: "g" });
  });

  it("formats German amounts", () => {
    expect(formatAmount(1)).toBe("1");
    expect(formatAmount(0.5)).toBe("½");
    expect(formatAmount(1.5)).toBe("1 ½");
    expect(formatAmount(0.25)).toBe("¼");
    expect(formatAmount(200)).toBe("200");
    expect(formatIngredient(1.5, "kg", "Kartoffeln")).toBe("1 ½ kg Kartoffeln");
    expect(formatIngredient(1, "zehe", "Knoblauch")).toBe("1 Zehe Knoblauch");
  });

  it("merges equal units and keeps teaspoon and tablespoon apart", () => {
    expect(mergeAmount({ amount: 100, unit: "g" }, { amount: 50, unit: "g" })).toEqual({
      amount: 150,
      unit: "g",
    });
    expect(mergeAmount({ amount: 1, unit: "tl" }, { amount: 1, unit: "el" })).toEqual({
      amount: 1,
      unit: "tl",
    });
  });
});

describe("ratings", () => {
  it("accepts half stars only", () => {
    expect(isValidStars(3.5)).toBe(true);
    expect(isValidStars(0)).toBe(false);
    expect(isValidStars(5.5)).toBe(false);
    expect(isValidStars(3.2)).toBe(false);
    expect(isValidStars(0.5)).toBe(true);
  });

  it("needs a cook event", () => {
    expect(canRate(0)).toBe(false);
    expect(canRate(1)).toBe(true);
  });

  it("takes the own rating first, then the chain, never a foreign rating", () => {
    const chain = buildChain(
      { id: "v3", parentId: "v2" },
      {
        v2: { id: "v2", parentId: "v1" },
        v1: { id: "v1", parentId: null },
        foreign: { id: "foreign", parentId: null },
      },
    );
    expect(chain.map((n) => n.depth)).toEqual([0, 1, 2]);
    const own = chainRating(chain, { v3: 5, v2: 3 });
    expect(own?.stars).toBe(5);
    const inherited = chainRating(chain, { v2: 3 });
    expect(inherited).toMatchObject({ stars: 3, recipeId: "v2", depth: 1 });
    expect(chainRating(chain, { foreign: 5 })).toBeNull();
  });

  it("averages to one decimal and ignores invalid values", () => {
    expect(averageRating([4, 5, 4.5])).toBe(4.5);
    expect(averageRating([])).toBeNull();
    expect(averageRating([3, 9])).toBe(3);
  });
});

describe("visibility", () => {
  const base = { ownerId: "owner", visibility: "friends" as const };
  const member = { userId: "m", isFriend: false, hasPrivateLink: false, isMember: true };
  const friend = { ...member, userId: "f", isFriend: true };
  const owner = { ...member, userId: "owner" };
  const link = { ...member, userId: "l", hasPrivateLink: true };

  it("keeps a private recipe to its owner, even by link", () => {
    const recipe = { ...base, visibility: "private" as const };
    expect(accessFor(owner, recipe).view).toBe(true);
    expect(accessFor(friend, recipe).view).toBe(false);
    expect(accessFor(link, recipe).view).toBe(false);
  });

  it("lets a friend read and comment", () => {
    const access = accessFor(friend, base);
    expect(access.view).toBe(true);
    expect(access.comment).toBe(true);
    expect(access.edit).toBe(false);
  });

  it("lets a member read but not comment", () => {
    const access = accessFor(member, { ...base, visibility: "members" });
    expect(access.view).toBe(true);
    expect(access.comment).toBe(false);
  });

  it("lets a link holder read and comment a non-private recipe", () => {
    const access = accessFor(link, base);
    expect(access.view).toBe(true);
    expect(access.comment).toBe(true);
    expect(access.edit).toBe(false);
  });

  it("blocks archived edits and deleted reads", () => {
    expect(accessFor(owner, { ...base, archivedAt: "2024-01-01" }).edit).toBe(false);
    expect(accessFor(member, { ...base, deletedAt: "2024-01-01" }).view).toBe(false);
  });

  it("gives no one write through a private link", () => {
    expect(accessFor(link, base).share).toBe(false);
    expect(accessFor(link, base).edit).toBe(false);
  });
});

describe("diff", () => {
  it("reports changed, added, removed and moved", () => {
    const a = [
      { lineageKey: "k1", amount: 100, unit: "g", name: "Mehl", note: null },
      { lineageKey: "k2", amount: 2, unit: "stueck", name: "Eier", note: null },
    ];
    const b = [
      { lineageKey: "k2", amount: 3, unit: "stueck", name: "Eier", note: null },
      { lineageKey: "k1", amount: 100, unit: "g", name: "Mehl", note: null },
      { lineageKey: "k3", amount: 1, unit: "tl", name: "Salz", note: null },
    ];
    const diff = diffLines(a, b, { fields: ["amount", "unit", "name", "note"] });
    expect(diff.find((d) => d.lineageKey === "k2")?.kind).toBe("changed");
    expect(diff.find((d) => d.lineageKey === "k3")?.kind).toBe("added");
    expect(diff.find((d) => d.lineageKey === "k1")?.kind).toBe("moved");

    const removed = diffLines(b, a, { fields: ["amount"] });
    expect(removed.find((d) => d.lineageKey === "k3")?.kind).toBe("removed");
  });
});

describe("filter", () => {
  const ctx = {
    viewerId: "me-id",
    friendIds: ["friend-id"],
    persons: { me: "me-id", Anna: "friend-id" },
    knownTags: ["vegetarisch"],
    knownCategories: ["Wochenende"],
  };

  it("compiles tags, persons and sort to parameters", () => {
    const { sql, params } = compileFilter(
      {
        tagsAll: ["vegetarisch"],
        tagsAny: [],
        categories: ["Wochenende"],
        ratings: [{ person: "Anna", min: 4 }],
        cookedBy: ["me"],
        owner: "friends",
        sort: "newest",
      },
      ctx,
    );
    expect(sql).toContain("rating_chain");
    expect(sql).toContain("order by r.created_at desc");
    expect(sql).not.toContain("vegetarisch");
    expect(params).toContain("friend-id");
  });

  it("rejects an unknown person, tag or category", () => {
    const base = {
      tagsAll: [], tagsAny: [], categories: [], cookedBy: [],
      owner: "all" as const, sort: "newest" as const,
    };
    expect(() => compileFilter({ ...base, ratings: [{ person: "Fremd", min: 4 }] }, ctx)).toThrow(
      FilterValidationError,
    );
    expect(() => compileFilter({ ...base, tagsAll: ["gibt-es-nicht"] }, ctx)).toThrow();
    expect(() => compileFilter({ ...base, categories: ["Urlaub"] }, ctx)).toThrow();
  });

  it("never returns a private recipe of another person", () => {
    const { sql } = compileFilter(
      { tagsAll: [], tagsAny: [], categories: [], ratings: [], cookedBy: [], owner: "all", sort: "title" },
      ctx,
    );
    expect(sql).toContain("r.visibility <> 'private'");
  });

  it("maps German person tokens", () => {
    expect(personTokens({ id: "a", name: "Ich" }, [{ id: "b", name: "Anna" }]).Anna).toBe("b");
  });
});

describe("shopping list", () => {
  it("merges equal units and keeps teaspoon and tablespoon separate", () => {
    const { items } = buildShoppingList([
      {
        recipeId: "1",
        recipeTitle: "A",
        servings: 4,
        baseServings: 4,
        ingredients: [
          { amount: 200, unit: "g", name: "Mehl" },
          { amount: 1, unit: "tl", name: "Salz" },
        ],
      },
      {
        recipeId: "2",
        recipeTitle: "B",
        servings: 2,
        baseServings: 4,
        ingredients: [
          { amount: 300, unit: "g", name: "mehl" },
          { amount: 2, unit: "el", name: "Salz" },
        ],
      },
    ]);
    const flour = items.find((i) => i.name === "mehl" || i.name === "Mehl");
    expect(flour?.amount).toBe(350);
    expect(items.filter((i) => i.name === "Salz")).toHaveLength(2);
  });

  it("uses the chosen servings", () => {
    const { items } = buildShoppingList([
      {
        recipeId: "1",
        recipeTitle: "A",
        servings: 8,
        baseServings: 4,
        ingredients: [{ amount: 2, unit: "stueck", name: "Eier" }],
      },
    ]);
    expect(items[0]?.amount).toBe(4);
  });
});

describe("normalize", () => {
  it("parses German amounts and units", () => {
    expect(parseAmount("1,5")).toBe(1.5);
    expect(parseAmount("1 1/2")).toBe(1.5);
    expect(parseAmount("½")).toBe(0.5);
    expect(parseAmount("ca. 200")).toBe(200);
    expect(parseAmount("viel")).toBeNull();
    expect(normalizeUnit("Teelöffel")).toBe("tl");
    expect(normalizeUnit("grams")).toBe("g");
  });

  it("builds a valid draft and asks for a screenshot when empty", () => {
    const result = normalizeDraft({
      title: "  Test  ",
      servings: "2",
      ingredients: [{ amount: "1/2", unit: "TL", name: " Salz " }],
      steps: ["Mischen."],
    });
    expect(result.recipe.title).toBe("Test");
    expect(result.recipe.ingredients[0]).toMatchObject({ amount: 0.5, unit: "tl", name: "Salz" });
    expect(result.recipe.steps[0]?.position).toBe(0);
    expect(result.asksForScreenshot).toBe(false);

    const empty = normalizeDraft({ title: "Nichts" });
    expect(empty.asksForScreenshot).toBe(true);
    expect(empty.warnings).toContain("kein_rezept_gefunden");
  });

  it("keeps positions contiguous and drops empty rows", () => {
    const result = normalizeDraft({
      title: "X",
      ingredients: ["Mehl", "", "  ", "Salz"],
      steps: [{ text: "A" }, { text: "" }, { text: "B" }],
    });
    expect(result.recipe.ingredients.map((i) => i.position)).toEqual([0, 1]);
    expect(result.recipe.steps.map((s) => s.position)).toEqual([0, 1]);
  });
});

describe("import quality", () => {
  const line = (raw: string) =>
    normalizeDraft({ title: "T", servings: 2, ingredients: [raw], steps: [] }).recipe.ingredients[0];

  it("parses plain string ingredient lines", () => {
    expect(line("2 Äpfel")).toMatchObject({ amount: 2, unit: "stueck", name: "Äpfel" });
    expect(line("200 g Mehl")).toMatchObject({ amount: 200, unit: "g", name: "Mehl" });
    expect(line("Salz")).toMatchObject({ amount: null, unit: null, name: "Salz" });
    expect(line("1/2 TL Salz")).toMatchObject({ amount: 0.5, unit: "tl", name: "Salz" });
    expect(line("2-3 Äpfel")).toMatchObject({ amount: 2, unit: "stueck", name: "Äpfel" });
    expect(line("200g Mehl")).toMatchObject({ amount: 200, unit: "g", name: "Mehl" });
    expect(line("1 1/2 Tassen Milch")).toMatchObject({ amount: 1.5, unit: "tasse", name: "Milch" });
    expect(line("1 Prise Salz")).toMatchObject({ amount: 1, unit: "prise", name: "Salz" });
    expect(line("1 Dose Tomaten (400 g)")).toMatchObject({ amount: 1, unit: "dose", name: "Tomaten" });
    // No invented unit, no lost information.
    expect(line("2 Handvoll Spinat")).toMatchObject({
      amount: 2,
      unit: "stueck",
      name: "Handvoll Spinat",
    });
    // An object without a unit is a bare count too; without an amount no unit.
    const objectDraft = normalizeDraft({
      title: "T",
      servings: 2,
      ingredients: [{ amount: 3, name: "Eier" }, { unit: "g", name: "Mehl" }],
      steps: [],
    });
    expect(objectDraft.recipe.ingredients[0]).toMatchObject({ amount: 3, unit: "stueck", name: "Eier" });
    expect(objectDraft.recipe.ingredients[1]).toMatchObject({ amount: null, unit: null, name: "Mehl" });
  });

  it("estimates servings instead of silently assuming 4", () => {
    expect(estimateServings(2, 1)).toBe(1);
    expect(estimateServings(20, 10)).toBe(10);

    const small = normalizeDraft({ title: "T", ingredients: ["2 Äpfel"], steps: ["Äpfel essen."] });
    expect(small.servingsEstimated).toBe(true);
    expect(small.recipe.servings).toBe(1);
    expect(small.recipe.servings).not.toBe(4);

    const large = normalizeDraft({
      title: "T",
      ingredients: Array.from({ length: 20 }, (_, index) => `${index + 1} g Zutat ${index}`),
      steps: Array.from({ length: 10 }, () => "Alles verrühren."),
    });
    expect(large.servingsEstimated).toBe(true);
    expect(large.recipe.servings).toBe(10);
    expect(large.recipe.servings).not.toBe(4);

    const stated = normalizeDraft({
      title: "T",
      servings: "6",
      ingredients: ["Salz"],
      steps: ["Streuen."],
    });
    expect(stated.servingsEstimated).toBe(false);
    expect(stated.recipe.servings).toBe(6);
    expect(stated.warnings).not.toContain("portionen_fehlen");
  });

  it("orders ingredients by their first step mention", () => {
    const result = normalizeDraft({
      title: "T",
      servings: 2,
      ingredients: ["Butter", "Mehl", "Zucker", "Salz"],
      steps: ["Zucker und Butter verrühren.", "Mehl unterheben."],
    });
    expect(result.recipe.ingredients.map((item) => item.name)).toEqual([
      "Butter",
      "Zucker",
      "Mehl",
      "Salz",
    ]);
    expect(result.recipe.ingredients.map((item) => item.position)).toEqual([0, 1, 2, 3]);

    const ordered = orderByFirstStepMention(
      [
        { position: 0, amount: 1, unit: "g", name: "Mehl" },
        { position: 1, amount: 1, unit: "g", name: "Zucker" },
      ],
      [{ position: 0, text: "Zucker sieben." }],
    );
    expect(ordered.map((item) => item.name)).toEqual(["Zucker", "Mehl"]);
    expect(ordered.map((item) => item.position)).toEqual([0, 1]);
  });

  it("reads a step duration from the text", () => {
    expect(durationFromStepText("20 Minuten kühlen")).toBe(1200);
    expect(durationFromStepText("ca. 10 Min.")).toBe(600);
    expect(durationFromStepText("1 Stunde")).toBe(3600);
    expect(durationFromStepText("90 Sekunden")).toBe(90);
    expect(durationFromStepText("2-3 Minuten")).toBe(120);
    expect(durationFromStepText("Alles verrühren.")).toBeNull();

    const result = normalizeDraft({
      title: "T",
      servings: 2,
      ingredients: ["Salz"],
      steps: ["20 Minuten kühlen.", { text: "Backen.", durationS: 900 }],
    });
    expect(result.recipe.steps[0]?.durationS).toBe(1200);
    expect(result.recipe.steps[1]?.durationS).toBe(900);
  });

  it("detects baking data only when the text states it", () => {
    const baking = detectBaking("Im vorgeheizten Backofen bei 180 °C Ober-/Unterhitze 35 Min. backen.");
    expect(baking.bakingTemperature).toContain("180");
    expect(baking.bakingTemperature).toContain("Ober-");
    expect(baking.bakingTime).toBe("35 Min.");

    const soup = detectBaking("Die Suppe 20 Minuten köcheln lassen, mit Salz abschmecken.");
    expect(soup).toEqual({ bakingTemperature: null, bakingTime: null });

    const result = normalizeDraft({
      title: "T",
      servings: 2,
      ingredients: ["Mehl"],
      steps: ["Im vorgeheizten Backofen bei 180 °C Umluft 35 Minuten backen."],
    });
    expect(result.recipe.bakingTemperature).toBe("180 °C Umluft");
    expect(result.recipe.bakingTime).toBe("35 Min.");
  });
});

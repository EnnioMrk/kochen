import { FilterDsl } from "@kochen/contracts";
import { normalizeDraft } from "@kochen/core";
import {
  AiExtractionError,
  AiUnavailableError,
  RECIPE_JSON_SHAPE,
  dataFence,
  type AiProvider,
  type AnswerInput,
  type ExtractionInput,
  type ExtractionResult,
  type SuggestInput,
} from "./provider";

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

const EXTRACTION_PROMPT = `Du bist ein Rezept-Extraktor. Antworte nur mit JSON.
Ziel: GENAU EIN Rezept in deutscher Sprache.
- Alle Texte auf Deutsch. Zutaten, Schritte und Titel übersetzen, wenn nötig.
- Beträge als Zahl. Einheiten aus der Liste. Keine Einheit erfinden.
- Keine Schritte erfinden. Nur was in der Quelle steht.
- Wenn keine Zutaten und keine Schritte erkennbar sind, gib ingredients: [] und steps: [].
- Schema:
${RECIPE_JSON_SHAPE}`;

const ANSWER_PROMPT = `Du bist ein Küchenassistent. Antworte auf Deutsch, kurz und konkret.
Nutze nur das gegebene Rezept. Wenn etwas fehlt, sage das.
Antworte als JSON: {"answer": string, "kind": "answer"|"substitution"|"amount"|"success"|"missing_ingredient"}.`;

const FILTER_PROMPT = `Du wandelst einen deutschen Wunsch in einen Filter um. Antworte nur mit JSON.
Erlaubte Schlüssel: tagsAll, tagsAny, categories, ratings, cookedBy, owner, sort.
- person: nur "me" oder ein Name aus der Liste.
- min: halbe Sterne von 0.5 bis 5.
- owner: "me"|"friends"|"all".
- sort: "rating_desc"|"newest"|"title".
- Keine anderen Schlüssel. Keine Erklärungen.
Beispiel: {"tagsAll":["vegetarisch"],"tagsAny":[],"categories":[],"ratings":[{"person":"me","min":4}],"cookedBy":[],"owner":"all","sort":"rating_desc"}`;

export class GeminiProvider implements AiProvider {
  readonly name = "gemini";
  private readonly apiKey: string;
  private readonly extractionModel: string;
  private readonly textModel: string;

  constructor(options?: { apiKey?: string; extractionModel?: string; textModel?: string }) {
    this.apiKey = options?.apiKey ?? process.env.GEMINI_API_KEY ?? "";
    this.extractionModel = options?.extractionModel ?? process.env.AI_EXTRACTION_MODEL ?? "gemini-2.0-flash";
    this.textModel = options?.textModel ?? process.env.AI_TEXT_MODEL ?? "gemini-2.0-flash";
    if (!this.apiKey) throw new AiUnavailableError("gemini_key_missing");
  }

  private async generate(
    model: string,
    system: string,
    parts: Part[],
    timeoutMs: number,
    json = true,
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts }],
            generationConfig: {
              temperature: 0.2,
              ...(json ? { responseMimeType: "application/json" } : {}),
            },
            safetySettings: [],
          }),
        },
      );
      if (!response.ok) {
        const text = await response.text();
        throw new AiUnavailableError(`gemini_${response.status}:${text.slice(0, 200)}`);
      }
      const data = (await response.json()) as GeminiResponse;
      const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
      if (!text.trim()) throw new AiExtractionError("empty_model_answer");
      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  private async json<T>(model: string, system: string, parts: Part[], timeoutMs: number): Promise<T> {
    let first = await this.generate(model, system, parts, timeoutMs);
    try {
      return JSON.parse(stripFence(first)) as T;
    } catch {
      // One repair retry, then fail.
      first = await this.generate(
        model,
        `${system}\nDie letzte Antwort war kein gültiges JSON. Antworte erneut, nur JSON.`,
        parts,
        timeoutMs,
      );
      try {
        return JSON.parse(stripFence(first)) as T;
      } catch {
        throw new AiExtractionError("invalid_json");
      }
    }
  }

  async extractRecipe(input: ExtractionInput): Promise<ExtractionResult> {
    const parts: Part[] = [{ text: EXTRACTION_PROMPT }];
    for (const image of input.images ?? []) {
      parts.push({ inline_data: { mime_type: image.mime, data: image.data } });
    }
    if (input.audio) {
      parts.push({ inline_data: { mime_type: input.audio.mime, data: input.audio.data } });
    }
    const textSource = [
      input.text ? dataFence(input.text) : "",
      input.captions ? `Untertitel:\n${dataFence(input.captions)}` : "",
      input.authorComment ? `Kommentar der Autorin:\n${dataFence(input.authorComment)}` : "",
      input.url ? `Quelle: ${input.url}` : "",
    ].filter(Boolean).join("\n\n");
    if (textSource) parts.push({ text: textSource });

    const raw = await this.json<Record<string, unknown>>(
      this.extractionModel,
      EXTRACTION_PROMPT,
      parts,
      45_000,
    );
    const normalized = normalizeDraft(raw);
    return {
      draft: raw,
      sourceLang: normalized.sourceLang,
      transcript: typeof raw.transcript === "string" ? raw.transcript : null,
      warnings: normalized.warnings,
    };
  }

  async transcribe(input: { data: string; mime: string }): Promise<{ text: string; lang: string | null }> {
    const raw = await this.json<{ text?: string; lang?: string }>(
      this.textModel,
      'Transkribiere das Audio wörtlich. Antworte nur mit JSON: {"text": string, "lang": string}.',
      [{ inline_data: { mime_type: input.mime, data: input.data } }],
      60_000,
    );
    return { text: raw.text ?? "", lang: raw.lang ?? null };
  }

  async answer(input: AnswerInput): Promise<{ answer: string; kind: AnswerInput["kind"] & string }> {
    const context = input.recipe
      ? `Rezept: ${input.recipe.title}\nPortionen: ${input.recipe.servings}\nZutaten:\n${input.recipe.ingredients
          .map((item) => `- ${item.amount ?? ""} ${item.unit ?? ""} ${item.name}`)
          .join("\n")}\nSchritte:\n${input.recipe.steps.map((step) => step.text).join("\n")}`
      : "Kein Rezept ausgewählt.";
    const raw = await this.json<{ answer?: string; kind?: string }>(
      this.textModel,
      ANSWER_PROMPT,
      [{ text: `${dataFence(context)}\n\nFrage: ${input.question.slice(0, 2000)}` }],
      15_000,
    );
    return {
      answer: raw.answer ?? "Dazu kann ich gerade nichts sagen.",
      kind: (raw.kind as AnswerInput["kind"]) ?? "answer",
    };
  }

  async suggestTags(input: SuggestInput): Promise<{ existing: string[]; newTags: string[]; category: string | null }> {
    const raw = await this.json<{ existing?: string[]; newTags?: string[]; category?: string | null }>(
      this.textModel,
      `Du schlägst Tags vor. Nutze zuerst vorhandene Tags. Ein neuer Tag nur, wenn keiner passt.
Antworte als JSON: {"existing": string[], "newTags": string[], "category": string|null}.`,
      [
        {
          text: [
            dataFence(
              `Rezept: ${input.recipe.title}\n${input.recipe.ingredients.map((i) => i.name).join(", ")}\n${input.recipe.steps.map((s) => s.text).join("\n")}`,
            ),
            `Vorhandene Tags: ${input.existingTags.join(", ")}`,
            `Kategorien: ${input.categories.join(", ")}`,
          ].join("\n\n"),
        },
      ],
      15_000,
    );
    return {
      existing: (raw.existing ?? []).filter((tag) => input.existingTags.includes(tag)),
      newTags: (raw.newTags ?? []).filter((tag) => !input.existingTags.includes(tag)).slice(0, 5),
      category: raw.category ?? null,
    };
  }

  async parseFilter(input: {
    query: string;
    persons: string[];
    tags: string[];
    categories: string[];
  }): Promise<FilterDsl> {
    const raw = await this.json<unknown>(
      this.textModel,
      FILTER_PROMPT,
      [
        {
          text: [
            `Wunsch: ${input.query.slice(0, 500)}`,
            `Personen: ${input.persons.join(", ") || "me"}`,
            `Tags: ${input.tags.join(", ") || "-"}`,
            `Kategorien: ${input.categories.join(", ") || "-"}`,
          ].join("\n"),
        },
      ],
      15_000,
    );
    const parsed = FilterDsl.safeParse(raw);
    if (!parsed.success) throw new AiExtractionError("invalid_filter");
    return parsed.data;
  }
}

function stripFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

/** Provider factory. A provider outage is a config change, not a rewrite. */
export function createProvider(): AiProvider {
  if (process.env.AI_PROVIDER === "openai" || (!process.env.GEMINI_API_KEY && process.env.OPENAI_API_KEY)) {
    return new OpenAiProvider();
  }
  return new GeminiProvider();
}

type OpenAiPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

class OpenAiProvider implements AiProvider {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY ?? "";
    this.model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    if (!this.apiKey) throw new AiUnavailableError("openai_key_missing");
  }

  private async json<T>(system: string, user: string, timeoutMs: number): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!response.ok) throw new AiUnavailableError(`openai_${response.status}`);
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content ?? "";
      return JSON.parse(stripFence(text)) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async extractRecipe(input: ExtractionInput): Promise<ExtractionResult> {
    const raw = await this.json<Record<string, unknown>>(
      EXTRACTION_PROMPT,
      [input.text ?? "", input.authorComment ?? "", input.captions ?? ""].filter(Boolean).map(dataFence).join("\n\n"),
      45_000,
    );
    const normalized = normalizeDraft(raw);
    return {
      draft: raw,
      sourceLang: normalized.sourceLang,
      transcript: null,
      warnings: normalized.warnings,
    };
  }

  async transcribe(): Promise<{ text: string; lang: string | null }> {
    throw new AiUnavailableError("transcription_provider_unavailable");
  }

  async answer(input: AnswerInput): Promise<{ answer: string; kind: AnswerInput["kind"] & string }> {
    const context = input.recipe
      ? `${input.recipe.title}\n${input.recipe.ingredients.map((i) => `${i.amount ?? ""} ${i.unit ?? ""} ${i.name}`).join("\n")}`
      : "";
    const raw = await this.json<{ answer?: string; kind?: string }>(
      ANSWER_PROMPT,
      `${dataFence(context)}\n\nFrage: ${input.question}`,
      15_000,
    );
    return {
      answer: raw.answer ?? "",
      kind: (raw.kind as AnswerInput["kind"]) ?? "answer",
    };
  }

  async suggestTags(input: SuggestInput): Promise<{ existing: string[]; newTags: string[]; category: string | null }> {
    const raw = await this.json<{ existing?: string[]; newTags?: string[]; category?: string | null }>(
      "Antworte als JSON {\"existing\": string[], \"newTags\": string[], \"category\": string|null}.",
      `${dataFence(input.recipe.title)}\nVorhandene Tags: ${input.existingTags.join(", ")}`,
      15_000,
    );
    return {
      existing: (raw.existing ?? []).filter((tag) => input.existingTags.includes(tag)),
      newTags: (raw.newTags ?? []).slice(0, 5),
      category: raw.category ?? null,
    };
  }

  async parseFilter(input: { query: string; persons: string[] }): Promise<FilterDsl> {
    const raw = await this.json<unknown>(
      FILTER_PROMPT,
      `Wunsch: ${input.query}\nPersonen: ${input.persons.join(", ") || "me"}`,
      15_000,
    );
    const parsed = FilterDsl.safeParse(raw);
    if (!parsed.success) throw new AiExtractionError("invalid_filter");
    return parsed.data;
  }
}

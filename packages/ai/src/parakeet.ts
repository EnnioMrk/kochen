import { AiUnavailableError } from "./provider";

export type Transcriber = {
  readonly name: string;
  transcribe(input: { data: string; mime: string }): Promise<{ text: string; lang: string | null }>;
};

/**
 * NVIDIA Parakeet TDT 0.6B v3: 25 European languages, German included,
 * automatic punctuation and among the fastest multilingual ASR models.
 * It is served on the OpenAI-compatible /audio/transcriptions route.
 */
export class ParakeetTranscriber implements Transcriber {
  readonly name = "parakeet";
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly language: string;

  constructor(options?: { baseUrl?: string; apiKey?: string; model?: string; language?: string }) {
    this.apiKey = options?.apiKey ?? process.env.ASR_API_KEY ?? "";
    this.baseUrl = (options?.baseUrl ?? process.env.ASR_BASE_URL ?? defaultBaseUrl(this.apiKey)).replace(/\/$/, "");
    this.model = options?.model ?? process.env.ASR_MODEL ?? "nvidia/parakeet-tdt-0.6b-v3";
    this.language = options?.language ?? process.env.ASR_LANGUAGE ?? "de";
    if (!this.apiKey && !this.baseUrl) throw new AiUnavailableError("asr_endpoint_missing");
  }

  async transcribe(input: { data: string; mime: string }): Promise<{ text: string; lang: string | null }> {
    const bytes = Uint8Array.from(atob(input.data), (char) => char.charCodeAt(0));
    const form = new FormData();
    form.append("model", this.model);
    form.append("language", this.language);
    form.append("response_format", "json");
    form.append("file", new Blob([bytes], { type: input.mime }), "audio.wav");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    try {
      const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {},
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new AiUnavailableError(`asr_${response.status}:${text.slice(0, 200)}`);
      }
      const data = (await response.json()) as { text?: string; language?: string };
      return { text: data.text ?? "", lang: data.language ?? this.language };
    } finally {
      clearTimeout(timer);
    }
  }
}

function defaultBaseUrl(key: string): string {
  if (key.startsWith("nvapi-")) return "https://integrate.api.nvidia.com/v1";
  if (key.startsWith("tgp_")) return "https://api.together.xyz/v1";
  if (key.startsWith("sk-or-")) return "https://openrouter.ai/api/v1";
  return "https://api.together.xyz/v1";
}

/** Parakeet when a key is configured. Null means: use the chat provider. */
export function createTranscriber(): Transcriber | null {
  if (!process.env.ASR_API_KEY && !process.env.ASR_BASE_URL) return null;
  try {
    return new ParakeetTranscriber();
  } catch {
    return null;
  }
}

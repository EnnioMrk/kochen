import pino from "pino";

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * JSON logger. Recipe text, auth tokens and private link tokens never go into
 * a log line: callers pass ids and counts only.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "kochen-worker" },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: {
    paths: [
      "payload",
      "text",
      "rawText",
      "transcript",
      "token",
      "authorization",
      "*.token",
      "*.rawText",
      "*.transcript",
      "*.privateToken",
    ],
    censor: "[redacted]",
  },
});

export const env = {
  get nodeEnv(): string {
    return process.env.NODE_ENV ?? "development";
  },
  get production(): boolean {
    return this.nodeEnv === "production";
  },
  get databaseUrl(): string {
    const url = process.env.DATABASE_URL;
    if (!url && this.production) throw new Error("DATABASE_URL is required");
    return url ?? "postgres://kochen:kochen@localhost:5432/kochen";
  },
  /** Canonical web origin, used for push deep links and printed recipes. */
  get appOrigin(): string {
    return (process.env.APP_ORIGIN ?? "http://localhost:5173").replace(/\/$/, "");
  },
  get workerPollMs(): number {
    return Math.max(250, num(process.env.WORKER_POLL_MS, 2000));
  },
  get chromiumPath(): string {
    return process.env.CHROMIUM_PATH ?? "chromium";
  },
  get r2(): {
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
  } {
    return {
      endpoint: process.env.R2_ENDPOINT ?? "",
      bucket: process.env.R2_BUCKET ?? "kochen",
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
      region: process.env.R2_REGION ?? "auto",
    };
  },
  get r2Configured(): boolean {
    return Boolean(
      process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY,
    );
  },
  get vapid(): { publicKey: string; privateKey: string; subject: string } {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY ?? "",
      privateKey: process.env.VAPID_PRIVATE_KEY ?? "",
      subject: process.env.VAPID_SUBJECT ?? "mailto:admin@ennio.vip",
    };
  },
  get vapidConfigured(): boolean {
    return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  },
  get aiProvider(): string {
    if (process.env.AI_PROVIDER) return process.env.AI_PROVIDER;
    return process.env.GEMINI_API_KEY ? "gemini" : "openai";
  },
  get aiConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
  },
  get aiModels(): { extraction: string | null; text: string | null } {
    return {
      extraction: process.env.AI_EXTRACTION_MODEL ?? null,
      text: process.env.AI_TEXT_MODEL ?? null,
    };
  },
  /** Local scratch space for pdftoppm, ffmpeg and Chromium. */
  get tmpRoot(): string {
    return process.env.WORKER_TMP_DIR ?? "/tmp";
  },
};

export type Env = typeof env;

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  get nodeEnv(): string {
    return process.env.NODE_ENV ?? "development";
  },
  get production(): boolean {
    return this.nodeEnv === "production";
  },
  get port(): number {
    return num(process.env.PORT, 3000);
  },
  get appOrigin(): string {
    return process.env.APP_ORIGIN ?? "http://localhost:5173";
  },
  get canonicalHost(): string {
    return process.env.CANONICAL_HOST ?? "localhost";
  },
  get databaseUrl(): string {
    const url = process.env.DATABASE_URL;
    if (!url && this.production) throw new Error("DATABASE_URL is required");
    return url ?? "postgres://kochen:kochen@localhost:5432/kochen";
  },
  get jwksUrl(): string {
    return process.env.ENNIO_JWKS_URL ?? "https://api.ennio.vip/v1/.well-known/jwks.json";
  },
  get audience(): string {
    return process.env.ENNIO_AUD ?? "kochen";
  },
  get issuer(): string | null {
    return process.env.ENNIO_ISSUER ?? null;
  },
  get devAuth(): boolean {
    return process.env.DEV_AUTH === "true";
  },
  get r2(): { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string } {
    return {
      endpoint: process.env.R2_ENDPOINT ?? "",
      bucket: process.env.R2_BUCKET ?? "kochen",
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
      region: process.env.R2_REGION ?? "auto",
    };
  },
  get r2Configured(): boolean {
    return Boolean(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
  },
  get vapid(): { publicKey: string; privateKey: string; subject: string } {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY ?? "",
      privateKey: process.env.VAPID_PRIVATE_KEY ?? "",
      subject: process.env.VAPID_SUBJECT ?? "mailto:admin@ennio.vip",
    };
  },
  get aiConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
  },
  get sentryDsn(): string | null {
    return process.env.SENTRY_DSN ?? null;
  },
  get allowedOrigins(): string[] {
    return [
      "https://rezepte.ennio.vip",
      "https://kochen.ennio.vip",
      this.appOrigin,
      "http://localhost:5173",
      "http://localhost:3000",
    ].filter((value, index, all) => all.indexOf(value) === index);
  },
};

/**
 * Put the browser CORS policy on the R2 bucket that serves uploads.
 *
 * Without this policy the browser sends the PUT to the presigned URL, the
 * browser blocks the cross-origin request and the file never arrives. The
 * presign call still answers 200, so the app sees a failed upload only.
 *
 * The app's own R2 keys (R2_ACCESS_KEY_ID) cannot change a bucket policy:
 * S3 answers PutBucketCors with AccessDenied. Use a Cloudflare API token with
 * R2 edit rights, or set the policy in the dashboard.
 *
 * Run from the repo root:
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... R2_BUCKET=kochen \
 *   APP_ORIGIN=https://rezepte.ennio.vip bun run r2:cors
 */
const FIXED_ORIGINS = ["https://rezepte.ennio.vip", "https://kochen.ennio.vip", "http://localhost:5173"];
const ALLOWED_METHODS = ["PUT", "GET", "HEAD"];
const ALLOWED_HEADERS = ["content-type", "authorization", "*"];
const EXPOSE_HEADERS = ["etag"];
const MAX_AGE_SECONDS = 3600;

const REQUIRED_VARS = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "R2_BUCKET"] as const;

function required(name: (typeof REQUIRED_VARS)[number]): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(
      `Missing environment variable ${name}. ` +
        `Set all of ${REQUIRED_VARS.join(", ")} and run "bun run r2:cors" again.`,
    );
    process.exit(1);
  }
  return value;
}

function allowedOrigins(): string[] {
  const origins: string[] = [];
  for (const value of [process.env.APP_ORIGIN, ...FIXED_ORIGINS]) {
    const origin = value?.trim().replace(/\/+$/, "");
    if (origin && !origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

type CorsRule = {
  id: string;
  allowed: { origins: string[]; methods: string[]; headers: string[] };
  exposeHeaders: string[];
  maxAgeSeconds: number;
};

async function call(url: string, token: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => null)) as
    | { success?: boolean; errors?: Array<{ message?: string }> }
    | null;
  if (!response.ok || body?.success === false) {
    const reason = body?.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(`${init.method ?? "GET"} ${url} answered ${response.status}${reason ? `: ${reason}` : ""}`);
  }
  return body;
}

async function main(): Promise<void> {
  const accountId = required("CLOUDFLARE_ACCOUNT_ID");
  const token = required("CLOUDFLARE_API_TOKEN");
  const bucket = required("R2_BUCKET");
  const jurisdiction = (process.env.R2_JURISDICTION ?? "eu").trim();
  const origins = allowedOrigins();

  const rule: CorsRule = {
    id: "browser-uploads",
    allowed: { origins, methods: ALLOWED_METHODS, headers: ALLOWED_HEADERS },
    exposeHeaders: EXPOSE_HEADERS,
    maxAgeSeconds: MAX_AGE_SECONDS,
  };

  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/cors`;
  await call(base, token, {
    method: "PUT",
    headers: { "cf-r2-jurisdiction": jurisdiction },
    body: JSON.stringify({ rules: [rule] }),
  });

  // Read back: the policy must name every origin and the PUT method.
  const read = (await call(base, token, {
    method: "GET",
    headers: { "cf-r2-jurisdiction": jurisdiction },
  })) as { result?: { rules?: Array<{ allowed?: { origins?: string[]; methods?: string[] } }> } };
  const saved = read.result?.rules?.[0]?.allowed;
  const savedOrigins = saved?.origins ?? [];
  const savedMethods = saved?.methods ?? [];
  const ok = origins.every((origin) => savedOrigins.includes(origin)) && savedMethods.includes("PUT");
  if (!ok) {
    console.error("The read-back policy does not match. Check the account, bucket and jurisdiction.");
    process.exit(1);
  }
  console.log(`CORS policy written to bucket "${bucket}" for ${origins.join(", ")}.`);
}

main().catch((error: unknown) => {
  // Never print the token; the message names the status and the endpoint.
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Could not set the bucket CORS policy: ${message}`);
  process.exit(1);
});

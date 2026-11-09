import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";
import { localDelete, localGet, localPut, signMediaKey, verifyMediaSignature } from "./media-local";

let client: S3Client | null = null;

function s3(): S3Client {
  if (!client) {
    const r2 = env.r2;
    client = new S3Client({
      region: r2.region,
      endpoint: r2.endpoint,
      credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
      forcePathStyle: true,
    });
  }
  return client;
}

export function mediaKey(prefix: string, name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  return `${prefix}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${clean}`;
}

export async function presignPut(key: string, contentType: string, size: number): Promise<string> {
  if (!env.r2Configured) {
    // Local disk fallback. The client PUTs with a bearer token.
    return `/api/media/upload?key=${encodeURIComponent(key)}&size=${size}`;
  }
  return getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: env.r2.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: size,
    }),
    { expiresIn: 900 },
  );
}

export async function signedGet(key: string, expiresIn = 3600): Promise<string> {
  if (!env.r2Configured) return signMediaKey(key, expiresIn);
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: env.r2.bucket, Key: key }), { expiresIn });
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  if (!env.r2Configured) return localPut(key, body);
  await s3().send(
    new PutObjectCommand({ Bucket: env.r2.bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function getObject(key: string): Promise<Uint8Array> {
  if (!env.r2Configured) return localGet(key);
  const result = await s3().send(new GetObjectCommand({ Bucket: env.r2.bucket, Key: key }));
  const bytes = await result.Body?.transformToByteArray();
  if (!bytes) throw new Error("empty_object");
  return bytes;
}

export async function deleteObject(key: string): Promise<void> {
  if (!env.r2Configured) return localDelete(key);
  await s3().send(new DeleteObjectCommand({ Bucket: env.r2.bucket, Key: key })).catch(() => {});
}

export { verifyMediaSignature };

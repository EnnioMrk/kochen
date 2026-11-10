/**
 * Sealed text at rest. AES-256-GCM with one key for the server and the worker.
 * The key comes from CREDENTIAL_KEY, or from MEDIA_SECRET when it is not set.
 */

const encoder = new TextEncoder();

let cached: Promise<CryptoKey> | null = null;

/**
 * The same key for the web server and the worker. CREDENTIAL_KEY wins; then
 * MEDIA_SECRET; then the database URL, which both containers always share, so a
 * fresh deployment works before anyone sets a new variable.
 */
function material(): string {
  return (
    process.env.CREDENTIAL_KEY ??
    process.env.MEDIA_SECRET ??
    process.env.DATABASE_URL ??
    "dev-credential-key"
  );
}

function key(): Promise<CryptoKey> {
  if (!cached) {
    cached = (async () => {
      const digest = await crypto.subtle.digest("SHA-256", encoder.encode(material()));
      return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
    })();
  }
  return cached;
}

function toBase64Url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const text = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(text.length));
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}

/** `iv.ciphertext`, both base64url. */
export async function sealSecret(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), encoder.encode(plain));
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(sealed))}`;
}

/** Null when the text is not a sealed value or the key changed. */
export async function openSecret(value: string): Promise<string | null> {
  const [ivPart, dataPart] = value.split(".");
  if (!ivPart || !dataPart) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(ivPart) },
      await key(),
      fromBase64Url(dataPart),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

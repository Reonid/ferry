import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";

const VERSION = "v1";

export function loadKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

/** AES-256-GCM. Format: v1.<iv>.<tag>.<ciphertext>, each part base64url. */
export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function decrypt(sealed: string, key: Buffer): string {
  const parts = sealed.split(".");
  const [version, iv, tag, ciphertext] = parts;
  if (
    parts.length !== 4 ||
    version !== VERSION ||
    iv === undefined ||
    tag === undefined ||
    ciphertext === undefined
  ) {
    throw new Error("Unsupported sealed value");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function newId(): string {
  return randomUUID();
}

export function newToken(): string {
  return randomBytes(16).toString("base64url");
}

/** 256 random bits, base64url: for credentials Ferry hands out. */
export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** A 32-byte key for one purpose, derived from `key`, so one secret never does two jobs. */
export function deriveKey(key: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", key, "ferry", purpose, 32));
}

/** SHA-256 as base64url. Credentials are kept by this hash, so a copy of the database can't use them. */
export function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

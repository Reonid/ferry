import { createHash, randomBytes } from "node:crypto";

/** RFC 7636 PKCE pair (S256): a 43-char base64url verifier and its SHA-256 challenge. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function randomState(): string {
  return randomBytes(24).toString("base64url");
}

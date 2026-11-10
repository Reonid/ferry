import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decrypt,
  deriveKey,
  encrypt,
  hashSecret,
  loadKey,
  newSecret,
} from "@/lib/crypto";

const key = randomBytes(32);

describe("crypto", () => {
  it("round-trips text", () => {
    for (const s of ["", "hello", "Zagreb ☀️"]) {
      expect(decrypt(encrypt(s, key), key)).toBe(s);
    }
  });

  it("uses the v1 format", () => {
    const parts = encrypt("x", key).split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("rejects tampering", () => {
    const parts = encrypt("hello world", key).split(".");
    const ct = parts[3] ?? "";
    parts[3] = (ct[0] === "A" ? "B" : "A") + ct.slice(1);
    expect(() => decrypt(parts.join("."), key)).toThrow();
  });

  it("rejects the wrong key", () => {
    expect(() => decrypt(encrypt("x", key), randomBytes(32))).toThrow();
  });

  it("requires a 32-byte key", () => {
    expect(() => loadKey(Buffer.alloc(16).toString("base64"))).toThrow();
    expect(loadKey(Buffer.alloc(32).toString("base64"))).toHaveLength(32);
  });

  it("derives a different 32-byte key per purpose", () => {
    const a = deriveKey(key, "one");
    expect(a).toHaveLength(32);
    expect(deriveKey(key, "one").equals(a)).toBe(true);
    expect(deriveKey(key, "two").equals(a)).toBe(false);
    expect(deriveKey(randomBytes(32), "one").equals(a)).toBe(false);
    expect(a.equals(key)).toBe(false);
  });

  it("hashes secrets with SHA-256 as base64url", () => {
    // SHA-256("abc"), from FIPS 180-2.
    expect(hashSecret("abc")).toBe(
      Buffer.from(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        "hex",
      ).toString("base64url"),
    );
  });

  it("makes 256-bit secrets", () => {
    const s = newSecret();
    expect(Buffer.from(s, "base64url")).toHaveLength(32);
    expect(newSecret()).not.toBe(s);
  });
});

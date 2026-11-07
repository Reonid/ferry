import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, loadKey } from "@/lib/crypto";

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
});

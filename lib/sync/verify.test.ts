import { describe, expect, it, vi } from "vitest";
import { verifyQstash } from "./verify";

const req = (headers: Record<string, string> = {}) =>
  new Request("https://ferry.test/api/tick", {
    method: "POST",
    body: "{}",
    headers,
  });

describe("verifyQstash", () => {
  it("rejects a missing signature", async () => {
    const verify = vi.fn(async () => true);
    expect(await verifyQstash(req(), { verify })).toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });

  it("returns the body for a valid signature", async () => {
    const verify = vi.fn(async () => true);
    expect(
      await verifyQstash(req({ "upstash-signature": "s" }), { verify }),
    ).toBe("{}");
    expect(verify).toHaveBeenCalledWith({ signature: "s", body: "{}" });
  });

  it("treats false and throws as invalid", async () => {
    const h = { "upstash-signature": "s" };
    expect(
      await verifyQstash(req(h), { verify: async () => false }),
    ).toBeNull();
    expect(
      await verifyQstash(req(h), {
        verify: async () => {
          throw new Error("bad");
        },
      }),
    ).toBeNull();
  });
});

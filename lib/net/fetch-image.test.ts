import { describe, expect, it } from "vitest";
import { fetchImage } from "./fetch-image";

const okFetch = (body: Uint8Array, headers: Record<string, string> = {}) =>
  (async () =>
    new Response(body as BodyInit, {
      status: 200,
      headers: { "content-type": "image/png", ...headers },
    })) as unknown as typeof fetch;

describe("fetchImage", () => {
  it("returns bytes and mime type", async () => {
    const r = await fetchImage("https://img.example/a.png", {
      fetchImpl: okFetch(new Uint8Array([1, 2, 3])),
    });
    expect(r?.mimeType).toBe("image/png");
    expect(Array.from(r?.bytes ?? [])).toEqual([1, 2, 3]);
  });

  it("refuses http and oversize images", async () => {
    let calls = 0;
    const counting = (async () => {
      calls++;
      return new Response(new Uint8Array(10), {
        headers: { "content-type": "image/png" },
      });
    }) as unknown as typeof fetch;
    expect(
      await fetchImage("http://img.example/a.png", { fetchImpl: counting }),
    ).toBeNull();
    expect(calls).toBe(0);

    const big = new Uint8Array(50);
    expect(
      await fetchImage("https://img.example/a.png", {
        maxBytes: 10,
        fetchImpl: okFetch(big),
      }),
    ).toBeNull();
    expect(
      await fetchImage("https://img.example/a.png", {
        maxBytes: 10,
        fetchImpl: okFetch(new Uint8Array(5), { "content-length": "9999" }),
      }),
    ).toBeNull();
  });

  it("returns null on failure statuses and thrown errors", async () => {
    const notFound = (async () =>
      new Response("no", { status: 404 })) as unknown as typeof fetch;
    const boom = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    expect(
      await fetchImage("https://img.example/a.png", { fetchImpl: notFound }),
    ).toBeNull();
    expect(
      await fetchImage("https://img.example/a.png", { fetchImpl: boom }),
    ).toBeNull();
    expect(await fetchImage("not a url")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { fetchImage } from "./fetch-image";

const okFetch = (body: Uint8Array, headers: Record<string, string> = {}) =>
  (async () =>
    new Response(body as BodyInit, {
      status: 200,
      headers: { "content-type": "image/png", ...headers },
    })) as unknown as typeof fetch;

const image = (type = "image/png") =>
  new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { "content-type": type },
  });
const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { location } });

/**
 * A fake web of fixed responses. Like the real fetch, it follows redirects
 * itself unless the caller asks for `redirect: "manual"`.
 */
function fakeWeb(pages: Record<string, () => Response>) {
  const requested: string[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    let url = String(input);
    for (;;) {
      requested.push(url);
      const res = pages[url]?.() ?? new Response("gone", { status: 404 });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location !== null) {
        if (init?.redirect === "manual") return res;
        url = new URL(location, url).href;
        continue;
      }
      return res;
    }
  }) as unknown as typeof fetch;
  return { fetchImpl, requested };
}

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

  it("refuses a redirect to http", async () => {
    const web = fakeWeb({
      "https://img.example/a.png": () => redirect("http://img.example/a.png"),
      "http://img.example/a.png": () => image(),
    });
    expect(
      await fetchImage("https://img.example/a.png", {
        fetchImpl: web.fetchImpl,
      }),
    ).toBeNull();
    expect(web.requested).toEqual(["https://img.example/a.png"]);
  });

  it("refuses a non-image content type", async () => {
    for (const respond of [
      () => image("text/html; charset=utf-8"),
      () => new Response(new Uint8Array([1]), { status: 200 }),
    ]) {
      const web = fakeWeb({ "https://img.example/a.png": respond });
      expect(
        await fetchImage("https://img.example/a.png", {
          fetchImpl: web.fetchImpl,
        }),
      ).toBeNull();
    }
  });

  it("refuses localhost and IP-literal hosts", async () => {
    const local = [
      "https://localhost/a.png",
      "https://LOCALHOST./a.png",
      "https://cache.localhost/a.png",
      "https://127.0.0.1/a.png",
      "https://0x7f.1/a.png",
      "https://10.0.0.8/a.png",
      "https://[::1]/a.png",
      "https://[fd00::1]/a.png",
      "https://[::ffff:127.0.0.1]/a.png",
    ];
    const web = fakeWeb({
      ...Object.fromEntries(local.map((url) => [url, () => image()])),
      "https://img.example/meta.png": () =>
        redirect("https://169.254.169.254/latest/meta-data"),
      "https://169.254.169.254/latest/meta-data": () => image(),
    });
    for (const url of local) {
      expect(
        await fetchImage(url, { fetchImpl: web.fetchImpl }),
        url,
      ).toBeNull();
    }
    expect(web.requested).toEqual([]);

    expect(
      await fetchImage("https://img.example/meta.png", {
        fetchImpl: web.fetchImpl,
      }),
    ).toBeNull();
    expect(web.requested).toEqual(["https://img.example/meta.png"]);
  });

  it("follows an https redirect within the hop limit", async () => {
    const web = fakeWeb({
      "https://a.example/1": () => redirect("https://b.example/2", 301),
      "https://b.example/2": () => redirect("/3", 307),
      "https://b.example/3": () => redirect("https://c.example/4.png", 308),
      "https://c.example/4.png": () => image("image/webp"),
      "https://far.example/0": () => redirect("https://a.example/1"),
    });
    const r = await fetchImage("https://a.example/1", {
      fetchImpl: web.fetchImpl,
    });
    expect(r?.mimeType).toBe("image/webp");
    expect(Array.from(r?.bytes ?? [])).toEqual([1, 2, 3]);
    expect(web.requested).toEqual([
      "https://a.example/1",
      "https://b.example/2",
      "https://b.example/3",
      "https://c.example/4.png",
    ]);

    // A fourth hop is one too many.
    web.requested.length = 0;
    expect(
      await fetchImage("https://far.example/0", { fetchImpl: web.fetchImpl }),
    ).toBeNull();
    expect(web.requested).not.toContain("https://c.example/4.png");
  });
});

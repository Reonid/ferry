import { describe, expect, it } from "vitest";
import {
  DiscordOAuthError,
  discordAuthorizeUrl,
  exchangeDiscordCode,
} from "./oauth";

const args = {
  clientId: "cid",
  clientSecret: "shh-secret",
  code: "the-code",
  redirectUri: "https://ferry.example/cb",
};

describe("discordAuthorizeUrl", () => {
  it("builds the authorize url with the webhook scope", () => {
    const u = new URL(
      discordAuthorizeUrl({
        clientId: "cid",
        redirectUri: "https://ferry.example/cb",
        state: "st",
      }),
    );
    expect(u.origin + u.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("scope")).toBe("webhook.incoming");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("redirect_uri")).toBe("https://ferry.example/cb");
  });
});

describe("exchangeDiscordCode", () => {
  it("reads the webhook from the token response", async () => {
    let seen: { url: string; body: string } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, body: String(init.body) };
      return Response.json({
        webhook: {
          id: "w1",
          token: "wt",
          guild_id: "g1",
          channel_id: "ch1",
          url: "https://discord.com/api/webhooks/w1/wt",
        },
      });
    }) as unknown as typeof fetch;
    const r = await exchangeDiscordCode({ ...args, fetchImpl });
    expect(r).toEqual({
      webhookId: "w1",
      webhookToken: "wt",
      guildId: "g1",
      channelId: "ch1",
    });
    expect(seen!.url).toBe("https://discord.com/api/oauth2/token");
    const p = new URLSearchParams(seen!.body);
    expect(p.get("grant_type")).toBe("authorization_code");
    expect(p.get("code")).toBe("the-code");
    expect(p.get("client_secret")).toBe("shh-secret");
  });

  it("rejects a response without a webhook", async () => {
    const fetchImpl = (async () =>
      Response.json({ access_token: "x" })) as unknown as typeof fetch;
    await expect(exchangeDiscordCode({ ...args, fetchImpl })).rejects.toThrow(
      DiscordOAuthError,
    );
  });

  it("rejects failures without leaking secrets", async () => {
    const fetchImpl = (async () =>
      Response.json(
        { error: "invalid_grant" },
        { status: 400 },
      )) as unknown as typeof fetch;
    const err = await exchangeDiscordCode({ ...args, fetchImpl }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DiscordOAuthError);
    expect((err as Error).message).not.toContain("shh-secret");
    expect((err as Error).message).not.toContain("the-code");
  });

  it("gives each failure a code", async () => {
    const codeFor = async (fetchImpl: typeof fetch) =>
      (
        (await exchangeDiscordCode({ ...args, fetchImpl }).catch(
          (e: unknown) => e,
        )) as DiscordOAuthError
      ).code;
    expect(
      await codeFor((async () =>
        Response.json(
          { error: "invalid_grant" },
          { status: 400 },
        )) as unknown as typeof fetch),
    ).toBe("invalid_grant");
    expect(
      await codeFor(
        (async () =>
          new Response("down", { status: 502 })) as unknown as typeof fetch,
      ),
    ).toBe("http_502");
    expect(
      await codeFor((async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch),
    ).toBe("unreachable");
    expect(
      await codeFor((async () =>
        Response.json({ access_token: "x" })) as unknown as typeof fetch),
    ).toBe("no_webhook");
  });
});

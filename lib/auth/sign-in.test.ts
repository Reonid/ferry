import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DiscordOAuthError } from "@/lib/destinations/discord/oauth";
import { createFakeRedis, createStore } from "@/lib/store";
import type { Account, Channel, TokenSet } from "@/lib/types";
import { OAuthError } from "./buffer-oauth";
import { logSignInFailure, saveSignIn } from "./sign-in";

const NOW = 5_000_000;
const tokens: TokenSet = {
  accessToken: "a",
  refreshToken: "r",
  expiresAt: NOW + 3_600_000,
};
const info = {
  accountId: "acct",
  name: "Me",
  timezone: "Europe/Zagreb",
  organizationIds: ["org"],
};
const channel: Channel = {
  id: "ch",
  organizationId: "org",
  service: "bluesky",
  name: "me",
  displayName: null,
  avatar: "",
  isDisconnected: false,
  isQueuePaused: false,
  isLocked: false,
};

describe("saveSignIn", () => {
  it("saves the account, keeping its alert target and first sign-in", async () => {
    const store = createStore(createFakeRedis(), randomBytes(32));
    const before: Account = {
      ...info,
      name: "Old",
      status: "needs_reauth",
      notifyDestinationId: "d1",
      createdAt: 7,
    };
    await store.putAccount(before);
    await saveSignIn(store, { info, tokens, channels: [channel], now: NOW });
    expect(await store.getAccount("acct")).toEqual({
      ...info,
      status: "active",
      notifyDestinationId: "d1",
      createdAt: 7,
    });
    expect(await store.getTokens("acct")).toEqual(tokens);
    expect(await store.getChannels("acct")).toEqual([channel]);
  });

  it("makes the account due for a check at once", async () => {
    // A stale schedule, like the 6-hour wait after Buffer disconnected Ferry.
    const store = createStore(createFakeRedis(), randomBytes(32));
    const later = NOW + 6 * 3_600_000;
    await store.scheduleSync("acct", later);
    await store.putSyncState("acct", {
      ...(await store.getSyncState("acct")),
      nextRunAt: later,
    });
    await saveSignIn(store, { info, tokens, channels: [], now: NOW });
    expect(await store.dueAccounts(NOW, 10)).toEqual(["acct"]);
    expect((await store.getSyncState("acct")).nextRunAt).toBe(NOW);
  });

  it("clears the Buffer sign-in alert", async () => {
    const store = createStore(createFakeRedis(), randomBytes(32));
    for (const key of ["buffer-auth", "chan-paused:ch"])
      await store.raiseAlertOnce("acct", {
        key,
        message: key,
        supportUrl: null,
        at: 1,
      });
    await saveSignIn(store, { info, tokens, channels: [], now: NOW });
    expect((await store.listAlerts("acct", 10)).map((a) => a.key)).toEqual([
      "chan-paused:ch",
    ]);
    expect(
      await store.raiseAlertOnce("acct", {
        key: "buffer-auth",
        message: "again",
        supportUrl: null,
        at: 2,
      }),
    ).toBe(true);
  });
});

describe("logSignInFailure", () => {
  it("logs one line: the error's name, and an OAuth error's code", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSignInFailure("Buffer sign-in", new OAuthError("invalid_grant"));
    logSignInFailure(
      "Discord connection",
      new DiscordOAuthError("no_webhook", "Discord did not return a webhook"),
    );
    logSignInFailure(
      "Buffer sign-in",
      new TypeError("token secret-token and code secret-code"),
    );
    logSignInFailure("Buffer sign-in", "thrown text");
    expect(spy.mock.calls).toEqual([
      ["ferry: Buffer sign-in failed (OAuthError invalid_grant)"],
      ["ferry: Discord connection failed (DiscordOAuthError no_webhook)"],
      ["ferry: Buffer sign-in failed (TypeError)"],
      ["ferry: Buffer sign-in failed (UnknownError)"],
    ]);
    spy.mockRestore();
  });

  it("keeps a provider's code to one plain word", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSignInFailure("Buffer sign-in", new OAuthError("bad\nlog line ✓"));
    expect(spy).toHaveBeenCalledWith(
      "ferry: Buffer sign-in failed (OAuthError badlogline)",
    );
    spy.mockRestore();
  });
});

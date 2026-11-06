import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFakeRedis, createStore } from "@/lib/store";
import type { Account, Channel, TokenSet } from "@/lib/types";
import { saveSignIn } from "./sign-in";

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

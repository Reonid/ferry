import { describe, expect, it } from "vitest";
import { raiseAlert } from "./alerts";
import {
  account,
  discordDest,
  makeDeps,
  redditDest,
  telegramDest,
} from "./delivery/test-support";

describe("raiseAlert", () => {
  it("raises each alert once and notifies the private channel", async () => {
    const { deps, store, calls } = makeDeps();
    await store.putDestination(discordDest("n"));
    const acct = account({ notifyDestinationId: "n" });
    const args = {
      deps,
      account: acct,
      key: "k1",
      message: "Post *failed*",
      supportUrl: "https://support.test/x",
    };
    expect(await raiseAlert(args)).toBe(true);
    expect(await raiseAlert(args)).toBe(false);
    expect(calls).toHaveLength(1);
    const msg = calls[0]!.messages[0]!;
    expect(msg.content).toBe("Ferry alert: Post \\*failed\\*");
    expect(msg.username).toBe("Ferry");
    expect(msg.allowed_mentions).toEqual({ parse: [] });
    expect(msg.components).toEqual([
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: "How to fix",
            url: "https://support.test/x",
          },
        ],
      },
    ]);
    expect(await store.listAlerts("acct", 10)).toHaveLength(1);
  });

  it("has no button without a support url", async () => {
    const { deps, store, calls } = makeDeps();
    await store.putDestination(discordDest("n"));
    await raiseAlert({
      deps,
      account: account({ notifyDestinationId: "n" }),
      key: "k",
      message: "m",
      supportUrl: null,
    });
    expect(calls[0]!.messages[0]!.components).toBeUndefined();
  });

  it("stores the alert but sends nothing without an active discord notify destination", async () => {
    const { deps, store, calls } = makeDeps();
    await store.putDestination(discordDest("b", { status: "broken" }));
    await store.putDestination(redditDest("r"));
    for (const [i, notify] of [null, "b", "r", "missing"].entries()) {
      await raiseAlert({
        deps,
        account: account({ notifyDestinationId: notify }),
        key: `k${i}`,
        message: "m",
        supportUrl: null,
      });
    }
    expect(calls).toHaveLength(0);
    expect(await store.listAlerts("acct", 10)).toHaveLength(4);
  });

  it("survives a failing send", async () => {
    const { deps, store } = makeDeps([new Error("boom")]);
    await store.putDestination(discordDest("n"));
    await expect(
      raiseAlert({
        deps,
        account: account({ notifyDestinationId: "n" }),
        key: "k",
        message: "m",
        supportUrl: null,
      }),
    ).resolves.toBe(true);
  });
});

describe("raiseAlert to Telegram", () => {
  it("sends alerts to a Telegram DM", async () => {
    const { deps, store, telegramCalls, calls } = makeDeps();
    await store.putDestination(telegramDest("n", { chatType: "private" }));
    await raiseAlert({
      deps,
      account: account({ notifyDestinationId: "n" }),
      key: "k1",
      message: "Post failed",
      supportUrl: null,
    });
    expect(calls).toHaveLength(0);
    expect(telegramCalls).toHaveLength(1);
    expect(telegramCalls[0]).toMatchObject({
      chatId: "-100n",
      calls: [
        { method: "sendMessage", params: { text: "Ferry alert: Post failed" } },
      ],
    });
  });

  it("skips a Telegram target when Telegram isn't configured", async () => {
    const { deps, store, telegramCalls } = makeDeps();
    deps.telegram = null;
    await store.putDestination(telegramDest("n", { chatType: "private" }));
    expect(
      await raiseAlert({
        deps,
        account: account({ notifyDestinationId: "n" }),
        key: "k1",
        message: "x",
        supportUrl: null,
      }),
    ).toBe(true);
    expect(telegramCalls).toHaveLength(0);
  });

  it("swallows a throwing Telegram send", async () => {
    const { deps, store } = makeDeps([], [new Error("boom")]);
    await store.putDestination(telegramDest("n", { chatType: "private" }));
    await expect(
      raiseAlert({
        deps,
        account: account({ notifyDestinationId: "n" }),
        key: "k1",
        message: "x",
        supportUrl: null,
      }),
    ).resolves.toBe(true);
  });
});

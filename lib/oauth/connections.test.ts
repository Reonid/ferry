import { describe, expect, it } from "vitest";
import type { McpGrant } from "../types";
import { disconnect, listConnections } from "./connections";
import { oauthFixture } from "./test-support";

const grant = (
  id: string,
  createdAt: number,
  over: Partial<McpGrant> = {},
): McpGrant => ({
  id,
  accountId: "acct",
  clientId: "c1.x.y",
  clientName: "Claude",
  redirectHost: "claude.ai",
  scope: "ferry:read",
  resource: "https://ferry.example/mcp",
  createdAt,
  refreshedAt: createdAt,
  accessHash: `a-${id}`,
  refreshHash: `r-${id}`,
  ...over,
});

describe("connections", () => {
  it("lists them newest first with what each may do, naming apps that gave no name", async () => {
    const { store } = oauthFixture();
    await store.putGrant(grant("old", 1));
    await store.putGrant(
      grant("new", 2, {
        clientName: null,
        redirectHost: "localhost",
        scope: "ferry:read ferry:write",
      }),
    );
    expect(await listConnections(store, "acct")).toEqual([
      {
        id: "new",
        name: "An AI app",
        host: "localhost",
        connectedAt: 2,
        canWrite: true,
      },
      {
        id: "old",
        name: "Claude",
        host: "claude.ai",
        connectedAt: 1,
        canWrite: false,
      },
    ]);
  });

  it("disconnects only the account's own connections", async () => {
    const { store } = oauthFixture();
    await store.putGrant(grant("mine", 1));
    await store.putGrant(grant("theirs", 1, { accountId: "other" }));
    expect(await disconnect(store, "acct", "theirs")).toBe(false);
    expect(await store.getGrant("theirs")).not.toBeNull();
    expect(await disconnect(store, "acct", "mine")).toBe(true);
    expect(await store.getGrant("mine")).toBeNull();
    expect(await disconnect(store, "acct", "mine")).toBe(false);
  });
});

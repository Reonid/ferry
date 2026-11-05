import { describe, expect, it } from "vitest";
import { makeDeps } from "../delivery/test-support";
import { seed } from "../sync/test-support";
import { loadDashboard } from "./snapshot";

describe("loadDashboard", () => {
  it("never exposes webhook tokens", async () => {
    const { store } = makeDeps();
    await seed(store);
    const snap = await loadDashboard("acct", store, 1_000_000);
    expect(snap.destinations).toEqual([
      { id: "d1", kind: "discord", label: "Chan d1", status: "active" },
    ]);
    const json = JSON.stringify(snap);
    expect(json).not.toContain("tok-d1");
    expect(json).not.toContain("webhookToken");
    expect(snap.account).toEqual({ name: "me", status: "active" });
  });
});

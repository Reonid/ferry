import { readFileSync } from "node:fs";
import { buildClientSchema, Kind, parse, print, validate } from "graphql";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_QUERY,
  CHANNELS_QUERY,
  LATEST_SENT_QUERY,
  buildSyncQuery,
  syncVariables,
} from "./queries";

const fixture = JSON.parse(
  readFileSync("test/fixtures/buffer-schema.json", "utf8"),
);
const schema = buildClientSchema(fixture.data);

describe("query guard against Buffer's schema", () => {
  const docs: [string, string][] = [
    ["ACCOUNT_QUERY", ACCOUNT_QUERY],
    ["CHANNELS_QUERY", CHANNELS_QUERY],
    ["LATEST_SENT_QUERY", LATEST_SENT_QUERY],
    ["buildSyncQuery(1)", buildSyncQuery(1)],
    ["buildSyncQuery(3)", buildSyncQuery(3)],
  ];
  it.each(docs)("%s validates", (_name, doc) => {
    expect(validate(schema, parse(doc))).toEqual([]);
  });

  it("never contains a mutation", () => {
    for (const [, doc] of docs) expect(doc).not.toMatch(/\bmutation\b/i);
  });
});

describe("syncVariables", () => {
  it("converts epoch ms to ISO and numbers the orgs", () => {
    const vars = syncVariables({
      orgs: [
        { organizationId: "o-a", channelIds: ["c1"] },
        { organizationId: "o-b", channelIds: [] },
      ],
      since: Date.UTC(2026, 10, 1),
      until: Date.UTC(2026, 10, 8),
    });
    expect(vars).toEqual({
      since: "2026-11-01T00:00:00.000Z",
      until: "2026-11-08T00:00:00.000Z",
      o0: "o-a",
      ch0: ["c1"],
      o1: "o-b",
      ch1: [],
    });
  });
});

describe("LATEST_SENT_QUERY", () => {
  it("takes a list of channel ids", () => {
    const op = parse(LATEST_SENT_QUERY).definitions.find(
      (d) => d.kind === Kind.OPERATION_DEFINITION,
    );
    const ch =
      op?.kind === Kind.OPERATION_DEFINITION
        ? op.variableDefinitions?.find((v) => v.variable.name.value === "ch")
        : undefined;
    expect(ch && print(ch.type)).toBe("[ChannelId!]");
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baseUrl, env, optionalEnv } from "@/lib/env";

const saved = { ...process.env };

beforeEach(() => {
  delete process.env.BUFFER_CLIENT_ID;
  delete process.env.NEXT_PUBLIC_BASE_URL;
});

afterEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, saved);
});

describe("env", () => {
  it("names the missing variable", () => {
    expect(() => env("BUFFER_CLIENT_ID")).toThrow("BUFFER_CLIENT_ID");
    expect(optionalEnv("BUFFER_CLIENT_ID")).toBeUndefined();
  });

  it("reads at call time", () => {
    process.env.BUFFER_CLIENT_ID = "abc";
    expect(env("BUFFER_CLIENT_ID")).toBe("abc");
  });

  it("trims the base url", () => {
    process.env.NEXT_PUBLIC_BASE_URL = "https://a.test/";
    expect(baseUrl()).toBe("https://a.test");
  });
});

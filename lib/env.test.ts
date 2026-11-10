import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baseUrl, env, optionalEnv, telegramConfig } from "@/lib/env";

const saved = { ...process.env };

beforeEach(() => {
  delete process.env.BUFFER_CLIENT_ID;
  delete process.env.NEXT_PUBLIC_BASE_URL;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_USERNAME;
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

  it("telegramConfig is null unless both variables are set", () => {
    expect(telegramConfig()).toBeNull();
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    expect(telegramConfig()).toBeNull();
    process.env.TELEGRAM_BOT_USERNAME = "@";
    expect(telegramConfig()).toBeNull();
    process.env.TELEGRAM_BOT_USERNAME = "ferry_bot";
    expect(telegramConfig()).toEqual({
      token: "123:abc",
      botUsername: "ferry_bot",
    });
  });

  it("strips a leading @ from the bot username", () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    process.env.TELEGRAM_BOT_USERNAME = "@ferry_bot";
    expect(telegramConfig()?.botUsername).toBe("ferry_bot");
  });
});

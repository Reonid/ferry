import { refreshBufferToken } from "../auth/buffer-oauth";
import { bufferRequest } from "../buffer/client";
import { getAccessToken } from "../buffer/tokens";
import { newToken } from "../crypto";
import { sendDiscordMessages } from "../destinations/discord/send";
import { sendTelegramMessages } from "../destinations/telegram/send";
import { baseUrl, env, telegramConfig } from "../env";
import { getStore } from "../store";
import type { SyncDeps } from "./runner";

export function productionDeps(): SyncDeps {
  const store = getStore();
  return {
    store,
    now: () => Date.now(),
    jitterMs: () => Math.floor(Math.random() * 10_000),
    buffer: ({ accessToken, query, variables }) =>
      bufferRequest({ accessToken, query, variables, now: Date.now() }),
    getAccessToken: (accountId) =>
      getAccessToken({
        store,
        accountId,
        now: () => Date.now(),
        // Single call, never retried: refresh tokens are single-use.
        refresh: (refreshToken) =>
          refreshBufferToken({
            clientId: env("BUFFER_CLIENT_ID"),
            clientSecret: env("BUFFER_CLIENT_SECRET"),
            refreshToken,
            now: Date.now(),
          }),
      }),
    sendDiscord: sendDiscordMessages,
    sendTelegram: sendTelegramMessages,
    telegram: telegramConfig(),
    baseUrl: baseUrl(),
    newToken,
  };
}

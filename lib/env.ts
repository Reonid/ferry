export type EnvName =
  | "NEXT_PUBLIC_BASE_URL"
  | "SESSION_SECRET"
  | "ENCRYPTION_KEY"
  | "BUFFER_CLIENT_ID"
  | "BUFFER_CLIENT_SECRET"
  | "DISCORD_CLIENT_ID"
  | "DISCORD_CLIENT_SECRET"
  | "UPSTASH_REDIS_REST_URL"
  | "UPSTASH_REDIS_REST_TOKEN"
  | "QSTASH_TOKEN"
  | "QSTASH_CURRENT_SIGNING_KEY"
  | "QSTASH_NEXT_SIGNING_KEY"
  | "TELEGRAM_BOT_TOKEN"
  | "TELEGRAM_BOT_USERNAME"
  | "FERRY_DEV_LOGIN";

/** Reads at call time so tests can set and restore variables. */
export function optionalEnv(name: EnvName): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

export function env(name: EnvName): string {
  const value = optionalEnv(name);
  if (value === undefined)
    throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function baseUrl(): string {
  return env("NEXT_PUBLIC_BASE_URL").replace(/\/+$/, "");
}

export interface TelegramConfig {
  token: string;
  /** Without the leading "@". */
  botUsername: string;
}

/** Null unless both the bot token and username are set. */
export function telegramConfig(): TelegramConfig | null {
  const token = optionalEnv("TELEGRAM_BOT_TOKEN");
  const botUsername = optionalEnv("TELEGRAM_BOT_USERNAME")?.replace(/^@/, "");
  return token && botUsername ? { token, botUsername } : null;
}

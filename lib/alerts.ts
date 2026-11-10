import { escapeDiscordMarkdown } from "./destinations/discord/format";
import type { DiscordMessage } from "./destinations/discord/format";
import {
  buildTelegramAlert,
  withoutButtons,
} from "./destinations/telegram/notice";
import type { TelegramCall } from "./destinations/telegram/format";
import type { DeliverDeps } from "./delivery/deliver";
import type { Account } from "./types";

export { brokenDestinationAlertKey } from "./alert-keys";

export function buildAlertMessage(
  message: string,
  supportUrl: string | null,
): DiscordMessage {
  return {
    content: `Ferry alert: ${escapeDiscordMarkdown(message)}`,
    username: "Ferry",
    allowed_mentions: { parse: [] },
    ...(supportUrl
      ? {
          components: [
            {
              type: 1,
              components: [
                { type: 2, style: 5, label: "How to fix", url: supportUrl },
              ],
            },
          ],
        }
      : {}),
  };
}

/**
 * Sends a notice to the account's private notify target when it is an active
 * Discord or Telegram destination. Every failure and throw is swallowed and
 * never logged: errors may carry a webhook or Bot API URL. A rejected Telegram
 * notice is retried once without buttons, since Telegram refuses URLs it
 * considers invalid.
 */
export async function sendToNotifyTarget(
  deps: DeliverDeps,
  account: Account,
  message: { discord: DiscordMessage; telegram: TelegramCall },
): Promise<void> {
  if (account.notifyDestinationId === null) return;
  try {
    const dest = await deps.store.getDestination(account.notifyDestinationId);
    if (!dest || dest.status !== "active") return;
    if (dest.kind === "discord") {
      await deps.sendDiscord({
        webhookId: dest.webhookId,
        webhookToken: dest.webhookToken,
        guildId: dest.guildId,
        messages: [message.discord],
      });
    } else if (dest.kind === "telegram" && deps.telegram) {
      const base = {
        token: deps.telegram.token,
        chatId: dest.chatId,
        username: dest.username,
      };
      const outcome = await deps.sendTelegram({
        ...base,
        calls: [message.telegram],
      });
      if (!outcome.ok && !outcome.retryable && !outcome.destinationBroken) {
        await deps.sendTelegram({
          ...base,
          calls: [withoutButtons(message.telegram)],
        });
      }
    }
  } catch {
    // Deliberately empty: never log the error, it may carry a secret URL.
  }
}

/**
 * Records an alert once per key and, the first time, posts it to the account's
 * private notify target. A failed or thrown send is swallowed: the alert is
 * already stored and shown on the dashboard.
 */
export async function raiseAlert(args: {
  deps: DeliverDeps;
  account: Account;
  key: string;
  message: string;
  supportUrl: string | null;
}): Promise<boolean> {
  const { deps, account } = args;
  const isNew = await deps.store.raiseAlertOnce(account.accountId, {
    key: args.key,
    message: args.message,
    supportUrl: args.supportUrl,
    at: deps.now(),
  });
  if (!isNew) return isNew;
  await sendToNotifyTarget(deps, account, {
    discord: buildAlertMessage(args.message, args.supportUrl),
    telegram: buildTelegramAlert(args.message, args.supportUrl),
  });
  return isNew;
}

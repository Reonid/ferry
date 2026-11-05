import { escapeDiscordMarkdown } from "./destinations/discord/format";
import type { DiscordMessage } from "./destinations/discord/format";
import type { DeliverDeps } from "./delivery/deliver";
import type { Account } from "./types";

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
 * Records an alert once per key and, the first time, posts it to the account's
 * private Discord channel. A failed or thrown send is swallowed: the alert is
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
  if (!isNew || account.notifyDestinationId === null) return isNew;
  const dest = await deps.store.getDestination(account.notifyDestinationId);
  if (dest?.kind !== "discord" || dest.status !== "active") return isNew;
  try {
    await deps.sendDiscord({
      webhookId: dest.webhookId,
      webhookToken: dest.webhookToken,
      guildId: dest.guildId,
      messages: [buildAlertMessage(args.message, args.supportUrl)],
    });
  } catch {
    // Deliberately empty: never log the error, it may carry the webhook URL.
  }
  return isNew;
}

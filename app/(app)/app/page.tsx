import type { Metadata } from "next";
import { requireAccount } from "@/lib/auth/current";
import { loadDashboard } from "@/lib/dashboard/snapshot";
import { baseUrl, telegramConfig } from "@/lib/env";
import { listConnections } from "@/lib/oauth/connections";
import { oauthUrls } from "@/lib/oauth/metadata";
import { getStore } from "@/lib/store";
import type { Notice } from "./Alerts";
import Dashboard from "./Dashboard";

export const metadata: Metadata = { title: "Dashboard" };

/** The Discord connect callback reports back through the query string. */
function noticeFrom(
  query: Record<string, string | string[] | undefined>,
): Notice | null {
  if (query.connected === "discord") return "discord-connected";
  if (query.error === "discord_denied") return "discord-denied";
  if (query.error === "discord") return "discord-failed";
  return null;
}

async function load(accountId: string) {
  const renderedAt = Date.now();
  const store = getStore();
  const [snapshot, assistants] = await Promise.all([
    loadDashboard(accountId, store, renderedAt),
    // With the page, not in /api/live: connections change only from here.
    listConnections(store, accountId),
  ]);
  return { snapshot, assistants, renderedAt };
}

export default async function DashboardPage(props: PageProps<"/app">) {
  const account = await requireAccount();
  const { snapshot, assistants, renderedAt } = await load(account.accountId);
  return (
    <Dashboard
      snapshot={snapshot}
      assistants={assistants}
      mcpUrl={oauthUrls(baseUrl()).resource}
      renderedAt={renderedAt}
      notice={noticeFrom(await props.searchParams)}
      // Only whether it's set up: the token and username stay here.
      telegramEnabled={telegramConfig() !== null}
    />
  );
}

import type { Metadata } from "next";
import { requireAccount } from "@/lib/auth/current";
import { loadDashboard } from "@/lib/dashboard/snapshot";
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
  const snapshot = await loadDashboard(accountId, getStore(), renderedAt);
  return { snapshot, renderedAt };
}

export default async function DashboardPage(props: PageProps<"/app">) {
  const account = await requireAccount();
  const { snapshot, renderedAt } = await load(account.accountId);
  return (
    <Dashboard
      snapshot={snapshot}
      renderedAt={renderedAt}
      notice={noticeFrom(await props.searchParams)}
    />
  );
}

import { ACTIVITY_LIMIT, ALERTS_KEPT } from "../constants";
import type { Store } from "../store/store";
import { dayKey } from "../time";
import type {
  Account,
  ActivityEntry,
  Alert,
  Channel,
  PublicDestination,
  RedditDraft,
  Route,
} from "../types";

export interface DashboardSnapshot {
  account: { name: string | null; status: Account["status"] };
  channels: Channel[];
  destinations: PublicDestination[];
  routes: Route[];
  activity: ActivityEntry[];
  drafts: RedditDraft[];
  alerts: Alert[];
  nextRunAt: number | null;
  lastSyncAt: number | null;
  apiCallsToday: number;
  notifyDestinationId: string | null;
}

const DRAFTS_SHOWN = 20;

export async function loadDashboard(
  accountId: string,
  store: Store,
  now: number,
): Promise<DashboardSnapshot> {
  const account = await store.getAccount(accountId);
  if (!account) throw new Error("Unknown account");
  const [
    channels,
    destinations,
    routes,
    activity,
    drafts,
    alerts,
    state,
    calls,
  ] = await Promise.all([
    store.getChannels(accountId),
    store.listDestinations(accountId),
    store.listRoutes(accountId),
    store.listActivity(accountId, ACTIVITY_LIMIT),
    store.listDrafts(accountId, DRAFTS_SHOWN),
    store.listAlerts(accountId, ALERTS_KEPT),
    store.getSyncState(accountId),
    store.getApiCalls(accountId, dayKey(now)),
  ]);
  return {
    account: { name: account.name, status: account.status },
    channels,
    // Built field by field so webhook tokens can never leak through. A
    // Telegram chat's type names its kind and keeps DMs out of routes.
    destinations: destinations.map((d) => ({
      id: d.id,
      kind: d.kind,
      label: d.label,
      status: d.status,
      ...(d.kind === "telegram" ? { chatType: d.chatType } : {}),
    })),
    routes,
    activity,
    drafts,
    alerts,
    nextRunAt: state.nextRunAt,
    lastSyncAt: state.lastSyncAt,
    apiCallsToday: calls,
    notifyDestinationId: account.notifyDestinationId,
  };
}

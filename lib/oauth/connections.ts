import type { Store } from "../store/store";

/** An AI app connected to Ferry, as Settings lists it. */
export interface Connection {
  id: string;
  /** The app's own name for itself. */
  name: string;
  /** Where its sign-in returned, such as "claude.ai": the part an app can't make up. */
  host: string;
  connectedAt: number;
}

/** Newest first. */
export async function listConnections(
  store: Store,
  accountId: string,
): Promise<Connection[]> {
  const grants = await store.listGrants(accountId);
  return grants.reverse().map((g) => ({
    id: g.id,
    name: g.clientName ?? "An AI app",
    host: g.redirectHost,
    connectedAt: g.createdAt,
  }));
}

/** Ends one connection, if it's this account's. Its tokens stop working at once. */
export async function disconnect(
  store: Store,
  accountId: string,
  grantId: string,
): Promise<boolean> {
  const grant = await store.getGrant(grantId);
  if (!grant || grant.accountId !== accountId) return false;
  await store.deleteGrant(grant);
  return true;
}

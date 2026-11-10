/*
 * Alert keys, kept apart from lib/alerts.ts so the dashboard can tell kinds
 * of alert apart without bundling the code that sends them.
 */

const BROKEN_DESTINATION = "dest-broken:";

/** The alert raised once when a destination stops accepting posts. */
export function brokenDestinationAlertKey(destId: string): string {
  return `${BROKEN_DESTINATION}${destId}`;
}

/** Whether an alert says a destination stopped accepting posts. */
export function isBrokenDestinationAlert(key: string): boolean {
  return key.startsWith(BROKEN_DESTINATION);
}

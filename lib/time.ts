/** UTC calendar day as YYYY-MM-DD. */
export function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

// Creates the QStash schedule that calls /api/tick every 2 minutes.
// Usage: QSTASH_TOKEN=... NEXT_PUBLIC_BASE_URL=https://your.host npm run schedule
import { Client } from "@upstash/qstash";

const token = process.env.QSTASH_TOKEN;
const base = process.env.NEXT_PUBLIC_BASE_URL;
if (!token || !base) {
  console.error("Set QSTASH_TOKEN and NEXT_PUBLIC_BASE_URL first.");
  process.exit(1);
}

let url;
try {
  url = new URL(base);
} catch {
  console.error("NEXT_PUBLIC_BASE_URL is not a valid URL.");
  process.exit(1);
}
const host = url.hostname.toLowerCase();
if (
  url.protocol !== "https:" ||
  host === "localhost" ||
  host.endsWith(".localhost") ||
  host === "127.0.0.1" ||
  host === "[::1]"
) {
  console.error(
    "NEXT_PUBLIC_BASE_URL must be a public https URL: QStash cannot reach localhost.",
  );
  process.exit(1);
}

const destination = `${url.origin}/api/tick`;
const client = new Client({ token });

const existing = (await client.schedules.list()).filter(
  (s) => s.destination === destination,
);
if (existing.length > 0) {
  console.error(`A schedule for ${destination} already exists:`);
  for (const s of existing) console.error(`  ${s.scheduleId}  ${s.cron}`);
  process.exit(1);
}

const { scheduleId } = await client.schedules.create({
  destination,
  cron: "*/2 * * * *",
});
console.log(`Created schedule ${scheduleId} for ${destination}`);

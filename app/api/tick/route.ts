import { Receiver } from "@upstash/qstash";
import { env } from "@/lib/env";
import { productionDeps } from "@/lib/sync/production";
import { runTick } from "@/lib/sync/tick";
import { verifyQstash } from "@/lib/sync/verify";

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const receiver = new Receiver({
    currentSigningKey: env("QSTASH_CURRENT_SIGNING_KEY"),
    nextSigningKey: env("QSTASH_NEXT_SIGNING_KEY"),
  });
  if ((await verifyQstash(req, receiver)) === null)
    return new Response("Unauthorized", { status: 401 });
  const report = await runTick({
    now: () => Date.now(),
    deps: productionDeps(),
  });
  return Response.json(report);
}

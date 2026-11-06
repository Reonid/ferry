"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth/current";
import {
  addRedditDestination,
  createRoute,
  deleteRoute,
  refreshChannels,
  removeDestination,
  renameDestination,
  retryJob,
  sendLatestPost,
  setNotifyDestination,
  setRoutePaused,
  type ActionResult,
} from "@/lib/routes/manage";
import { getSession } from "@/lib/session";
import { getStore } from "@/lib/store";
import { productionDeps } from "@/lib/sync/production";

type State = ActionResult | null;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function done(result: ActionResult): Promise<ActionResult> {
  revalidatePath("/app");
  return result;
}

export async function createRouteAction(
  _prev: State,
  formData: FormData,
): Promise<ActionResult> {
  const account = await requireAccount();
  return done(
    await createRoute(
      getStore(),
      account.accountId,
      {
        channelIds: formData
          .getAll("channelIds")
          .filter((v): v is string => typeof v === "string"),
        destinationId: text(formData, "destinationId"),
        tagNames: text(formData, "tags").split(","),
      },
      Date.now(),
    ),
  );
}

export async function deleteRouteAction(
  _prev: State,
  formData: FormData,
): Promise<ActionResult> {
  const account = await requireAccount();
  return done(
    await deleteRoute(getStore(), account.accountId, text(formData, "routeId")),
  );
}

export async function toggleRouteAction(
  _prev: State,
  formData: FormData,
): Promise<ActionResult> {
  const account = await requireAccount();
  return done(
    await setRoutePaused(
      getStore(),
      account.accountId,
      text(formData, "routeId"),
      text(formData, "paused") === "true",
    ),
  );
}

export async function addRedditAction(
  _prev: State,
  formData: FormData,
): Promise<ActionResult> {
  const account = await requireAccount();
  return done(
    await addRedditDestination(
      getStore(),
      account.accountId,
      text(formData, "subreddit"),
      Date.now(),
    ),
  );
}

export async function renameDestinationAction(
  _prev: State,
  formData: FormData,
): Promise<ActionResult> {
  const account = await requireAccount();
  return done(
    await renameDestination(
      getStore(),
      account.accountId,
      text(formData, "destinationId"),
      text(formData, "label"),
    ),
  );
}

export async function removeDestinationAction(
  _prev: State,
  formData: FormData,
): Promise<ActionResult> {
  const account = await requireAccount();
  return done(
    await removeDestination(
      getStore(),
      account.accountId,
      text(formData, "destinationId"),
    ),
  );
}

export async function setNotifyAction(
  _prev: State,
  formData: FormData,
): Promise<ActionResult> {
  const account = await requireAccount();
  const id = text(formData, "destinationId");
  return done(
    await setNotifyDestination(getStore(), account.accountId, id || null),
  );
}

export async function sendLatestAction(
  _prev: State,
  formData: FormData,
): Promise<ActionResult> {
  const account = await requireAccount();
  return done(
    await sendLatestPost(
      productionDeps(),
      account.accountId,
      text(formData, "routeId"),
    ),
  );
}

export async function retryAction(
  _prev: State,
  formData: FormData,
): Promise<ActionResult> {
  const account = await requireAccount();
  return done(
    await retryJob(
      productionDeps(),
      account.accountId,
      text(formData, "jobId"),
    ),
  );
}

export async function refreshChannelsAction(): Promise<ActionResult> {
  const account = await requireAccount();
  return done(await refreshChannels(productionDeps(), account.accountId));
}

export async function deleteMyDataAction(): Promise<void> {
  const account = await requireAccount();
  await getStore().deleteAccountData(account.accountId);
  const session = await getSession();
  session.destroy();
  redirect("/");
}

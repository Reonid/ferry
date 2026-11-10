import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getStore } from "@/lib/store";
import type { Account } from "@/lib/types";

export async function currentAccount(): Promise<Account | null> {
  const session = await getSession();
  if (!session.accountId) return null;
  return getStore().getAccount(session.accountId);
}

export async function requireAccount(): Promise<Account> {
  const account = await currentAccount();
  if (!account) redirect("/");
  return account;
}

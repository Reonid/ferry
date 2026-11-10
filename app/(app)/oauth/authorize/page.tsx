import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentAccount } from "@/lib/auth/current";
import { loadKey } from "@/lib/crypto";
import { env } from "@/lib/env";
import { checkAuthorizationRequest } from "@/lib/oauth/authorize";
import { urls } from "@/lib/oauth/http";
import { CheckIcon, LockIcon } from "@/app/components/icons";
import SiteHeader from "@/app/components/SiteHeader";
import ui from "@/app/components/ui.module.css";
import styles from "./page.module.css";

// The address holds the request: keep it out of search engines and out
// of any other site's Referer. Not no-referrer: under that policy the
// browser sends Origin: null with the form, and the CSRF check in
// lib/oauth/consent.ts refuses it. next.config.ts also stops other sites
// framing the page.
export const metadata: Metadata = {
  title: "Connect an app",
  robots: { index: false, follow: false },
  referrer: "same-origin",
};

const SEES = [
  "Your routes and destinations, and whether they work",
  "What Ferry carried in the last 30 days, with the first 80 characters of each post",
  "Your Reddit drafts",
  "Alerts that need you",
];
const CANNOT = [
  "Change routes or destinations, or post anywhere",
  "Touch your Buffer account",
  "See sign-in tokens or webhooks",
];

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function queryOf(
  query: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query))
    for (const one of Array.isArray(value) ? value : value ? [value] : [])
      params.append(name, one);
  return params;
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className={ui.page}>
        <section
          aria-labelledby="connect-title"
          className={`${ui.card} ${styles.card}`}
        >
          {children}
        </section>
      </main>
    </>
  );
}

function List({
  items,
  icon: Icon,
}: {
  items: string[];
  icon: typeof CheckIcon;
}) {
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item}>
          <Icon className={styles.icon} />
          {item}
        </li>
      ))}
    </ul>
  );
}

export default async function AuthorizePage(
  props: PageProps<"/oauth/authorize">,
) {
  const params = queryOf(await props.searchParams);
  const { issuer, resource } = urls();
  const check = checkAuthorizationRequest(params, {
    key: loadKey(env("ENCRYPTION_KEY")),
    issuer,
    resource,
  });
  if (!check.ok) {
    // A known app with a bad request gets its error back, as OAuth asks.
    if (check.redirect !== null) redirect(check.redirect);
    return (
      <Screen>
        <h1 id="connect-title" className={styles.title}>
          This link doesn&apos;t work
        </h1>
        <p className={styles.lede}>{check.message}</p>
        <div className={styles.actions}>
          <Link href="/" className={ui.button}>
            Go to Ferry
          </Link>
        </div>
      </Screen>
    );
  }

  const { request } = check;
  const app = request.client.name ?? "An AI app";
  const host = new URL(request.redirectUri).hostname;
  const query = params.toString();
  const account = await currentAccount();

  if (!account)
    return (
      <Screen>
        <div className={styles.head}>
          <h1 id="connect-title" className={styles.title}>
            Connect {app} to Ferry
          </h1>
          <p className={styles.lede}>
            Sign in with Buffer first, so Ferry knows whose account {app} will
            read. You&apos;ll come straight back here.
          </p>
        </div>
        <div className={styles.actions}>
          <a
            href={`/api/auth/buffer?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`}
            className={`${ui.button} ${ui.primary} ${ui.large}`}
          >
            Sign in with Buffer
          </a>
        </div>
        <p className={ui.hint}>
          Ferry&apos;s access to Buffer is read-only. It can&apos;t post, edit
          or delete anything there.
        </p>
      </Screen>
    );

  return (
    <Screen>
      <div className={styles.head}>
        <h1 id="connect-title" className={styles.title}>
          Connect {app} to Ferry
        </h1>
        <p className={styles.lede}>
          {app} wants to read your Ferry account. When you answer, you&apos;ll
          go back to{" "}
          {LOOPBACK.has(host) ? (
            "an app on this computer"
          ) : (
            <strong className={styles.host}>{host}</strong>
          )}
          .
        </p>
      </div>
      <div className={styles.group}>
        <h2 className={ui.label}>It will see</h2>
        <List items={SEES} icon={CheckIcon} />
      </div>
      <div className={styles.group}>
        <h2 className={ui.label}>It can&apos;t</h2>
        <List items={CANNOT} icon={LockIcon} />
      </div>
      <p className={ui.hint}>
        Signed in with Buffer{account.name ? ` as ${account.name}` : ""}. You
        can disconnect {app} at any time under Settings on your dashboard.
      </p>
      <form
        method="post"
        action={`/api/oauth/authorize?${query}`}
        className={styles.actions}
      >
        <button
          type="submit"
          name="decision"
          value="allow"
          className={`${ui.button} ${ui.primary} ${ui.large}`}
        >
          Allow
        </button>
        <button
          type="submit"
          name="decision"
          value="deny"
          className={`${ui.button} ${ui.large}`}
        >
          Cancel
        </button>
      </form>
    </Screen>
  );
}

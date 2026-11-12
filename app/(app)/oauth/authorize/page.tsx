import type { Metadata } from "next";
import Link from "next/link";
import { currentAccount } from "@/lib/auth/current";
import { loadKey } from "@/lib/crypto";
import { env } from "@/lib/env";
import { checkAuthorizationRequest } from "@/lib/oauth/authorize";
import { consentBinding } from "@/lib/oauth/consent";
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
/** True whatever the owner answers. */
const NEVER = ["Touch your Buffer account", "See sign-in tokens or webhooks"];
const CANNOT = ["Change routes or destinations, or post anywhere", ...NEVER];
/** Where the screen offers changes, the box below is the only way in. */
const CANNOT_UNLESS_ALLOWED = [
  "Change routes or destinations, or post anywhere, unless you allow it below",
  ...NEVER,
];

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Sites whose connectors Ferry expects; any other gets a word of caution. */
const KNOWN_HOSTS = new Set(["claude.ai", "claude.com", "chatgpt.com"]);

function queryOf(
  query: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    // Empty values stay: an app's state="" must come back as it went.
    const values = Array.isArray(value)
      ? value
      : value === undefined
        ? []
        : [value];
    for (const one of values) params.append(name, one);
  }
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
  const key = loadKey(env("ENCRYPTION_KEY"));
  const check = checkAuthorizationRequest(params, { key, issuer, resource });
  if (!check.ok) {
    // Shown here, never sent on. Anyone can register an app, so sending
    // errors to its redirect URI before the owner answers would let any
    // site bounce visitors through Ferry's address (RFC 9700 4.11.2).
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
          {app} wants to read your Ferry account
          {request.offerWrite ? ", and asks to make changes too" : ""}. When you
          answer, you&apos;ll go back to{" "}
          {LOOPBACK.has(host) ? (
            "an app on this computer"
          ) : (
            <strong className={styles.host}>{host}</strong>
          )}
          .
        </p>
        {!LOOPBACK.has(host) && !KNOWN_HOSTS.has(host) && (
          <p className={styles.caution}>
            Ferry doesn&apos;t know {host}. Allow only if you started connecting
            Ferry there just now.
          </p>
        )}
      </div>
      <div className={styles.group}>
        <h2 className={ui.label}>It will see</h2>
        <List items={SEES} icon={CheckIcon} />
      </div>
      <div className={styles.group}>
        <h2 className={ui.label}>It can&apos;t</h2>
        <List
          items={request.offerWrite ? CANNOT_UNLESS_ALLOWED : CANNOT}
          icon={LockIcon}
        />
      </div>
      <form
        method="post"
        action={`/api/oauth/authorize?${query}`}
        className={styles.answer}
      >
        <input
          type="hidden"
          name="account"
          value={consentBinding(key, account.accountId)}
        />
        {request.offerWrite && (
          <div className={styles.changes}>
            <label className={styles.choice}>
              <input
                type="checkbox"
                name="write"
                value="yes"
                aria-describedby="changes-detail"
              />
              Also let {app} make changes
            </label>
            <p id="changes-detail" className={ui.hint}>
              It could add subreddits, pause and resume routes, add routes, send
              failed posts again, and send a route&apos;s latest post as a test.
              It still couldn&apos;t delete anything or connect Discord or
              Telegram. Leave this off and it can only read.
            </p>
          </div>
        )}
        <p className={ui.hint}>
          Signed in with Buffer{account.name ? ` as ${account.name}` : ""}. You
          can disconnect {app} at any time under Settings on your dashboard.
        </p>
        <div className={styles.actions}>
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
        </div>
      </form>
    </Screen>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import SiteHeader from "../components/SiteHeader";
import ui from "../components/ui.module.css";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "Everything Ferry stores, how long it keeps it, and who else handles it.",
};

/*
 * Written from the code. The store and its TTLs are in lib/store/store.ts
 * and lib/constants.ts (pinned by lib/constants.test.ts), cookies are set in
 * lib/session.ts and app/api/, and deleting is lib/store's deleteAccountData.
 */

interface Item {
  name: ReactNode;
  /** How long it's kept, for things that expire on their own. */
  time?: string;
  detail: ReactNode;
}

// Kept on one line: "AES-" alone at a line end reads as a broken word.
const AES = <span className={styles.nowrap}>AES-256-GCM</span>;

const KEPT: Item[] = [
  {
    name: "Your account",
    detail:
      "Your Buffer account ID, name, time zone and organization IDs, whether Buffer has disconnected Ferry, where your alerts go, and when you first signed in.",
  },
  {
    name: "Buffer sign-in tokens",
    detail: (
      <>
        The access and refresh tokens Buffer gives Ferry, and when they expire.
        They&apos;re encrypted with {AES} and never sent to your browser.
      </>
    ),
  },
  {
    name: "Your channels",
    detail:
      "Each Buffer channel's ID, organization, network, name and avatar link, and whether it's disconnected, paused or locked.",
  },
  {
    name: "Routes",
    detail:
      "Which channels go to which destination, the tags a post needs, whether the route is paused, and when it started.",
  },
  {
    name: "Destinations",
    detail: (
      <>
        For Discord: the name you give it, the server and channel IDs, and the
        webhook Ferry posts through. The webhook token is encrypted with {AES}{" "}
        and never sent to your browser. For Telegram: the chat&apos;s ID, title
        and username, or for a DM only the chat ID. For Reddit: the
        subreddit&apos;s name. Removing a destination deletes it.
      </>
    ),
  },
  {
    name: "Sync schedule",
    detail:
      "When Ferry last checked Buffer for you, how far it has read, and when it checks next.",
  },
  {
    name: "Alerts",
    detail:
      "Your 20 newest alerts, such as a post Buffer couldn't publish, with Buffer's error message and help link.",
  },
];

const EXPIRING: Item[] = [
  {
    name: "Delivery claims",
    time: "24 hours to 45 days",
    detail:
      "IDs only: a destination's ID paired with the post's IDs, or with a one-way fingerprint of the post. They make sure a post crosses only once.",
  },
  {
    name: "Activity",
    time: "30 days",
    detail:
      "For each post Ferry sends: up to its first 80 characters, the channel it came from, when Buffer published it, and how each delivery went, with a link to the Discord or Telegram message, or to the Reddit draft.",
  },
  {
    name: "Reddit drafts",
    time: "7 days",
    detail:
      "Each draft's title, body text and link, and the addresses and alt text of its images. A draft's page opens from its own unguessable link without signing in, so it works from Discord or Telegram on your phone, and anyone you give that link can read it.",
  },
  {
    name: "Posts waiting to retry",
    time: "up to one day",
    detail:
      "A full copy of a post while Ferry delivers it: its text, image links and source channel. If a delivery keeps failing, the copy stays up to one day after the last try, so you can retry it.",
  },
  {
    name: "Telegram link codes",
    time: "up to 15 minutes",
    detail:
      "Each one-time code that connects a Telegram chat, with your account ID and, once a chat uses it, the chat it connected.",
  },
  {
    name: "Sent-alert markers",
    time: "7 days",
    detail: "IDs only. They stop the same problem from being reported twice.",
  },
  {
    name: "API-call counters",
    time: "2 days",
    detail:
      "How many Buffer API calls Ferry made for you each day, for the count on your dashboard.",
  },
  {
    name: "Sync locks",
    time: "up to a minute",
    detail: "They stop two syncs of your account from running at once.",
  },
];

const COOKIES: Item[] = [
  {
    name: <code>ferry_session</code>,
    time: "30 days",
    detail:
      "Keeps you signed in. It's encrypted and holds only your account ID.",
  },
  {
    name: (
      <>
        <code>ferry_oauth_state</code> and <code>ferry_oauth_verifier</code>
      </>
    ),
    time: "up to 10 minutes",
    detail:
      "Protect your sign-in with Buffer from forgery. They're removed as soon as sign-in finishes.",
  },
  {
    name: <code>ferry_discord_state</code>,
    time: "up to 10 minutes",
    detail:
      "Protects connecting Discord the same way. It's removed as soon as the connection finishes.",
  },
];

/** "Name, how long" over what it holds: the same shape for every entry. */
function Items({ items }: { items: Item[] }) {
  return (
    <dl className={styles.items}>
      {items.map((item, i) => (
        <div key={i} className={styles.item}>
          <dt className={styles.term}>
            {item.name}
            {item.time && (
              <>
                , <span className={styles.time}>{item.time}</span>
              </>
            )}
          </dt>
          <dd className={styles.detail}>{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className={ui.page}>
        <div className={styles.doc}>
          <div className={styles.intro}>
            <h1 className={ui.title}>Privacy</h1>
            <p className={styles.lede}>
              Ferry keeps only what it needs to carry your posts, and most of it
              for days, not years. This page lists everything it stores, written
              from{" "}
              <a href="https://github.com/Reonid/ferry">
                Ferry&apos;s source code
              </a>
              .
            </p>
          </div>

          <section aria-labelledby="stored-title" className={styles.section}>
            <h2 id="stored-title" className={ui.heading}>
              What Ferry stores
            </h2>
            <p>
              Ferry reads your account, channels and posts from Buffer with
              read-only access, so it can&apos;t post, edit or delete anything
              there. It keeps the following in its database.
            </p>
            <h3 className={styles.group}>Kept until you delete your data</h3>
            <Items items={KEPT} />
            <h3 className={styles.group}>
              Kept for a set time, then deleted on its own
            </h3>
            <Items items={EXPIRING} />
            <p className={styles.aside}>
              Ferry also keeps Buffer&apos;s latest rate-limit numbers and how
              far it has read Telegram&apos;s updates for its bot, which
              aren&apos;t about anyone in particular.
            </p>
          </section>

          <section aria-labelledby="cookies-title" className={styles.section}>
            <h2 id="cookies-title" className={ui.heading}>
              Cookies
            </h2>
            <Items items={COOKIES} />
            <p>Ferry sets no other cookies.</p>
          </section>

          <section aria-labelledby="others-title" className={styles.section}>
            <h2 id="others-title" className={ui.heading}>
              Who else handles your data
            </h2>
            <ul className={styles.list}>
              <li>
                <strong>Vercel</strong> hosts Ferry. Every page you open and
                every post Ferry carries passes through Vercel&apos;s servers.
              </li>
              <li>
                <strong>Upstash</strong> runs Ferry&apos;s database, Redis,
                which holds everything listed above. Its QStash service wakes
                Ferry every two minutes to check for posts, and gets back only
                counts.
              </li>
              <li>
                <strong>Discord</strong> receives what you route there: your
                posts, Reddit draft notices and alerts, through the webhook for
                the channel you picked. Ferry keeps no Discord sign-in and
                can&apos;t read your server.
              </li>
              <li>
                <strong>Telegram</strong> receives what you route there through
                its Bot API: your posts, Reddit draft notices and alerts, in the
                chats you connect. In groups, Ferry&apos;s bot sees only
                commands sent to it. In a channel, it reads posts only to find a
                link code, and never stores them. Telegram has no alt text, so
                images arrive there without their descriptions.
              </li>
            </ul>
            <p>
              Ferry never posts to Reddit. Opening a draft&apos;s Reddit link
              sends its title and text to Reddit&apos;s submit page, and nothing
              is posted until you press Post there. Ferry has no analytics and
              no ads, and it never writes tokens or post text to its logs.
            </p>
          </section>

          <section aria-labelledby="leaving-title" className={styles.section}>
            <h2 id="leaving-title" className={ui.heading}>
              Signing out and deleting your data
            </h2>
            <p>
              Signing out ends this browser&apos;s session, but syncing
              continues until you choose Delete my data.
            </p>
            <p>
              Delete my data is under Settings on your dashboard. It deletes
              everything above and signs you out. A few records run out on their
              own instead, on the schedule above: delivery claims, Telegram link
              codes, sent-alert markers, API-call counters and sync locks.
              Nothing changes in Buffer.
            </p>
            <p>
              Removing a Discord destination, or deleting your data, deletes
              Ferry&apos;s copy of its webhook. The webhook itself stays in your
              server until you delete it in Discord, under the channel&apos;s
              Integrations settings. Ferry&apos;s bot stays in a Telegram chat
              until you remove it there.
            </p>
          </section>

          <section aria-labelledby="questions-title" className={styles.section}>
            <h2 id="questions-title" className={ui.heading}>
              Questions
            </h2>
            <p>
              <a href="https://github.com/Reonid/ferry/issues">
                Open an issue on GitHub
              </a>
              . Issues are public, so leave out anything private.
            </p>
            <p className={styles.updated}>Last updated November 7, 2026.</p>
          </section>
        </div>
      </main>
    </>
  );
}

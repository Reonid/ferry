import type { ReactNode } from "react";
import { currentAccount } from "@/lib/auth/current";
import BrandMark from "@/app/components/BrandMark";
import { DISCLAIMER } from "@/app/components/disclaimer";
import ExampleCrossing from "@/app/components/ExampleCrossing";
import { LockIcon } from "@/app/components/icons";
import HowItWorks from "./HowItWorks";
import PlacesSwitcher, { type Place } from "./PlacesSwitcher";
import { DiscordPreview, RedditPreview, TelegramPreview } from "./Previews";
import Shot from "./Shot";
import SiteNav from "./SiteNav";
import styles from "./landing.module.css";
import activityDark from "./screens/activity-dark.jpg";
import activityLight from "./screens/activity-light.jpg";
import draftsDark from "./screens/drafts-dark.jpg";
import draftsLight from "./screens/drafts-light.jpg";

/*
 * Ferry's landing, built on the principles Buffer's own product pages
 * follow: one calm headline, the real product shown large on a pastel
 * card, numbers shown openly, features as a few words, a check-list and
 * the product itself, questions in an accordion. The look is Ferry's own
 * (app/styles/tokens.css); the record of its decisions heads ./site.css.
 */

/** What happened, after Sign out or Delete my data lands someone here. */
const LEFT: Record<string, string> = {
  "signed-out":
    "You’re signed out. Ferry keeps carrying your posts until you choose Delete my data.",
  deleted: "Your data is deleted, and Ferry has stopped carrying your posts.",
};

/** What Ferry promises about Buffer access, word for word wherever it's said. */
const PROMISE =
  "Ferry can read your Buffer posts. It can't post, edit or delete anything.";

/** The board's own figures, most votes first (suggestions.buffer.com). */
const VOTES = [
  {
    count: "3.0K",
    name: "Reddit",
    icon: "reddit",
    does: "Drafts, posted by you",
  },
  {
    count: "1.5K",
    name: "Telegram",
    icon: "telegram",
    does: "Posted automatically",
  },
  {
    count: "1.4K",
    name: "Discord",
    icon: "discord",
    does: "Posted automatically",
  },
];

const PLACES: Place[] = [
  {
    id: "discord",
    tabId: "tab-discord",
    panelId: "panel-discord",
    tab: "Discord",
    text: "A message under your channel's name and avatar, with its images, alt text and a link back to the post.",
    points: [
      "Your Buffer channel's name and avatar",
      "Images, with their alt text",
      "A button back to the original post",
    ],
    link: { href: "#how", label: "See how a channel connects" },
    preview: <DiscordPreview />,
  },
  {
    id: "telegram",
    tabId: "tab-telegram",
    panelId: "panel-telegram",
    tab: "Telegram",
    text: "A post in your channel or group with its photos and a button back to the original. Alerts can come to you in a DM.",
    points: [
      "Channels and groups",
      "Photos, and a button back to the post",
      "Alerts in a DM, if you want them",
    ],
    link: { href: "#how", label: "See how a chat connects" },
    preview: <TelegramPreview />,
  },
  {
    id: "reddit",
    tabId: "tab-reddit",
    panelId: "panel-reddit",
    tab: "Reddit draft",
    text: "A draft with the title and the text filled in. One tap opens Reddit, and nothing is posted until you press Post.",
    points: [
      "The title and text, filled in",
      "One tap opens Reddit",
      "Nothing is posted until you press Post",
    ],
    link: { href: "#questions", label: "Read why Reddit gets drafts" },
    preview: <RedditPreview />,
  },
];

const DASHBOARD_POINTS = [
  "Every post, with each place it reached",
  "A failed delivery says why, with Retry beside it",
  "Reddit drafts wait for you for 7 days",
];

const QUESTIONS: { q: string; a: ReactNode }[] = [
  {
    q: "How is Ferry different from Zapier?",
    a: "Ferry is built for Buffer: routes follow the tags in Buffer’s composer, a post sent to several channels arrives once, and a failed delivery raises an alert with a Retry button.",
  },
  {
    q: "Why does Reddit get a draft?",
    a: "Reddit is wary of automated posting, so a person makes the last click. Ferry fills in the title and text, and you press Post.",
  },
  {
    q: "How fast do Buffer posts arrive?",
    a: "A scheduled post arrives within about 3 minutes of going out. Ferry checks Buffer about once a minute while your dashboard is open, and every 15 minutes to 2 hours otherwise.",
  },
  {
    q: "What does Ferry store?",
    a: (
      <>
        Your channels, routes and destinations, 30 days of activity and 7 days
        of Reddit drafts. Tokens and webhooks are encrypted with AES-256-GCM.{" "}
        <a href="/privacy">The privacy page lists it all</a>.
      </>
    ),
  },
  {
    q: "Can I use Ferry from Claude or ChatGPT?",
    a: "Yes. Add Ferry as a custom connector with the address under Settings on your dashboard, then ask what crossed today, why a post didn’t arrive, or for a sharper Reddit draft with a link to post it. It only reads, unless you allow changes when you connect it: then it can also add subreddits, pause, resume and add routes, send a failed post again and test a route. It can’t delete anything. It works alongside Buffer’s own MCP server, which writes and schedules your posts.",
  },
  {
    q: "Is Ferry open source?",
    a: (
      <>
        Yes, under the MIT license.{" "}
        <a href="https://github.com/Reonid/ferry">The code is on GitHub</a>.
      </>
    ),
  },
];

function Check() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={styles.tick}>
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

export default async function Home(props: PageProps<"/">) {
  const [account, query] = await Promise.all([
    currentAccount(),
    props.searchParams,
  ]);
  // The main action, word for word in the bar, the hero and the close.
  const main = account
    ? { href: "/app", label: "Open Ferry" }
    : { href: "/api/auth/buffer", label: "Sign in with Buffer" };
  const left = typeof query.left === "string" ? LEFT[query.left] : undefined;

  return (
    <>
      <SiteNav action={main} />
      <main id="main" className={styles.main}>
        <section id="top" className={styles.hero} aria-labelledby="hero-h">
          <div className="container">
            {query.error === "signin" && (
              <p role="alert" className={styles.notice}>
                Sign-in didn&apos;t finish.{" "}
                <a href="/api/auth/buffer">Try again.</a>
              </p>
            )}
            {left && (
              <p role="status" className={styles.notice}>
                {left}
              </p>
            )}
            <div className={styles.heroText}>
              <h1 id="hero-h" className={styles.heroHead}>
                Your Buffer posts on Discord and Telegram
              </h1>
              <div className={styles.heroSide}>
                <p className={styles.lead}>
                  Keep writing in Buffer. Ferry sends each post on within about
                  3 minutes, and drafts it for Reddit.
                </p>
                <div className={styles.actions}>
                  <a href={main.href} className={styles.primary}>
                    {main.label}
                  </a>
                  <a href="#places" className={styles.secondary}>
                    See where posts land
                  </a>
                </div>
                <p className={styles.promise}>
                  <LockIcon className={styles.lock} />
                  {PROMISE}
                </p>
              </div>
            </div>
            <div
              className={styles.heroVisual}
              data-slot="map"
              data-kind="product"
              data-alt="Ferry's crossing map, as the dashboard draws your routes"
            >
              <ExampleCrossing
                className={styles.window}
                barClassName={styles.windowBar}
                titleClassName={styles.windowTitle}
                replayClassName={styles.replay}
                mapClassName={styles.map}
                title="Your routes, as Ferry’s dashboard draws them"
              />
            </div>
          </div>
        </section>

        {/* The board's own numbers, shown openly. */}
        <section
          id="connect"
          className={styles.votes}
          aria-labelledby="connect-h"
        >
          <div className="container">
            <div className={styles.split}>
              <h2 id="connect-h" className={styles.sectionHead}>
                Three of Buffer&apos;s most-requested channels
              </h2>
              <p className={styles.splitLine}>
                Each one is among the most-voted requests on{" "}
                <a href="https://suggestions.buffer.com">
                  Buffer&apos;s suggestion board
                </a>
                . Any channel Buffer publishes to can feed a route.
              </p>
            </div>
            <ol
              className={styles.figures}
              aria-label="Votes on Buffer's suggestion board, and what Ferry does with each channel"
            >
              {VOTES.map((vote) => (
                <li key={vote.name} className={styles.figure}>
                  <span className={styles.count}>
                    {vote.count}
                    <span className={styles.unit}> votes</span>
                  </span>
                  <span className={styles.figureName}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a 1 KB SVG mark */}
                    <img
                      src={`/networks/${vote.icon}.svg`}
                      alt=""
                      width={22}
                      height={22}
                    />
                    {vote.name}
                  </span>
                  <span className={styles.figureDoes}>{vote.does}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* One post, shaped for each place it lands. */}
        <section
          id="places"
          className={styles.places}
          aria-labelledby="places-h"
        >
          <div className="container">
            <PlacesSwitcher
              places={PLACES}
              intro={
                <>
                  <h2 id="places-h" className={styles.sectionHead}>
                    Ferry shapes each post for its destination
                  </h2>
                  <p className={styles.sectionLine}>
                    There is no second composer: one Buffer post becomes a
                    Discord message, a Telegram post and a Reddit draft.
                  </p>
                </>
              }
            />
          </div>
        </section>

        {/* Three steps, side by side. */}
        <section id="how" className={styles.how} aria-labelledby="how-h">
          <div className="container">
            <HowItWorks />
          </div>
        </section>

        {/* The dashboard, captured from the app, on a butter card. */}
        <section id="app" className={styles.app} aria-labelledby="app-h">
          <div className={`container ${styles.feature}`}>
            <div className={styles.featureText}>
              <h2 id="app-h" className={styles.sectionHead}>
                Every delivery in one dashboard
              </h2>
              <p>
                Each post Buffer publishes lands here with every place it went:
                delivered, waiting as a Reddit draft, or held for a retry you
                start with one click.
              </p>
              <ul className={styles.points}>
                {DASHBOARD_POINTS.map((point) => (
                  <li key={point}>
                    <Check />
                    {point}
                  </li>
                ))}
              </ul>
              <a href="/privacy" className={styles.textLink}>
                See what Ferry stores
              </a>
            </div>
            <div
              className={styles.featureCard}
              data-slot="activity"
              data-kind="product"
              data-alt="The dashboard's Activity and Reddit drafts"
            >
              <Shot
                light={activityLight}
                dark={activityDark}
                alt="Activity: three posts. Two were delivered to #announcements and a Telegram channel; one waits as a Reddit draft; one says Needs you, Discord returned HTTP 500, with a Retry button."
                sizes="(min-width: 60rem) 38rem, 92vw"
              />
              <Shot
                light={draftsLight}
                dark={draftsDark}
                alt="Reddit drafts: one draft for r/SideProject, prepared 5 hours ago, expiring in 7 days."
                sizes="(min-width: 60rem) 30rem, 80vw"
                className={styles.shotOver}
              />
            </div>
          </div>
        </section>

        {/* Questions, as an accordion. */}
        <section
          id="questions"
          className={styles.questions}
          aria-labelledby="questions-h"
        >
          <div className={`container ${styles.faqGrid}`}>
            <div className={styles.faqHead}>
              <h2 id="questions-h" className={styles.sectionHead}>
                Questions
              </h2>
              <p>
                Something else?{" "}
                <a href="https://github.com/Reonid/ferry/issues">
                  Ask on GitHub
                </a>
              </p>
            </div>
            <div className={styles.faq}>
              {QUESTIONS.map((item) => (
                <details key={item.q} className={styles.faqItem}>
                  <summary>
                    <h3>{item.q}</h3>
                  </summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer} aria-labelledby="close-h">
        <div className="container">
          <div className={styles.close}>
            <div>
              <h2 id="close-h" className={styles.closeHead}>
                Your next post, in three more places
              </h2>
              <p className={styles.closeLine}>
                Read access only. Delete your data whenever you like.
              </p>
            </div>
            <a href={main.href} className={styles.primary}>
              {main.label}
            </a>
          </div>
        </div>
        <div className={styles.footBand}>
          <div className={`container ${styles.foot}`}>
            <div className={styles.footAbout}>
              <a
                href="#top"
                className={styles.footBrand}
                aria-label="Ferry, back to the top"
              >
                <BrandMark />
              </a>
              <p>Sends the posts Buffer publishes to Discord and Telegram.</p>
            </div>
            <ul className={styles.footLinks}>
              <li>
                <a href="#places">Destinations</a>
              </li>
              <li>
                <a href="#how">How it works</a>
              </li>
              <li>
                <a href="#questions">Questions</a>
              </li>
              <li>
                <a href="/privacy">Privacy</a>
              </li>
              <li>
                <a href="https://github.com/Reonid/ferry">Source on GitHub</a>
              </li>
            </ul>
            <p className={styles.disclaimer}>{DISCLAIMER}</p>
          </div>
        </div>
      </footer>
    </>
  );
}

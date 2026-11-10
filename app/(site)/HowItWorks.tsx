import { BUFFER_SCOPE_PARTS } from "./scopes";
import styles from "./How.module.css";

const STEPS = [
  {
    name: "Sign in with Buffer",
    text: "Ferry asks for read access only: your account, your posts and the right to keep checking.",
  },
  {
    name: "Connect Discord, Telegram or Reddit",
    text: "Pick a Discord channel on Discord’s own screen, add Ferry to a Telegram chat, or name a subreddit.",
  },
  {
    name: "Route your Buffer channels",
    text: "Choose which Buffer channels go where, and which tags. Posts cross on their own after that.",
  },
] as const;

const PLACES = [
  { icon: "discord", name: "#announcements", kind: "Discord" },
  { icon: "telegram", name: "@yourchannel", kind: "Telegram" },
  { icon: "reddit", name: "r/yoursubreddit", kind: "Reddit drafts" },
];

/** What each step looks like in Ferry: a small card of three rows. */
function Detail({ step }: { step: number }) {
  if (step === 0)
    return (
      <dl className={styles.scopes}>
        {BUFFER_SCOPE_PARTS.map(([scope, meaning]) => (
          <div key={scope}>
            <dt>
              <code>{scope}</code>
            </dt>
            <dd>{meaning}</dd>
          </div>
        ))}
      </dl>
    );
  if (step === 1)
    return (
      <ul className={styles.places}>
        {PLACES.map((place) => (
          <li key={place.name}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a 1 KB SVG mark */}
            <img
              src={`/networks/${place.icon}.svg`}
              alt=""
              width={20}
              height={20}
              loading="lazy"
            />
            <span className={styles.placeName}>{place.name}</span>
            <span className={styles.placeKind}>{place.kind}</span>
          </li>
        ))}
      </ul>
    );
  return (
    <dl className={styles.route}>
      <dt>From</dt>
      <dd>Bluesky, LinkedIn</dd>
      <dt>To</dt>
      <dd>#announcements</dd>
      <dt>Only</dt>
      <dd>
        posts tagged <span className={styles.tag}>community</span>
      </dd>
    </dl>
  );
}

/** The three steps to a first crossing, side by side. */
export default function HowItWorks() {
  return (
    <>
      <h2 id="how-h" className={styles.head}>
        Set up Ferry in 3 steps
      </h2>
      {/* "steps" stays a plain class: the browser tests find the list by it. */}
      <ol className={`steps ${styles.steps}`} role="list">
        {STEPS.map((step, i) => (
          <li key={step.name} className={styles.step}>
            <div className={styles.words}>
              <h3 className={styles.stepName}>{step.name}</h3>
              <p className={styles.stepText}>{step.text}</p>
            </div>
            <Detail step={i} />
          </li>
        ))}
      </ol>
    </>
  );
}

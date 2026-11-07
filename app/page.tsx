import Link from "next/link";
import { currentAccount } from "@/lib/auth/current";
import ExampleCrossing from "./components/ExampleCrossing";
import SiteHeader from "./components/SiteHeader";
import ui from "./components/ui.module.css";
import styles from "./page.module.css";

const STEPS = [
  {
    name: "Sign in",
    text: "Use your Buffer account. Ferry asks only for read access.",
  },
  {
    name: "Connect Discord or Telegram",
    text: "Pick a channel on Discord's own screen, or add Ferry to a Telegram channel or group. Ferry can post there and nowhere else.",
  },
  {
    name: "Draw a route",
    text: "Choose which Buffer channels go to which destination. Posts Buffer publishes after that cross on their own.",
  },
];

export default async function Home(props: PageProps<"/">) {
  const [account, query] = await Promise.all([
    currentAccount(),
    props.searchParams,
  ]);
  const cta = `${ui.button} ${ui.primary} ${styles.cta}`;
  return (
    <>
      <SiteHeader brand="current" />
      <main className={styles.main}>
        {query.error === "signin" && (
          <p role="alert" className={styles.notice}>
            Sign-in didn&apos;t finish.{" "}
            <a href="/api/auth/buffer">Try again.</a>
          </p>
        )}

        <div className={styles.hero}>
          <h1 className={styles.pitch}>
            Ferry carries your Buffer posts to the places Buffer doesn&apos;t
            go.
          </h1>
          <p className={styles.lede}>
            Keep writing in Buffer. When Buffer publishes a post, Ferry sends it
            on to your Discord or Telegram channel and prepares a Reddit draft
            you post with one tap.
          </p>
          <div className={styles.start}>
            {account ? (
              <Link href="/app" className={cta}>
                Open Ferry
              </Link>
            ) : (
              // A plain link: sign-in is a full redirect to Buffer, never a
              // client-side navigation or a prefetch.
              <a href="/api/auth/buffer" className={cta}>
                Sign in with Buffer
              </a>
            )}
            <p className={styles.promise}>
              Ferry can read your Buffer posts. It can&apos;t post, edit or
              delete anything.
            </p>
          </div>
        </div>

        <figure className={styles.figure}>
          <ExampleCrossing />
          <figcaption className={styles.caption}>
            An example. Once you sign in, your map shows your own channels and
            destinations.
          </figcaption>
        </figure>

        <section aria-labelledby="how-title" className={styles.how}>
          <h2 id="how-title" className={ui.heading}>
            How it works
          </h2>
          {/* role="list" keeps list semantics in Safari despite list-style: none. */}
          <ol role="list" className={styles.steps}>
            {STEPS.map((step, i) => (
              <li key={step.name} className={styles.step}>
                <span className={styles.port} aria-hidden="true">
                  {i + 1}
                </span>
                <h3 className={styles.stepName}>{step.name}</h3>
                <p className={styles.stepText}>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <p className={styles.board}>
          Reddit (3.0K votes), Telegram (1.5K) and Discord (1.4K) are among the
          most-voted requests on{" "}
          <a href="https://suggestions.buffer.com">
            Buffer&apos;s suggestion board
          </a>
          . Ferry starts with Discord, Telegram and Reddit.
        </p>
      </main>
    </>
  );
}

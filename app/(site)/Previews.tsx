import styles from "./Previews.module.css";

/*
 * One Buffer post as it lands in each place, drawn the way each app shows
 * it, from what Ferry really sends: the channel's name and picture, the
 * text, the image with its alt text, and a link back to the post
 * (lib/destinations/*). The names are placeholders, so nobody reads them
 * as real accounts.
 */

const POST = "We just opened the beta. Come break things with us.";
const PHOTO = {
  src: "/sample/hills-at-sunrise.jpg",
  alt: "Golden haze over rolling green hills at sunrise",
  width: 960,
  height: 640,
};

function Logo({ name, size = 20 }: { name: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a 1 KB SVG mark
    <img
      src={`/networks/${name}.svg`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
    />
  );
}

function Photo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a sample photo inside a drawn app, sized by its frame
    <img
      className={className}
      src={PHOTO.src}
      alt={PHOTO.alt}
      width={PHOTO.width}
      height={PHOTO.height}
      loading="lazy"
    />
  );
}

function OutIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={styles.out}>
      <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v3.5a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5h3.5" />
    </svg>
  );
}

function DiscordMessage({
  icon,
  channel,
  when,
  text,
  link,
  photo = false,
}: {
  icon: string;
  channel: string;
  when: string;
  text: string;
  link: string;
  photo?: boolean;
}) {
  return (
    <div className={styles.dcMessage}>
      <span className={styles.dcAvatar}>
        <Logo name={icon} size={22} />
      </span>
      <div className={styles.dcBody}>
        <p className={styles.dcBy}>
          <b>{channel}</b>
          <span className={styles.dcApp}>App</span>
          <span className={styles.dcTime}>{when}</span>
        </p>
        <p>{text}</p>
        {photo && <Photo className={styles.dcPhoto} />}
        <span className={styles.dcLink}>
          {link}
          <OutIcon />
        </span>
      </div>
    </div>
  );
}

/** A Discord channel after two crossings. */
export function DiscordPreview() {
  return (
    <div className={styles.discord}>
      <p className={styles.dcHead}>
        <span aria-hidden="true">#</span>
        announcements
      </p>
      <div className={styles.dcThread}>
        <DiscordMessage
          icon="linkedin"
          channel="Your LinkedIn"
          when="Yesterday at 17:02"
          text="What we learned shipping our first release"
          link="View on LinkedIn"
        />
        <p className={styles.dcDay}>
          <span>Today</span>
        </p>
        <DiscordMessage
          icon="bluesky"
          channel="Your Bluesky"
          when="Today at 9:43"
          text={POST}
          link="View on Bluesky"
          photo
        />
      </div>
      <p className={styles.dcInput} aria-hidden="true">
        Message #announcements
      </p>
    </div>
  );
}

/** A Telegram channel's posts, with the button back to each original. */
export function TelegramPreview() {
  return (
    <div className={styles.telegram}>
      <div className={styles.tgHead}>
        <span className={styles.tgAvatar} aria-hidden="true">
          Y
        </span>
        <p className={styles.tgName}>
          <b>Your channel</b>
          <span>channel</span>
        </p>
      </div>
      <div className={styles.tgChat}>
        <div className={styles.tgPost}>
          <div className={styles.tgBubble}>
            <p>
              Release notes for version 2.4 are up
              <span className={styles.tgTime}>8:15</span>
            </p>
          </div>
          <span className={styles.tgButton}>View on Threads</span>
        </div>
        <div className={styles.tgPost}>
          <div className={styles.tgBubble}>
            <Photo className={styles.tgPhoto} />
            <p>
              {POST}
              <span className={styles.tgTime}>9:43</span>
            </p>
          </div>
          <span className={styles.tgButton}>View on Bluesky</span>
        </div>
      </div>
    </div>
  );
}

/** Ferry's own draft page, where one tap opens Reddit filled in. */
export function RedditPreview() {
  return (
    <div className={styles.reddit}>
      <p className={styles.rdTitle}>Reddit draft for r/yoursubreddit</p>
      <div className={styles.rdAct}>
        <span className={styles.rdPost}>Post to r/yoursubreddit</span>
        <span className={styles.rdNote}>
          Nothing is posted until you press Post.
        </span>
      </div>
      <div className={styles.rdField}>
        <span className={styles.rdLabel}>Title</span>
        <p className={styles.rdValue}>We just opened the beta.</p>
      </div>
      <div className={styles.rdField}>
        <span className={styles.rdLabel}>Body text</span>
        <p className={styles.rdValue}>{POST}</p>
      </div>
      <div className={styles.rdField}>
        <span className={styles.rdLabel}>Images, attached by hand</span>
        <Photo className={styles.rdPhoto} />
        <span className={styles.rdNote}>Alt text: {PHOTO.alt}</span>
      </div>
    </div>
  );
}

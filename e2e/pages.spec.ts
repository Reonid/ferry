import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { tabTo } from "./keyboard";

const DISCLAIMER =
  "Ferry is an independent project built on the Buffer API. It is not affiliated with or endorsed by Buffer.";
const PITCH =
  "Ferry carries your Buffer posts to the places Buffer doesn't go.";
const PROMISE =
  "Ferry can read your Buffer posts. It can't post, edit or delete anything.";
const DRAFT_TITLE = "We just opened the beta of our scheduling side project";
const DRAFT_BODY = "We just opened the beta. Come break things with us.";
const IMAGE_NOTE =
  "Reddit doesn't accept images through links, so attach these by hand.";

/** Seeds the dev account and its Reddit draft, without signing a page in. */
async function seed(request: APIRequestContext): Promise<void> {
  const response = await request.get("/api/dev/login", { maxRedirects: 0 });
  expect(response.status(), "dev login").toBe(307);
}

/** Signs this page's browser in as the seeded account. */
async function signIn(page: Page): Promise<void> {
  await seed(page.request);
}

/** Opens the seeded draft and waits for hydration: Copy only works after it. */
async function openDraft(page: Page): Promise<void> {
  await page.goto("/d/dev-draft");
  await expect(page.getByRole("button", { name: "Copy title" })).toBeEnabled();
}

test("landing shows the pitch and the read-only promise", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(PITCH);
  await expect(page.getByText(PROMISE, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in with Buffer" }),
  ).toHaveAttribute("href", "/api/auth/buffer");
  await expect(page.getByRole("link", { name: "Open Ferry" })).toHaveCount(0);
  // Scoped to main: Next's route announcer is an alert outside it.
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);

  const steps = page
    .getByRole("region", { name: "How it works" })
    .getByRole("listitem");
  await expect(steps).toHaveCount(3);
  for (const [i, name] of [
    "Sign in",
    "Connect Discord",
    "Draw a route",
  ].entries())
    await expect(steps.nth(i).getByRole("heading", { level: 3 })).toHaveText(
      name,
    );

  const board = page.getByRole("link", { name: "Buffer's suggestion board" });
  await expect(board).toHaveAttribute("href", "https://suggestions.buffer.com");
  await expect(page.locator("p", { has: board })).toHaveText(
    /Reddit.+3\.0K.+Telegram.+1\.5K.+Discord.+1\.4K/,
  );

  await expect(
    page.getByRole("img", { name: /^Example crossing map/ }),
  ).toBeVisible();
});

test("landing reports a sign-in that didn't finish", async ({ page }) => {
  await page.goto("/?error=signin");
  const alert = page.getByRole("main").getByRole("alert");
  await expect(alert).toHaveText("Sign-in didn't finish. Try again.");
  await expect(alert.getByRole("link", { name: "Try again." })).toHaveAttribute(
    "href",
    "/api/auth/buffer",
  );
});

test("landing opens Ferry when signed in", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Open Ferry" })).toHaveAttribute(
    "href",
    "/app",
  );
  await expect(
    page.getByRole("link", { name: "Sign in with Buffer" }),
  ).toHaveCount(0);
  await expect(page.getByText(PROMISE, { exact: true })).toBeVisible();
});

test("the landing map sails once, and stays still under reduced motion", async ({
  page,
}) => {
  await page.goto("/");
  const map = page.getByRole("img", { name: /^Example crossing map/ });
  await map.scrollIntoViewIfNeeded();
  await expect(map.locator("[data-lane]")).toHaveCount(3);
  await expect(map.locator("[data-boat]").first()).toBeVisible({
    timeout: 10_000,
  });
  // Every boat lands and leaves, and no second sailing follows.
  await expect(map.locator("[data-boat]")).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(1500);
  await expect(map.locator("[data-boat]")).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await map.scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);
  await expect(page.locator("[data-boat], [data-lit]")).toHaveCount(0);
  await expect(map.locator("[data-lane]")).toHaveCount(3);
});

test("the landing has a share image", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /^http:\/\/localhost:3100\/opengraph-image/,
  );
  const image = await request.get("/opengraph-image");
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");
});

test("privacy lists stored data", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy");

  const stored = page.getByRole("region", { name: "What Ferry stores" });
  for (const item of [
    "Your account",
    "Buffer sign-in tokens",
    "Your channels",
    "Routes",
    "Destinations",
    "Alerts",
    "Delivery claims, 24 hours to 45 days",
    "Activity, 30 days",
    "Reddit drafts, 7 days",
    "Posts waiting to retry, up to one day",
    "API-call counters, 2 days",
  ])
    await expect(stored.getByText(item, { exact: true })).toBeVisible();
  for (const detail of ["AES-256-GCM", "webhook", "IDs only", "80 characters"])
    await expect(stored).toContainText(detail);

  const cookies = page.getByRole("region", { name: "Cookies" });
  for (const cookie of [
    "ferry_session, 30 days",
    "ferry_oauth_state and ferry_oauth_verifier, up to 10 minutes",
    "ferry_discord_state, up to 10 minutes",
  ])
    await expect(cookies.getByText(cookie, { exact: true })).toBeVisible();

  const others = page.getByRole("region", {
    name: "Who else handles your data",
  });
  for (const processor of ["Vercel", "Upstash", "Redis", "QStash", "Discord"])
    await expect(others).toContainText(processor);
  await expect(others).toContainText("no analytics and no ads");

  const leaving = page.getByRole("region", {
    name: "Signing out and deleting your data",
  });
  await expect(leaving).toContainText(
    "Signing out ends this browser's session, but syncing continues until you choose Delete my data.",
  );
  await expect(
    page.getByRole("link", { name: "Open an issue on GitHub" }),
  ).toHaveAttribute("href", "https://github.com/Reonid/ferry/issues");
});

test("the seeded draft renders with copy buttons", async ({
  page,
  context,
  request,
}) => {
  // The draft link works without signing in: it is opened from Discord.
  await seed(request);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openDraft(page);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Reddit draft for r/SideProject",
  );
  await expect(
    page.locator('meta[name="robots"][content*="noindex"]'),
  ).toHaveCount(1);

  const title = page.getByRole("textbox", { name: "Title" });
  await expect(title).toHaveValue(DRAFT_TITLE);
  await expect(title).not.toBeEditable();
  const body = page.getByRole("textbox", { name: "Body text" });
  await expect(body).toHaveValue(DRAFT_BODY);
  await expect(body).not.toBeEditable();

  for (const [button, said, copied] of [
    ["Copy title", "Title copied.", DRAFT_TITLE],
    ["Copy body text", "Body text copied.", DRAFT_BODY],
  ] as const) {
    await page.getByRole("button", { name: button }).click();
    await expect(
      page.getByRole("status").filter({ hasText: said }),
    ).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      copied,
    );
  }

  await expect(
    page.getByRole("link", { name: "Post to r/SideProject" }),
  ).toHaveAttribute(
    "href",
    /^https:\/\/www\.reddit\.com\/r\/SideProject\/submit\?type=TEXT&/,
  );
  await expect(
    page.getByRole("link", { name: "Open r/SideProject without prefill" }),
  ).toHaveAttribute("href", "https://www.reddit.com/r/SideProject/submit");

  const images = page.getByRole("region", { name: "Images" });
  await expect(images.getByText(IMAGE_NOTE, { exact: true })).toBeVisible();
  await expect(images.getByRole("listitem")).toHaveCount(1);
  await expect(images.getByRole("listitem")).toContainText("Alt text:");
});

test("an unknown draft is a 404", async ({ page, request }) => {
  const response = await page.goto("/d/no-such-draft");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Draft not found",
  );
  await expect(
    page.locator('meta[name="robots"][content*="noindex"]').first(),
  ).toBeAttached();

  // The Discord button's link says what happened too, not just the status.
  const post = await request.get("/d/no-such-draft/post", { maxRedirects: 0 });
  expect(post.status()).toBe(404);
  expect(post.headers()["content-type"]).toContain("text/html");
  expect(await post.text()).toContain("<h1>Draft not found</h1>");
});

test("the post link redirects to Reddit's submit page", async ({ request }) => {
  await seed(request);
  const response = await request.get("/d/dev-draft/post", { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(response.headers()["location"]).toMatch(
    /^https:\/\/www\.reddit\.com\/r\//,
  );
});

test("every page carries the disclaimer", async ({ page }) => {
  await signIn(page);
  for (const path of [
    "/",
    "/privacy",
    "/d/dev-draft",
    "/d/no-such-draft",
    "/d/no-such-draft/post",
    "/no-such-page",
    "/app",
  ]) {
    await page.goto(path);
    const footer = page.getByRole("contentinfo");
    await expect(
      footer.getByText(DISCLAIMER, { exact: true }),
      path,
    ).toBeVisible();
    await expect(
      footer.getByRole("link", { name: "Privacy" }),
      path,
    ).toHaveAttribute("href", "/privacy");
    await expect(
      footer.getByRole("link", { name: "Source on GitHub" }),
      path,
    ).toHaveAttribute("href", "https://github.com/Reonid/ferry");
  }
});

test("passes axe in light and dark", async ({ page, request }) => {
  await seed(request);
  for (const path of [
    "/",
    "/?error=signin",
    "/privacy",
    "/d/dev-draft",
    "/d/no-such-draft",
    "/d/no-such-draft/post",
  ]) {
    await page.goto(path);
    if (path === "/d/dev-draft")
      await expect(
        page.getByRole("button", { name: "Copy title" }),
      ).toBeEnabled();
    const backgrounds = new Set<string>();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      backgrounds.add(
        await page.evaluate(
          () => getComputedStyle(document.body).backgroundColor,
        ),
      );
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(
        violations.map((v) => ({
          rule: v.id,
          targets: v.nodes.map((n) => n.target.join(" ")),
        })),
        `axe violations on ${path} in ${colorScheme}`,
      ).toEqual([]);
    }
    expect(backgrounds.size, `${path}: light and dark differ`).toBe(2);
  }
});

test("reaches every control by keyboard", async ({
  page,
  context,
  request,
}) => {
  await seed(request);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const home = page.getByRole("link", { name: "Ferry", exact: true });
  const footer = page.getByRole("contentinfo");

  await page.goto("/");
  await tabTo(page, home);
  await tabTo(page, page.getByRole("link", { name: "Sign in with Buffer" }));
  await tabTo(
    page,
    page.getByRole("link", { name: "Buffer's suggestion board" }),
  );
  await tabTo(page, footer.getByRole("link", { name: "Privacy" }));
  await tabTo(page, footer.getByRole("link", { name: "Source on GitHub" }));

  await openDraft(page);
  await tabTo(page, home);
  await tabTo(page, page.getByRole("link", { name: "Post to r/SideProject" }));
  const copyTitle = page.getByRole("button", { name: "Copy title" });
  await tabTo(page, copyTitle);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("status").filter({ hasText: "Title copied." }),
  ).toBeVisible();
  await expect(copyTitle).toBeFocused();
  await tabTo(page, page.getByRole("textbox", { name: "Title" }));
  await tabTo(page, page.getByRole("button", { name: "Copy body text" }));
  await tabTo(page, page.getByRole("textbox", { name: "Body text" }));
  await tabTo(page, page.getByRole("link", { name: /^Open image 1/ }));
  await tabTo(
    page,
    page.getByRole("link", { name: "Open r/SideProject without prefill" }),
  );

  await page.goto("/privacy");
  await tabTo(page, home);
  await tabTo(
    page,
    page.getByRole("link", { name: "Open an issue on GitHub" }),
  );
});

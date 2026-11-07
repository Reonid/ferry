import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { tabTo } from "./keyboard";

// playwright.config.ts starts the dev server with this bot's username.
const BOT = "https://t.me/FerryTestBot";
const CODE = /^FERRY-[A-HJ-NP-Z2-9]{8}$/;
const HOW =
  "For a channel, post this code there once Ferry is an admin. For a group, Ferry connects as soon as you add it.";

interface Answer {
  status: "waiting" | "connected" | "expired";
  destination?: Record<string, unknown>;
}

/** Signs in as the seeded account and waits until the dashboard is hydrated. */
async function openDashboard(page: Page): Promise<void> {
  // The first live poll starts from an effect, so it only runs once React
  // has hydrated.
  const polled = page.waitForResponse((r) => r.url().endsWith("/api/live"));
  await page.goto("/api/dev/login");
  await expect(page).toHaveURL(/\/app$/);
  await polled;
}

/**
 * Answers the panel's checks in the browser. The server's check asks
 * Telegram for updates, so no test may reach it. Returns the codes asked
 * about, in order.
 */
async function answerChecks(
  page: Page,
  answer: Answer = { status: "waiting" },
): Promise<string[]> {
  const asked: string[] = [];
  await page.route("**/api/telegram/check", async (route) => {
    const body = route.request().postDataJSON() as { code: string };
    asked.push(body.code);
    await route.fulfill({ json: answer });
  });
  return asked;
}

/** The Telegram panel's live line inside a dashboard section. */
function statusIn(region: Locator): Locator {
  return region.locator('[aria-live="polite"][data-telegram-status]');
}

test("connect panel shows a code and both links", async ({ page, context }) => {
  await answerChecks(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openDashboard(page);
  const destinations = page.getByRole("region", { name: "Destinations" });

  // The whole panel works from the keyboard, with a visible focus ring.
  await tabTo(
    page,
    destinations.getByRole("button", { name: "Connect Telegram" }),
  );
  await page.keyboard.press("Enter");
  const code = destinations.getByRole("textbox", { name: "Your code" });
  await expect(code).toHaveValue(CODE);
  await expect(code).not.toBeEditable();
  await expect(statusIn(destinations)).toHaveText("Waiting for the code…");
  await expect(destinations.getByText(HOW, { exact: true })).toBeVisible();

  await tabTo(page, code);
  await tabTo(page, destinations.getByRole("button", { name: "Copy code" }));
  await page.keyboard.press("Enter");
  await expect(statusIn(destinations)).toHaveText("Copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    await code.inputValue(),
  );

  const channel = destinations.getByRole("link", {
    name: "Add Ferry to a channel",
  });
  const group = destinations.getByRole("link", {
    name: "Add Ferry to a group",
  });
  await tabTo(page, channel);
  await tabTo(page, group);
  await expect(channel).toHaveAttribute(
    "href",
    `${BOT}?startchannel&admin=post_messages+delete_messages`,
  );
  for (const link of [channel, group]) {
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noreferrer");
  }
});

test("the group link carries the code", async ({ page }) => {
  const asked = await answerChecks(page);
  await openDashboard(page);
  const destinations = page.getByRole("region", { name: "Destinations" });
  await destinations.getByRole("button", { name: "Connect Telegram" }).click();

  const field = destinations.getByRole("textbox", { name: "Your code" });
  await expect(field).toHaveValue(CODE);
  const code = await field.inputValue();
  await expect(
    destinations.getByRole("link", { name: "Add Ferry to a group" }),
  ).toHaveAttribute("href", `${BOT}?startgroup=${code}`);
  // The checks ask about the code on screen.
  await expect.poll(() => asked.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(new Set(asked)).toEqual(new Set([code]));
});

test("announces the connection politely and moves focus", async ({ page }) => {
  await answerChecks(page, {
    status: "connected",
    destination: {
      id: "e2e-telegram",
      kind: "telegram",
      label: "Ferry Crew",
      status: "active",
      chatType: "group",
    },
  });
  await openDashboard(page);
  const destinations = page.getByRole("region", { name: "Destinations" });
  await destinations.getByRole("button", { name: "Connect Telegram" }).click();
  await expect(statusIn(destinations)).toHaveText("Waiting for the code…");

  // Connecting refreshes the dashboard from the server, as other actions do.
  const refreshed = page.waitForRequest(
    (r) => new URL(r.url()).pathname === "/app" && r.headers()["rsc"] === "1",
  );
  await expect(statusIn(destinations)).toHaveText("Connected to Ferry Crew.", {
    timeout: 10_000,
  });
  await expect(
    destinations.getByRole("heading", { name: "Destinations" }),
  ).toBeFocused();
  await expect(
    destinations.getByRole("textbox", { name: "Your code" }),
  ).toHaveCount(0);
  await refreshed;
});

test("says when a code expired, and gets a new one", async ({ page }) => {
  const asked = await answerChecks(page, { status: "expired" });
  await openDashboard(page);
  const destinations = page.getByRole("region", { name: "Destinations" });
  const connect = destinations.getByRole("button", {
    name: "Connect Telegram",
  });
  const field = destinations.getByRole("textbox", { name: "Your code" });
  await connect.click();
  await expect(field).toHaveValue(CODE);
  const first = await field.inputValue();

  await expect(statusIn(destinations)).toHaveText(
    "That code expired. Get a new one.",
    { timeout: 10_000 },
  );
  await expect(field).toHaveCount(0);
  // It stops asking about the dead code, and the button gets a new one.
  const count = asked.length;
  await page.waitForTimeout(3_500);
  expect(asked.length).toBe(count);
  await connect.click();
  await expect(field).toHaveValue(CODE);
  expect(await field.inputValue()).not.toBe(first);
});

test("stops checking after 3 minutes", async ({ page }) => {
  const asked = await answerChecks(page);
  await page.clock.install();
  await openDashboard(page);
  const destinations = page.getByRole("region", { name: "Destinations" });
  await destinations.getByRole("button", { name: "Connect Telegram" }).click();
  const field = destinations.getByRole("textbox", { name: "Your code" });
  await expect(field).toHaveValue(CODE);

  await page.clock.fastForward("03:00");
  await expect(statusIn(destinations)).toHaveText(
    "Ferry didn't see the code. Try again.",
  );
  await expect(field).toHaveCount(0);
  const count = asked.length;
  await page.clock.fastForward("00:10");
  await page.waitForTimeout(500);
  expect(asked.length).toBe(count);
});

test("the DM button shows the DM link", async ({ page }) => {
  const asked = await answerChecks(page);
  await openDashboard(page);
  const settings = page.getByRole("region", { name: "Settings" });
  await tabTo(
    page,
    settings.getByRole("button", { name: "Get alerts in a Telegram DM" }),
  );
  await page.keyboard.press("Enter");

  const link = settings.getByRole("link", { name: "Open Ferry in Telegram" });
  await expect(link).toBeVisible();
  await tabTo(page, link);
  await expect(link).toHaveAttribute(
    "href",
    /^https:\/\/t\.me\/FerryTestBot\?start=FERRY-[A-HJ-NP-Z2-9]{8}$/,
  );
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noreferrer");
  await expect(
    settings.getByText("Press Start in Telegram, and Ferry connects.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(statusIn(settings)).toHaveText("Waiting for the code…");
  // The DM link carries the code: nothing to copy, and no chat links.
  await expect(
    settings.getByRole("textbox", { name: "Your code" }),
  ).toHaveCount(0);
  await expect(
    settings.getByRole("link", { name: /^Add Ferry to a/ }),
  ).toHaveCount(0);

  const code = new URL(
    (await link.getAttribute("href")) ?? "",
  ).searchParams.get("start");
  await expect.poll(() => asked.at(-1), { timeout: 10_000 }).toBe(code);
});

test("moves focus to Settings when a DM connects", async ({ page }) => {
  await answerChecks(page, {
    status: "connected",
    destination: {
      id: "e2e-dm",
      kind: "telegram",
      label: "Telegram DM",
      status: "active",
      chatType: "private",
    },
  });
  await openDashboard(page);
  const settings = page.getByRole("region", { name: "Settings" });
  await settings
    .getByRole("button", { name: "Get alerts in a Telegram DM" })
    .click();

  await expect(statusIn(settings)).toHaveText("Connected to Telegram DM.", {
    timeout: 10_000,
  });
  await expect(
    settings.getByRole("heading", { name: "Settings" }),
  ).toBeFocused();
  await expect(
    settings.getByRole("link", { name: "Open Ferry in Telegram" }),
  ).toHaveCount(0);
});

test("keeps a Telegram DM out of routes and the map", async ({ page }) => {
  // Every poll brings a DM along with the seeded destinations.
  await page.route("**/api/live", async (route) => {
    const response = await route.fetch();
    const snapshot = (await response.json()) as { destinations: unknown[] };
    snapshot.destinations.push({
      id: "e2e-dm",
      kind: "telegram",
      label: "Telegram DM",
      status: "active",
      chatType: "private",
    });
    await route.fulfill({ response, json: snapshot });
  });
  await openDashboard(page);

  const destinations = page.getByRole("region", { name: "Destinations" });
  await expect(
    destinations
      .getByRole("listitem")
      .filter({ hasText: "Ferry Updates" })
      .getByText("Telegram channel", { exact: true }),
  ).toBeVisible();
  // The DM's row: its name, then its kind.
  await expect(
    destinations.getByText("Telegram DM", { exact: true }),
  ).toHaveCount(2);

  const routes = page.getByRole("region", { name: "Routes" });
  await routes.getByText("New route", { exact: true }).click();
  await expect(
    routes.getByRole("combobox", { name: "To" }).locator("option"),
  ).toHaveText([
    "Ferry Updates (Telegram)",
    "#announcements (Discord)",
    "r/SideProject (Reddit draft)",
  ]);

  const map = page.getByRole("img", { name: /^Crossing map/ });
  await expect(map.locator("text", { hasText: "Ferry Updates" })).toHaveCount(
    1,
  );
  await expect(map.locator("text", { hasText: "Telegram DM" })).toHaveCount(0);

  // Alerts can go to Discord or Telegram, the DM included.
  const alerts = page
    .getByRole("region", { name: "Settings" })
    .getByRole("combobox", { name: /alerts/i });
  for (const name of ["Telegram DM", "Ferry Updates", "#announcements"])
    await expect(alerts.locator("option", { hasText: name })).toHaveCount(1);
  await expect(
    alerts.locator("option", { hasText: "r/SideProject" }),
  ).toHaveCount(0);
});

test("passes axe in light and dark with the panel open", async ({ page }) => {
  await answerChecks(page);
  await openDashboard(page);
  await page.getByRole("button", { name: "Connect Telegram" }).click();
  await expect(page.getByRole("textbox", { name: "Your code" })).toHaveValue(
    CODE,
  );
  await page
    .getByRole("button", { name: "Get alerts in a Telegram DM" })
    .click();
  await expect(
    page.getByRole("link", { name: "Open Ferry in Telegram" }),
  ).toBeVisible();

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
      `axe violations in ${colorScheme}`,
    ).toEqual([]);
  }
  expect(backgrounds.size, "light and dark backgrounds differ").toBe(2);
});

test("landing mentions Telegram", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByText(
      "Keep writing in Buffer. When Buffer publishes a post, Ferry sends it on to your Discord or Telegram channel and prepares a Reddit draft you post with one tap.",
      { exact: true },
    ),
  ).toBeVisible();

  const step = page
    .getByRole("region", { name: "How it works" })
    .getByRole("listitem")
    .nth(1);
  await expect(step.getByRole("heading", { level: 3 })).toHaveText(
    "Connect Discord or Telegram",
  );
  await expect(step).toContainText("Telegram channel or group");

  const board = page.getByRole("link", { name: "Buffer's suggestion board" });
  await expect(page.locator("p", { has: board })).toContainText(
    "Ferry starts with Discord, Telegram and Reddit.",
  );

  const map = page.getByRole("img", { name: /^Example crossing map/ });
  await expect(map).toHaveAccessibleName(/@yourchannel on Telegram/);
  await expect(map.locator("text", { hasText: /^Telegram$/ })).toHaveCount(1);
});

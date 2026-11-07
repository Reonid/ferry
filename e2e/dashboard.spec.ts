import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tabTo } from "./keyboard";

const TIMING_NOTE =
  "Ferry checks Buffer about once a minute while this page is open, and every 15 minutes to 2 hours otherwise. Posts it already knows about cross within about 3 minutes of going out.";

/** Signs in as the seeded account and waits until the dashboard is hydrated. */
async function openDashboard(page: Page): Promise<void> {
  // The first live poll starts from an effect, so it only runs once React
  // has hydrated; touching the DOM earlier would cause a hydration mismatch.
  const polled = page.waitForResponse((r) => r.url().endsWith("/api/live"));
  await page.goto("/api/dev/login");
  await expect(page).toHaveURL(/\/app$/);
  await polled;
}

type Snapshot = Record<string, unknown> & {
  account: Record<string, unknown>;
  activity: unknown[];
  alerts: unknown[];
};

/** Serves every /api/live poll with the real snapshot, changed by `change`. */
async function serveLive(
  page: Page,
  change: (snapshot: Snapshot) => void,
): Promise<void> {
  await page.route("**/api/live", async (route) => {
    const response = await route.fetch();
    const snapshot = (await response.json()) as Snapshot;
    change(snapshot);
    await route.fulfill({ response, json: snapshot });
  });
}

/** Serves /api/live with one extra post that has just been delivered. */
async function deliverDuringTest(page: Page): Promise<void> {
  const now = Date.now();
  await serveLive(page, (snapshot) => {
    snapshot.activity.unshift({
      groupKey: "e2e-group-new",
      excerpt: "A new post crossing while the test watches.",
      source: { service: "bluesky", name: "Ferry Dev" },
      publishedAt: now - 60_000,
      deliveries: [
        { destinationId: "dev-discord", status: "delivered", at: now },
      ],
    });
  });
}

/**
 * Counts DOM changes inside `selector` while one more poll lands. A live
 * region that changes on every poll would be read out on every poll.
 */
async function changesDuringNextPoll(
  page: Page,
  selector: string,
): Promise<number> {
  await page.evaluate((sel) => {
    const counter = window as unknown as { changes: number };
    counter.changes = 0;
    new MutationObserver((records) => {
      counter.changes += records.length;
    }).observe(document.querySelector(sel)!, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  }, selector);
  const polled = page.waitForResponse((r) => r.url().endsWith("/api/live"));
  // The dashboard polls at once whenever the tab reports it is visible.
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await polled;
  await page.waitForTimeout(500);
  return page.evaluate(
    () => (window as unknown as { changes: number }).changes,
  );
}

test("shows the seeded route in the map and the list", async ({ page }) => {
  await openDashboard(page);

  const map = page.getByRole("img", { name: /^Crossing map/ });
  await expect(map).toHaveAccessibleName(
    "Crossing map with 1 route: Bluesky, LinkedIn to #announcements.",
  );
  await expect(map.locator("[data-lane]")).toHaveCount(2);

  const routes = page.getByRole("region", { name: "Routes" });
  const route = routes
    .getByRole("listitem")
    .filter({ hasText: "Bluesky, LinkedIn → #announcements" });
  await expect(route).toBeVisible();
  for (const name of ["Pause", "Send my latest post", "Delete"]) {
    await expect(route.getByRole("button", { name })).toBeVisible();
  }
  await expect(routes.getByText(TIMING_NOTE, { exact: true })).toBeVisible();
  await expect(
    page.getByText(/^1 route running · Next check .+ · \d+ API calls? today$/),
  ).toBeVisible();
});

test("passes axe in light and dark", async ({ page }) => {
  await openDashboard(page);
  // Check the content behind every disclosure too.
  await page.evaluate(() => {
    for (const details of document.querySelectorAll("details"))
      details.open = true;
  });

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

test("reaches every control by keyboard", async ({ page }) => {
  await openDashboard(page);

  const routes = page.getByRole("region", { name: "Routes" });
  await tabTo(page, routes.getByText("New route", { exact: true }));
  await page.keyboard.press("Enter");
  await tabTo(
    page,
    routes.getByRole("checkbox", { name: "Ferry Dev on Bluesky" }),
  );
  await tabTo(page, routes.getByRole("combobox", { name: "To" }));
  await tabTo(page, routes.getByRole("textbox", { name: "Only posts tagged" }));
  await tabTo(page, routes.getByRole("button", { name: "Add route" }));

  await tabTo(
    page,
    page.getByRole("link", { name: "Connect a Discord channel" }),
  );

  const activity = page.getByRole("region", { name: "Activity" });
  await tabTo(page, activity.getByRole("button", { name: "Retry" }));

  const settings = page.getByRole("region", { name: "Settings" });
  await tabTo(page, settings.getByRole("combobox", { name: /alerts/i }));
  await tabTo(page, settings.getByRole("button", { name: "Refresh channels" }));
  await tabTo(page, settings.getByRole("button", { name: "Sign out" }));
  await tabTo(page, settings.getByText("Delete my data", { exact: true }));
});

test("sends a boat across the lane when a delivery lands", async ({ page }) => {
  await deliverDuringTest(page);
  await openDashboard(page);

  await expect(page.locator("[data-boat]")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-activity-live]")).toHaveText(
    /Delivered to #announcements/,
  );
  await expect(
    page
      .getByRole("region", { name: "Activity" })
      .getByRole("listitem")
      .filter({ hasText: "A new post crossing while the test watches." })
      .first(),
  ).toBeVisible();
});

test("highlights the lane instead under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await deliverDuringTest(page);
  await openDashboard(page);

  await expect(page.locator("[data-lit]")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-boat]")).toHaveCount(0);
});

test("keeps focus in the routes section after deleting a route", async ({
  page,
}) => {
  await openDashboard(page);
  const routes = page.getByRole("region", { name: "Routes" });
  const route = routes
    .getByRole("listitem")
    .filter({ hasText: "Bluesky, LinkedIn → #announcements" });

  await route.getByRole("button", { name: "Delete" }).focus();
  await page.keyboard.press("Enter");

  await expect(route).toHaveCount(0);
  await expect(routes.getByRole("heading", { name: "Routes" })).toBeFocused();
  await expect(routes.locator("[role=status][data-section-status]")).toHaveText(
    "Route deleted.",
  );
});

test("keeps focus in destinations after removing one", async ({ page }) => {
  await openDashboard(page);
  const destinations = page.getByRole("region", { name: "Destinations" });
  const reddit = destinations
    .getByRole("listitem")
    .filter({ hasText: "r/SideProject" });

  await reddit.getByText("Remove", { exact: true }).click();
  await reddit.getByRole("button", { name: "Remove r/SideProject" }).click();

  await expect(reddit).toHaveCount(0);
  await expect(
    destinations.getByRole("heading", { name: "Destinations" }),
  ).toBeFocused();
  await expect(
    destinations.locator("[role=status][data-section-status]"),
  ).toHaveText("Destination removed.");
});

test("announces the re-auth banner from a poll", async ({ page }) => {
  await serveLive(page, (snapshot) => {
    snapshot.account.status = "needs_reauth";
  });
  await openDashboard(page);

  const region = page.locator('[aria-live="polite"][data-banner-live]');
  await expect(region).toContainText(
    "Buffer disconnected Ferry. Sign in again.",
  );
  await expect(
    region.getByRole("link", { name: "Sign in again." }),
  ).toHaveAttribute("href", "/api/auth/buffer");

  // The page arrived without the banner, but with the live region in place.
  const html = await (await page.request.get("/app")).text();
  expect(html).toContain("data-banner-live");
  expect(html).not.toContain("Buffer disconnected Ferry.");

  // Later polls leave the banner alone, so it is read out only once.
  expect(await changesDuringNextPoll(page, "[data-banner-live]")).toBe(0);
});

test("announces a new alert from a poll, once", async ({ page }) => {
  const message = "Buffer couldn't publish a post on Ferry Dev.";
  const at = Date.now();
  await serveLive(page, (snapshot) => {
    snapshot.alerts.unshift({
      key: "e2e-alert",
      message,
      supportUrl: null,
      at,
    });
  });
  await openDashboard(page);

  await expect(
    page.locator('[aria-live="polite"][data-alerts-live]'),
  ).toHaveText(`Needs attention: ${message}`);
  await expect(
    page.getByRole("region", { name: "Needs attention" }).getByText(message),
  ).toBeVisible();
  expect(await changesDuringNextPoll(page, "[data-alerts-live]")).toBe(0);
});

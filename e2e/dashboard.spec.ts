import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const TIMING_NOTE =
  "Scheduled posts cross within about 3 minutes, or about a minute while Ferry is open. Posts you publish right away can take longer unless Ferry is open.";

/** Signs in as the seeded account and waits until the dashboard is hydrated. */
async function openDashboard(page: Page): Promise<void> {
  // The first live poll starts from an effect, so it only runs once React
  // has hydrated; touching the DOM earlier would cause a hydration mismatch.
  const polled = page.waitForResponse((r) => r.url().endsWith("/api/live"));
  await page.goto("/api/dev/login");
  await expect(page).toHaveURL(/\/app$/);
  await polled;
}

/** Presses Tab until `target` has focus, then checks the focus ring is visible. */
async function tabTo(page: Page, target: Locator, max = 80): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) {
      const ring = await target.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          style: style.outlineStyle,
          width: parseFloat(style.outlineWidth),
        };
      });
      expect(ring.style, "focus ring style").not.toBe("none");
      expect(ring.width, "focus ring width").toBeGreaterThanOrEqual(2);
      return;
    }
  }
  throw new Error(`Tab never reached ${target.toString()}`);
}

/** Serves /api/live with one extra post that has just been delivered. */
async function deliverDuringTest(page: Page): Promise<void> {
  await page.route("**/api/live", async (route) => {
    const response = await route.fetch();
    const snapshot = (await response.json()) as { activity: unknown[] };
    const now = Date.now();
    snapshot.activity.unshift({
      groupKey: "e2e-group-new",
      excerpt: "A new post crossing while the test watches.",
      source: { service: "bluesky", name: "Ferry Dev" },
      publishedAt: now - 60_000,
      deliveries: [
        { destinationId: "dev-discord", status: "delivered", at: now },
      ],
    });
    await route.fulfill({ response, json: snapshot });
  });
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

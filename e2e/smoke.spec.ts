import { expect, test } from "@playwright/test";

test("landing shows its heading", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Your Buffer posts on Discord and Telegram",
    }),
  ).toBeVisible();
});

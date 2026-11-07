import { expect, test } from "@playwright/test";

test("landing shows the Ferry heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ferry" })).toBeVisible();
});

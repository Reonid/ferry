import { expect, type Locator, type Page } from "@playwright/test";

/** Presses Tab until `target` has focus, then checks the focus ring is visible. */
export async function tabTo(
  page: Page,
  target: Locator,
  max = 80,
): Promise<void> {
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

import type { Page } from "@playwright/test";

export async function selectSession(page: Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click();
}

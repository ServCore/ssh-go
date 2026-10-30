import type { Locator, Page } from "@playwright/test";

export async function selectSession(page: Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click();
}

export async function openHostSettings(card: Locator) {
  await card.hover();
  await card.getByRole("button", { name: /^编辑连接 / }).click();
}

// The right edge is the address bar's blank editing area, beyond its segments.
export async function editDirectoryPath(input: Locator) {
  const bounds = await input.boundingBox();
  if (!bounds) throw new Error("Directory address bar is not visible");
  await input.dblclick({ position: { x: bounds.width - 12, y: bounds.height / 2 } });
}

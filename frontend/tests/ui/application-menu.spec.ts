import { selectSession } from "./fixtures/navigation";
import { expect, test } from "@playwright/test";
import { desktopFixture } from "./fixtures/desktop";

test("application menus support keyboard navigation, focus return and real workspace actions", async ({ page }) => {
  await desktopFixture(page, false, false, true);
  await page.goto("/");
  const bar = page.getByRole("menubar", { name: "应用菜单" });
  const file = bar.getByRole("menuitem", { name: "文件", exact: true });
  await file.focus();
  await file.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "添加服务器…", exact: true })).toBeFocused();
  await expect(page.getByRole("menuitem", { name: "关闭当前工作区" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(file).toBeFocused();
  await file.press("ArrowRight");
  const view = bar.getByRole("menuitem", { name: "查看", exact: true });
  await expect(view).toBeFocused();
  await view.press("ArrowUp");
  const settings = page.getByRole("menuitem", { name: "设置…", exact: true });
  await expect(settings).toBeFocused();
  await page.screenshot({ path: ".test-artifacts/application-menu.png" });
  await settings.press("Enter");
  await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await file.click();
  await page.getByRole("menuitem", { name: "关闭当前工作区" }).click();
  await expect(page.locator(".workspace-navigation")).toHaveCount(0);
  await view.click();
  await page.getByRole("menuitem", { name: "搜索资源与操作…" }).click();
  await expect(page.getByRole("dialog", { name: "搜索资源与操作" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "搜索资源", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "搜索资源与操作" })).toHaveCount(0);
  await expect(view).toBeFocused();
  await view.click();
  await page.getByRole("heading", { name: "服务器", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("group filters replace the sidebar and keep search and session switching usable", async ({ page }) => {
  await desktopFixture(page, false, false, true);
  await page.goto("/");
  await expect(page.locator(".workspace-sidebar")).toHaveCount(0);
  await page.getByLabel("服务器分组", { exact: true }).selectOption({ label: "生产" });
  await expect(page.locator(".host-card")).toHaveCount(2);
  await page.getByLabel("搜索服务器", { exact: true }).fill("ubuntu");
  await expect(page.locator(".host-card")).toHaveCount(1);
  await page.getByRole("group", { name: "服务器 生产 API", exact: true }).dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await expect(page.locator(".host-card")).toHaveCount(1);
  await selectSession(page, "生产 API");
  await expect(page.locator(".xterm")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "connect_host").length)).toBe(1);
});

test("native macOS menu events share actions and respect an open modal", async ({ page }) => {
  await desktopFixture(page);
  await page.addInitScript(() => {
    window.runtime!.Environment = async () => ({ platform: "darwin" });
  });
  await page.goto("/");
  await expect(page.getByRole("menubar", { name: "应用菜单" })).toHaveCount(0);
  const command = (action: string) => page.evaluate((value) => (window as any).__qa.emit("app:menu", value), action);
  await command("settings");
  await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
  await command("close");
  await expect(page.locator(".workspace-navigation")).toHaveCount(0);
  await command("new");
  await expect(page.getByRole("dialog", { name: "添加服务器", exact: true })).toBeVisible();
  await command("settings");
  await expect(page.getByRole("heading", { name: "设置", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await command("transfers");
  await expect(page.getByRole("dialog", { name: "传输队列", exact: true })).toBeVisible();
});

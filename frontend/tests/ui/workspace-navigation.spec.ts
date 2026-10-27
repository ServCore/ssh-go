import { expect, test, type Page } from "@playwright/test";
import { desktopFixture } from "./fixtures/desktop";
import { selectSession } from "./fixtures/navigation";

const selectedTab = (page: Page) => page.getByRole("tab", { selected: true });
async function connect(page: Page, name: string) {
  await page.getByRole("group", { name: `服务器 ${name}`, exact: true }).dblclick();
  await expect(page.locator(".xterm:visible")).toBeVisible();
}
async function twoSessions(page: Page) {
  await desktopFixture(page, false, false, true);
  await page.goto("/");
  await connect(page, "测试服务器");
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await connect(page, "生产 API");
}

test("global server entry and session tools stay on separate levels without resetting workspaces", async ({ page }, info) => {
  await twoSessions(page);
  await page.getByRole("button", { name: "监控", exact: true }).click();
  await expect(page.getByRole("region", { name: "服务器监控", exact: true })).toContainText("37.5%");
  await page.getByRole("button", { name: "刷新监控", exact: true }).click();
  await expect(page.getByRole("region", { name: "服务器监控", exact: true })).toContainText("17.6%");
  const nav = page.getByRole("banner", { name: "工作区导航" });
  expect((await nav.boundingBox())!.height).toBeLessThanOrEqual(60);
  await expect(page.locator(".task-tabs")).toHaveCount(0);
  await expect(nav.getByRole("button", { name: "返回服务器", exact: true })).toHaveCount(0);
  await expect(page.locator(".topbar").getByRole("button", { name: "返回服务器", exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: "端口转发", exact: true })).toHaveCount(0);
  const entry = (await page.getByRole("button", { name: "返回服务器", exact: true }).boundingBox())!;
  expect(entry.y + entry.height).toBeLessThanOrEqual((await nav.boundingBox())!.y);
  expect(entry.x).toBeGreaterThan(1000);
  await expect(selectedTab(page)).toHaveText("生产 API");
  const connection = nav.locator(".workspace-connection");
  const tools = (await nav.getByRole("group", { name: "会话工具" }).boundingBox())!;
  const address = (await connection.boundingBox())!;
  const controls = (await nav.getByRole("group", { name: "监控采集控制" }).boundingBox())!;
  await expect(connection).toHaveText("developer@ubuntu.example.internal");
  await expect(connection).toHaveCSS("border-left-width", "1px");
  expect(address.x).toBeGreaterThanOrEqual(tools.x + tools.width);
  expect(address.x - tools.x - tools.width).toBeLessThanOrEqual(24);
  expect(Math.abs(address.y + address.height / 2 - controls.y - controls.height / 2)).toBeLessThan(2);
  expect(controls.x).toBeGreaterThan(address.x + address.width);
  await page.screenshot({ path: info.outputPath("navigation-d-light.png"), animations: "disabled" });
  await expect(page.getByRole("tablist", { name: "已打开的连接" }).getByRole("tab")).toHaveCount(2);
  const tabs = (await page.getByRole("tablist", { name: "已打开的连接" }).boundingBox())!;
  expect(tabs.y + tabs.height).toBeLessThanOrEqual((await nav.boundingBox())!.y);
  await page.getByRole("tab", { name: "测试服务器", exact: true }).click();
  await page.getByRole("button", { name: "SFTP", exact: true }).click();
  await expect(nav.getByRole("group", { name: "监控采集控制" })).toHaveCount(0);
  await expect(page.getByLabel("远程文件目录路径")).toHaveValue("/remote");
  await page.getByLabel("远程文件目录路径").fill("/retained");
  await page.getByLabel("远程文件目录路径").press("Enter");
  await selectSession(page, "生产 API");
  await expect(page.getByRole("button", { name: "监控", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "服务器监控", exact: true })).toContainText("37.5%");
  await page.keyboard.press("Meta+,");
  await page.getByLabel("外观模式", { exact: true }).selectOption("dark");
  await selectSession(page, "生产 API");
  await page.screenshot({ path: info.outputPath("navigation-d-dark.png"), animations: "disabled" });
  await selectSession(page, "测试服务器");
  await expect(page.getByLabel("远程文件目录路径")).toHaveValue("/retained");
  await page.getByRole("button", { name: "监控", exact: true }).click();
  await page.getByRole("button", { name: "暂停采集", exact: true }).click();
  await selectSession(page, "生产 API");
  await expect(nav.getByRole("button", { name: "暂停采集", exact: true })).toHaveAttribute("aria-pressed", "false");
  await nav.getByRole("button", { name: "刷新监控", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "get_server_metrics").at(-1).args.sessionId)).toBe("qa-session-2");
  await selectSession(page, "测试服务器");
  await expect(nav.getByRole("button", { name: "继续采集", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "connect_host").length)).toBe(2);
  expect(await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "disconnect_session").length)).toBe(0);
});

test("connection tabs support keyboard navigation, disconnected entries and focus after closing", async ({ page }) => {
  await twoSessions(page);
  const first = page.getByRole("tab", { name: "测试服务器", exact: true });
  const second = page.getByRole("tab", { name: "生产 API", exact: true });
  await second.focus();
  await second.press("ArrowLeft");
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await first.press("End");
  await expect(second).toBeFocused();
  await second.press("Home");
  await expect(first).toBeFocused();
  await first.press("ArrowLeft");
  await expect(second).toBeFocused();
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(selectedTab(page)).toHaveCount(0);
  await first.click();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await page.evaluate(() => (window as any).__qa.emit("session-closed", { sessionId: "qa-session-1", reason: "连接断开" }));
  await expect(first).toHaveAttribute("aria-description", /已断开/);
  await page.getByRole("button", { name: "移除 测试服务器", exact: true }).click();
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(first).toHaveCount(0);
  await second.press("Delete");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "返回服务器", exact: true })).toBeFocused();
  await expect(page.getByRole("heading", { name: "服务器", exact: true })).toBeVisible();
});

test("long host names and scrollable connection tabs fit desktop and narrow windows", async ({ page }, info) => {
  await desktopFixture(page, false, false, true);
  await page.goto("/");
  const name = "服务器名称很长时也能保持卡片整齐_这是用于布局验证的测试服务器";
  await connect(page, name);
  await page.getByRole("button", { name: "监控", exact: true }).click();
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await connect(page, "测试服务器");
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await connect(page, "生产 API");
  await selectSession(page, name);
  for (const width of [1440, 1024, 800, 640, 480]) {
    await page.setViewportSize({ width, height: 820 });
    expect(await page.locator(".ssh-app").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.locator(".topbar").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const nav = page.getByRole("banner", { name: "工作区导航" });
    expect(await nav.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const popup = (await page.getByRole("tablist", { name: "已打开的连接" }).boundingBox())!;
    expect(popup.x).toBeGreaterThanOrEqual(0);
    expect(popup.x + popup.width).toBeLessThanOrEqual(width);
    const tab = page.getByRole("tab", { name: "生产 API", exact: true });
    await tab.focus();
    await tab.press("Home");
    await expect(page.getByRole("tab", { name, exact: true })).toBeFocused();
    const currentList = (await page.getByRole("tablist", { name: "已打开的连接" }).boundingBox())!;
    const tabBox = (await page.getByRole("tab", { name, exact: true }).boundingBox())!;
    expect(tabBox.x).toBeGreaterThanOrEqual(currentList.x - 1);
    expect(tabBox.x + tabBox.width).toBeLessThanOrEqual(currentList.x + currentList.width + 1);
    if (width === 480) {
      await expect(page.getByRole("button", { name: "向右滚动连接标签" })).toBeVisible();
      await page.getByRole("button", { name: "向右滚动连接标签" }).click();
      await expect.poll(() => page.locator(".connection-tab-list").evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
      await tab.focus();
      await tab.press("Home");
    }
    await page.screenshot({ path: info.outputPath(`navigation-d-${width}.png`), animations: "disabled" });
  }
});

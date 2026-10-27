import { expect, test, type Page } from "@playwright/test";
import { desktopFixture } from "./fixtures/desktop";
import { selectSession } from "./fixtures/navigation";

async function setAccent(page: Page, value: string) {
  await page.keyboard.press("Meta+,");
  await page.getByLabel("主题色", { exact: true }).selectOption(value);
  await expect(page.locator("html")).toHaveAttribute("data-accent", value);
}

test("red accent unifies action icons, selected controls and primary buttons while preserving status colors", async ({ page }, info) => {
  await desktopFixture(page);
  await page.goto("/");
  await setAccent(page, "red");
  await page.screenshot({ path: info.outputPath("accent-red-settings.png"), animations: "disabled" });
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  const create = page.getByRole("button", { name: "添加服务器", exact: true });
  await expect(create).toHaveCSS("background-color", "rgb(197, 66, 77)");
  await expect(create.locator("svg")).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.locator(".server-avatar").first()).toHaveCSS("background-color", "rgb(197, 66, 77)");
  await expect(page.locator(".server-avatar svg").first()).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
  await expect(page.locator(".connection-tab.active .connection-dot")).toHaveCSS("background-color", "rgb(52, 168, 83)");
  await page.getByRole("button", { name: "SFTP", exact: true }).click();
  const remote = page.getByRole("region", { name: "远程文件", exact: true });
  await expect(remote.getByRole("button", { name: "上传文件", exact: true })).toBeEnabled();
  for (const name of ["上传文件", "上传目录"]) {
    await expect(remote.getByRole("button", { name, exact: true }).locator("svg")).toHaveCSS("color", "rgb(197, 66, 77)");
  }
  await expect(remote.locator(".folder-icon").first()).toHaveCSS("color", "rgb(197, 66, 77)");
  await expect(page.getByRole("button", { name: "SFTP", exact: true })).toHaveCSS("color", "rgb(197, 66, 77)");
  const disabled = page.getByRole("button", { name: "上传所选文件", exact: true });
  await expect(disabled).toBeDisabled();
  expect(await disabled.locator("svg").evaluate(el => getComputedStyle(el).color)).toBe(await disabled.evaluate(el => getComputedStyle(el).color));
  await page.screenshot({ path: info.outputPath("accent-red-sftp.png"), animations: "disabled" });
  await page.getByRole("button", { name: "监控", exact: true }).click();
  await expect(page.getByRole("img", { name: "负载占核心数比例 10.5%", exact: true })).toHaveCSS("color", "rgb(21, 158, 105)");
  await page.keyboard.press("Meta+,");
  await page.getByLabel("外观模式", { exact: true }).selectOption("dark");
  await selectSession(page, "测试服务器");
  await page.getByRole("button", { name: "SFTP", exact: true }).click();
  await expect(remote.getByRole("button", { name: "上传文件", exact: true }).locator("svg")).toHaveCSS("color", "rgb(242, 156, 164)");
  await page.screenshot({ path: info.outputPath("accent-red-dark.png"), animations: "disabled" });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("qa-preferences") || "{}")["appearance.accent"])).toBe("red");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "red");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("a delayed startup response restores mode independently without overwriting a newer accent", async ({ page }) => {
  await desktopFixture(page);
  await page.addInitScript(() => {
    const qa = (window as any).__qa, original = qa.invoke;
    qa.invoke = (command: string, args: any) => command === "get_preferences"
      ? new Promise(resolve => { qa.finishPreferences = () => resolve({ "appearance.mode": "dark", "appearance.accent": "blue" }); })
      : original(command, args);
  });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => typeof (window as any).__qa.finishPreferences)).toBe("function");
  await setAccent(page, "red");
  await page.evaluate(() => (window as any).__qa.finishPreferences());
  await expect(page.locator("html")).toHaveAttribute("data-accent", "red");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("accent changes update live terminals without changing ANSI output, and failed writes do not block later choices", async ({ page }) => {
  await desktopFixture(page);
  await page.addInitScript(() => {
    const qa = (window as any).__qa, original = qa.invoke;
    let first = true;
    qa.invoke = (command: string, args: any) => {
      if (command === "set_preference" && args.key === "appearance.accent" && first) {
        first = false;
        return new Promise((_, reject) => { qa.failAccent = () => reject({ message: "主题色保存失败" }); });
      }
      return original(command, args);
    };
  });
  await page.goto("/");
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
  await page.evaluate(() => {
    (window as any).__qa.terminal("\r\n\x1b[32mSUCCESS\x1b[0m\r\n");
    (window as any).__qa.originalTerminal = document.querySelector(".xterm");
  });
  await expect(page.locator(".xterm-rows")).toContainText("SUCCESS");
  const ansiColor = () => page.locator(".xterm-rows span").filter({ hasText: "SUCCESS" }).evaluate(el => getComputedStyle(el).color);
  const before = await ansiColor();
  await setAccent(page, "red");
  await page.getByLabel("主题色", { exact: true }).selectOption("green");
  await page.getByLabel("主题色", { exact: true }).selectOption("purple");
  await page.evaluate(() => (window as any).__qa.failAccent());
  await expect(page.getByRole("alert")).toContainText("主题色保存失败");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("qa-preferences") || "{}")["appearance.accent"])).toBe("purple");
  await selectSession(page, "测试服务器");
  expect(await ansiColor()).toBe(before);
  expect(await page.locator(".xterm").evaluate(el => el === (window as any).__qa.originalTerminal)).toBe(true);
  expect(await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "open_terminal").length)).toBe(1);
  await expect(page.getByRole("button", { name: "终端", exact: true })).toHaveCSS("color", "rgb(122, 92, 195)");
});

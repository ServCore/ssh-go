import { openHostSettings } from "./fixtures/navigation";
import { expect, test, type Locator } from "@playwright/test";
import { desktopFixture } from "./fixtures/desktop";

async function darkSurface(locator: Locator) {
  const channels = await locator.evaluate((element) => getComputedStyle(element).backgroundColor.match(/\d+/g)!.slice(0, 3).map(Number));
  expect(channels.every((value) => value < 85)).toBe(true);
  expect(channels[2]).toBeGreaterThanOrEqual(channels[1]!);
}

async function windowAppearance(page: import("@playwright/test").Page, mode: string) {
  await expect.poll(() => page.evaluate(() => (window as any).__qa.calls
    .filter((call: any) => call.command === "set_window_appearance").at(-1)?.args.mode)).toBe(mode);
}

test("appearance choices persist through desktop preferences and page reload", async ({ page }) => {
  await desktopFixture(page);
  await page.goto("/");
  await windowAppearance(page, "light");
  await page.keyboard.press("Meta+,");
  await page.getByLabel("外观模式", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await windowAppearance(page, "dark");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("qa-preferences") || "{}")["appearance.mode"])).toBe("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await windowAppearance(page, "dark");
  await expect(page.locator("body")).toHaveAttribute("arco-theme", "dark");
  await page.keyboard.press("Meta+,");
  await expect(page.getByLabel("外观模式", { exact: true })).toHaveValue("dark");
  await page.getByLabel("外观模式", { exact: true }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await windowAppearance(page, "light");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("qa-preferences") || "{}")["appearance.mode"])).toBe("light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("system mode follows live OS changes while an explicit choice stays fixed", async ({ page }) => {
  await desktopFixture(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.keyboard.press("Meta+,");
  await page.getByLabel("外观模式", { exact: true }).selectOption("system");
  await windowAppearance(page, "system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await windowAppearance(page, "system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByLabel("外观模式", { exact: true }).selectOption("dark");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await windowAppearance(page, "dark");
});

test("dark surfaces cover menus, cards, settings tabs, forms, terminal and SFTP", async ({ page }) => {
  await desktopFixture(page, false, false, true);
  await page.addInitScript(() => {
    localStorage.setItem("qa-preferences", JSON.stringify({ "appearance.mode": "dark" }));
    localStorage.setItem("ssh-go.appearance.mode", "dark");
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await darkSurface(page.locator(".host-card").first());
  for (const width of [800, 1280]) {
    await page.setViewportSize({ width, height: 820 });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.test-artifacts/appearance-hosts-dark-${width}.png`, animations: "disabled" });
  }
  await page.getByRole("menuitem", { name: "查看", exact: true }).click();
  await darkSurface(page.getByRole("menu", { name: "查看", exact: true }));
  await page.keyboard.press("Escape");
  await openHostSettings(page.getByRole("group", { name: "服务器 生产 API", exact: true }));
  await darkSurface(page.locator(".host-settings-page"));
  await page.screenshot({ path: ".test-artifacts/appearance-host-settings-dark.png", animations: "disabled" });
  await page.getByRole("button", { name: "关闭 生产 API · 连接设置", exact: true }).click();
  await page.getByRole("button", { name: "添加服务器", exact: true }).click();
  await expect(page.locator(".arco-modal")).toHaveCSS("opacity", "1");
  await darkSurface(page.locator(".arco-modal"));
  await darkSurface(page.getByLabel("服务器名称", { exact: true }));
  await page.screenshot({ path: ".test-artifacts/appearance-editor-dark.png", animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+k");
  await expect(page.locator(".arco-modal")).toHaveCSS("opacity", "1");
  await darkSurface(page.locator(".arco-modal"));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+,");
  await darkSurface(page.locator(".settings-section").first());
  await page.screenshot({ path: ".test-artifacts/appearance-settings-dark.png", animations: "disabled" });
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await page.getByRole("group", { name: "服务器 生产 API", exact: true }).dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
  await page.evaluate(() => (window as any).__qa.terminal("\r\nREPOSITORY       TAG       IMAGE ID       CREATED          SIZE\r\nexample/web      v1.2.0    aabbcc112233   12 minutes ago   108MB\r\n"));
  await expect(page.locator(".xterm-rows")).toContainText("example/web");
  await expect.poll(() => page.locator(".xterm-decoration").count()).toBeGreaterThan(0);
  await darkSurface(page.locator(".terminal-pane"));
  await page.screenshot({ path: ".test-artifacts/appearance-terminal-dark.png", animations: "disabled" });
  await page.getByRole("button", { name: "SFTP", exact: true }).click();
  await expect(page.getByLabel("远程文件目录路径")).toBeVisible();
  await darkSurface(page.locator(".file-workspace"));
  await page.screenshot({ path: ".test-artifacts/appearance-sftp-dark.png", animations: "disabled" });
  await page.getByRole("button", { name: "传输队列", exact: true }).click();
  await expect(page.locator(".arco-modal")).toHaveCSS("opacity", "1");
  await darkSurface(page.locator(".arco-modal"));
  await page.screenshot({ path: ".test-artifacts/appearance-transfers-dark.png", animations: "disabled" });
});

test("a delayed startup preference does not overwrite a newer user choice", async ({ page }) => {
  await desktopFixture(page);
  await page.addInitScript(() => {
    const qa = (window as any).__qa, original = qa.invoke;
    qa.invoke = (command: string, args: any) => command === "get_preferences"
      ? new Promise((resolve) => { qa.finishAppearance = () => resolve({ "appearance.mode": "light" }); })
      : original(command, args);
  });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => typeof (window as any).__qa.finishAppearance)).toBe("function");
  await page.keyboard.press("Meta+,");
  await page.getByLabel("外观模式", { exact: true }).selectOption("dark");
  await page.evaluate(() => (window as any).__qa.finishAppearance());
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByLabel("外观模式", { exact: true })).toHaveValue("dark");
});

test("rapid preference writes keep the last choice and recover after a save failure", async ({ page }) => {
  await desktopFixture(page);
  await page.addInitScript(() => {
    const qa = (window as any).__qa, original = qa.invoke;
    let first = true;
    qa.invoke = (command: string, args: any) => {
      if (command === "set_preference" && args.key === "appearance.mode" && first) {
        first = false;
        return new Promise((_, reject) => { qa.failAppearance = () => reject({ message: "偏好保存失败" }); });
      }
      return original(command, args);
    };
  });
  await page.goto("/");
  await page.keyboard.press("Meta+,");
  const select = page.getByLabel("外观模式", { exact: true });
  await select.selectOption("dark");
  await select.selectOption("light");
  await select.selectOption("system");
  await page.evaluate(() => (window as any).__qa.failAppearance());
  await expect(page.getByRole("alert")).toContainText("偏好保存失败");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("qa-preferences") || "{}")["appearance.mode"])).toBe("system");
  await expect(select).toHaveValue("system");
});

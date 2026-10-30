import { expect, test } from "@playwright/test";
import { desktopFixture } from "./fixtures/desktop";
import { selectSession } from "./fixtures/navigation";

async function settings(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByLabel("终端字体", { exact: true })).toBeVisible();
}

test("handwritten font is the default and custom fonts update the existing terminal and persist", async ({ page }) => {
  await desktopFixture(page);
  await page.goto("/");
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  const rows = page.locator(".xterm-rows");
  await expect(rows).toHaveCSS("font-family", /Hannotate SC/);
  await page.locator(".xterm").evaluate(element => { (window as any).__qa.fontTerminal = element; });
  await page.evaluate(() => (window as any).__qa.terminal("\r\nfont-change-preserves-output 中文\r\n"));
  await expect(rows).toContainText("font-change-preserves-output");
  await page.screenshot({ path: ".test-artifacts/terminal-font-hannotate.png", animations: "disabled" });
  await settings(page);
  await expect(page.getByLabel("终端字体", { exact: true })).toHaveValue("手札体-简");
  await page.getByLabel("终端字体", { exact: true }).fill("Menlo");
  await page.getByLabel("终端字号", { exact: true }).fill("16");
  await page.getByRole("button", { name: "应用字体", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("字体已应用并保存");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("qa-preferences") || "{}")["terminal.font"])).toEqual({ family: "Menlo", size: 16 });
  await page.locator(".terminal-font-settings").scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".test-artifacts/terminal-font-settings.png", animations: "disabled" });
  await selectSession(page, "测试服务器");
  await expect(rows).toHaveCSS("font-family", /^Menlo,/);
  await expect(rows).toHaveCSS("font-size", "16px");
  await expect(rows).toContainText("font-change-preserves-output");
  expect(await page.locator(".xterm").evaluate(element => element === (window as any).__qa.fontTerminal)).toBe(true);
  const calls = await page.evaluate(() => (window as any).__qa.calls);
  expect(calls.filter((call: any) => call.command === "open_terminal")).toHaveLength(1);
  expect(calls.filter((call: any) => call.command === "connect_host")).toHaveLength(1);
  expect(calls.filter((call: any) => call.command === "close_terminal")).toHaveLength(0);
  await expect.poll(() => page.evaluate(() => (window as any).__qa.calls.filter((call: any) => call.command === "resize_terminal").length)).toBeGreaterThan(0);
  await page.reload();
  await settings(page);
  await expect(page.getByLabel("终端字体", { exact: true })).toHaveValue("Menlo");
  await expect(page.getByLabel("终端字号", { exact: true })).toHaveValue("16");
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await expect(rows).toHaveCSS("font-family", /^Menlo,/);
  await expect(rows).toHaveCSS("font-size", "16px");
  await settings(page);
  await page.getByRole("button", { name: "恢复默认字体", exact: true }).click();
  await expect(page.getByLabel("终端字体", { exact: true })).toHaveValue("手札体-简");
  await selectSession(page, "测试服务器");
  await expect(rows).toHaveCSS("font-family", /Hannotate SC/);
  await expect(rows).toHaveCSS("font-size", "13px");
});

test("a late startup preference cannot overwrite a font applied by the user", async ({ page }) => {
  await desktopFixture(page);
  await page.addInitScript(() => {
    const qa = (window as any).__qa, original = qa.invoke;
    qa.invoke = (command: string, args: any) => command === "get_preferences"
      ? new Promise(resolve => { qa.resolveFontPreferences = resolve; }) : original(command, args);
  });
  await page.goto("/");
  await settings(page);
  await page.getByLabel("终端字体", { exact: true }).fill("Monaco");
  await page.getByLabel("终端字号", { exact: true }).fill("18");
  await page.getByRole("button", { name: "应用字体", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("字体已应用并保存");
  await page.evaluate(() => (window as any).__qa.resolveFontPreferences({ "terminal.font": { family: "Menlo", size: 10 } }));
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await expect(page.locator(".xterm-rows")).toHaveCSS("font-family", /^Monaco,/);
  await expect(page.locator(".xterm-rows")).toHaveCSS("font-size", "18px");
});

test("font saves recover after a failed write and the final choice is retained", async ({ page }) => {
  await desktopFixture(page);
  await page.goto("/");
  await settings(page);
  await page.evaluate(() => {
    const qa = (window as any).__qa, original = qa.invoke;
    let fail = true;
    qa.invoke = (command: string, args: any) => {
      if (command === "set_preference" && args.key === "terminal.font" && fail) {
        fail = false;
        return Promise.reject({ message: "字体保存失败" });
      }
      return original(command, args);
    };
  });
  await page.getByLabel("终端字体", { exact: true }).fill("Menlo");
  await page.getByRole("button", { name: "应用字体", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("字体保存失败");
  await page.getByLabel("终端字体", { exact: true }).fill("Monaco");
  await page.getByLabel("终端字号", { exact: true }).fill("15");
  await page.getByRole("button", { name: "应用字体", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("字体已应用并保存");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("qa-preferences") || "{}")["terminal.font"])).toEqual({ family: "Monaco", size: 15 });
});

test("font choices include installed system families beyond the suggested presets", async ({ page }) => {
  await desktopFixture(page);
  await page.goto("/");
  await settings(page);
  await expect(page.getByLabel("系统字体列表状态", { exact: true })).toContainText("已读取 6 种系统字体");
  const names = await page.getByLabel("终端字体", { exact: true }).evaluate((input: HTMLInputElement) => [...input.list!.options].map(option => option.value));
  expect(names).toEqual(expect.arrayContaining(["Arial", "Courier New", "PingFang SC", "Menlo", "Monaco"]));
  expect(names).not.toContain("JetBrains Mono");
  await page.getByLabel("终端字体", { exact: true }).fill("Courier New");
  await page.getByRole("button", { name: "应用字体", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("qa-preferences") || "{}")["terminal.font"].family)).toBe("Courier New");
});

test("a failed system font lookup keeps manual configuration available and can be retried", async ({ page }) => {
  await desktopFixture(page);
  await page.addInitScript(() => {
    const qa = (window as any).__qa, original = qa.invoke;
    let fail = true;
    qa.invoke = (command: string, args: any) => {
      if (command === "list_system_fonts" && fail) {
        fail = false;
        return Promise.reject({ message: "字体列表读取失败" });
      }
      return original(command, args);
    };
  });
  await page.goto("/");
  await settings(page);
  await expect(page.getByLabel("系统字体列表状态", { exact: true })).toContainText("仍可手动输入名称");
  await page.getByLabel("终端字体", { exact: true }).fill("Monaco");
  await page.getByRole("button", { name: "应用字体", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("字体已应用并保存");
  await page.getByRole("button", { name: "重新读取字体", exact: true }).click();
  await expect(page.getByLabel("系统字体列表状态", { exact: true })).toContainText("已读取 6 种系统字体");
  await expect(page.getByLabel("终端字体", { exact: true })).toHaveValue("Monaco");
});

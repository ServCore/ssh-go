import { expect, test } from "@playwright/test";
import { desktopFixture } from "./fixtures/desktop";

test("standalone shell only exposes connection tools and keeps SFTP in the same SSH session", async ({ page }) => {
  await desktopFixture(page);
  await page.goto("/");
  await expect(page).toHaveTitle("ssh-go");
  await expect(page.locator(".workspace-sidebar")).toHaveCount(0);
  const navigation = page.getByRole("menubar", { name: "应用菜单", exact: true });
  await expect(navigation.getByRole("menuitem")).toHaveCount(2);
  for (const name of ["项目", "部署能力", "AI 助手", "文档", "剪贴板历史", "服务"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
  await expect(page.locator(".hosts-page")).not.toBeVisible();
  await page.getByRole("button", { name: "SFTP", exact: true }).click();
  await expect(page.getByLabel("远程文件目录路径")).toBeVisible();
  await page.getByRole("button", { name: "终端", exact: true }).click();
  await expect(page.locator(".xterm")).toBeVisible();
  await page.keyboard.press("Meta+,");
  await expect(page.getByText("/fixture/ssh-go/data", { exact: true })).toBeVisible();
  const commands = await page.evaluate(() => (window as any).__qa.calls.map((item: any) => item.command));
  expect(commands.filter((name: string) => name === "connect_host")).toHaveLength(1);
  expect(commands.filter((name: string) => name === "open_terminal")).toHaveLength(1);
  expect(commands.some((name: string) => /deployment|yiqiban|clipboard|markdown|browser|extension|homebrew|proxy|ai_provider/.test(name))).toBe(false);
});

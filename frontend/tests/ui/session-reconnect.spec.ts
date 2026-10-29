import { expect, test, type Page } from "@playwright/test";
import { desktopFixture } from "./fixtures/desktop";
import { editDirectoryPath } from "./fixtures/navigation";
async function connect(page: Page) {
  await desktopFixture(page);
  await page.goto("/");
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
}
const status = (page: Page) => page.getByRole("status", { name: "测试服务器连接状态", exact: true });

test("disconnection keeps terminal output and exposes retry; failed retry retains the tab and a later retry succeeds", async ({ page }, info) => {
  await connect(page);
  await page.evaluate(() => {
    const qa = (window as any).__qa;
    qa.terminal("\r\nretained-before-disconnect\r\n");
    qa.oldTerminal = document.querySelector(".xterm");
    qa.emit("session-closed", { sessionId: "qa-session-1", reason: "SSH 连接无响应" });
    const invoke = qa.invoke;
    let failed = false;
    qa.invoke = (command: string, args: any) => {
      if (command === "connect_host" && !failed) { failed = true; return Promise.reject({ code: "ssh_connect_failed", message: "网络仍不可用" }); }
      return invoke(command, args);
    };
  });
  await expect(status(page)).toContainText("连接已断开");
  await expect(status(page)).toContainText("SSH 连接无响应");
  await expect(page.locator(".xterm-rows")).toContainText("retained-before-disconnect");
  expect(await page.locator(".xterm").evaluate(el => el === (window as any).__qa.oldTerminal)).toBe(true);
  await page.setViewportSize({ width: 480, height: 820 });
  expect(await status(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(status(page).getByRole("button", { name: "重新连接", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("disconnected-narrow.png"), animations: "disabled" });
  await status(page).getByRole("button", { name: "重新连接", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("网络仍不可用");
  await expect(status(page).getByRole("button", { name: "重新连接", exact: true })).toBeEnabled();
  await expect(page.getByRole("tab", { name: "测试服务器", exact: true })).toHaveAttribute("aria-selected", "true");
  await status(page).getByRole("button", { name: "重新连接", exact: true }).click();
  await expect(status(page)).toHaveCount(0);
  await expect(page.locator(".xterm")).toBeVisible();
  expect(await page.locator(".xterm").evaluate(el => el === (window as any).__qa.oldTerminal)).toBe(false);
  await page.evaluate(() => (window as any).__qa.emit("session-closed", { sessionId: "qa-session-1", reason: "迟到的旧断线事件" }));
  await expect(status(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "write_terminal").length)).toBe(0);
});

test("reconnecting SFTP preserves the selected tool and both directories, disables duplicate attempts and refreshes through the new session", async ({ page }, info) => {
  await connect(page);
  await page.getByRole("button", { name: "SFTP", exact: true }).click();
  const local = page.getByLabel("本地文件目录路径", { exact: true }), remote = page.getByLabel("远程文件目录路径", { exact: true });
  for (const [input, path] of [[local, "/local/project"], [remote, "/opt/duidui/legacy-php"]] as const) {
    await editDirectoryPath(input);
    await input.fill(path);
    await input.press("Enter");
    await expect(input).not.toBeEditable();
    await expect(input).toHaveValue(path);
  }
  await page.evaluate(() => {
    const qa = (window as any).__qa, invoke = qa.invoke;
    qa.emit("session-closed", { sessionId: "qa-session-1", reason: "SSH 连接无响应" });
    const eventName = qa.calls.find((c: any) => c.command === "open_terminal").args.eventName;
    qa.emit(eventName, { kind: "closed", reason: "旧终端关闭" });
    qa.reconnectCount = 0;
    qa.invoke = (command: string, args: any) => {
      if (command === "connect_host") { qa.reconnectCount++; return new Promise(resolve => { qa.finishReconnect = async () => resolve(await invoke(command, args)); }); }
      return invoke(command, args);
    };
  });
  await expect(status(page)).toContainText("SSH 连接无响应");
  await expect(remote).toBeDisabled();
  await expect(page.getByRole("button", { name: "上传文件", exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("sftp-disconnected.png"), animations: "disabled" });
  await status(page).getByRole("button", { name: "重新连接", exact: true }).click();
  await expect(status(page).getByRole("button", { name: "重连中…", exact: true })).toBeDisabled();
  await expect(status(page).locator(".activity-spin")).toHaveCSS("animation-name", "activity-spin");
  expect(await page.evaluate(() => (window as any).__qa.reconnectCount)).toBe(1);
  await page.evaluate(() => (window as any).__qa.finishReconnect());
  await expect(status(page)).toHaveCount(0);
  await expect(page.locator(".activity-spin")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "SFTP", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "远程文件", exact: true })).toBeVisible();
  await expect(local).toHaveValue("/local/project");
  await expect(remote).toHaveValue("/opt/duidui/legacy-php");
  await expect(remote).toBeEnabled();
  await expect.poll(() => page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "list_files" && c.args.endpoint.sessionId === "qa-session-2").at(-1)?.args.path)).toBe("/opt/duidui/legacy-php");
});


test("an idle shell exit offers reopening the terminal without reconnecting a healthy SSH session", async ({ page }) => {
  await connect(page);
  await page.evaluate(() => {
    const qa = (window as any).__qa;
    const eventName = qa.calls.find((c: any) => c.command === "open_terminal").args.eventName;
    qa.emit(eventName, { kind: "closed", reason: "终端空闲超时" });
  });
  const terminalStatus = page.getByRole("status", { name: "测试服务器终端状态", exact: true });
  await expect(terminalStatus).toContainText("SSH 连接仍可用");
  await expect(status(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重新连接", exact: true })).toHaveCount(0);
  await terminalStatus.getByRole("button", { name: "重新打开终端", exact: true }).click();
  await expect(terminalStatus).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "open_terminal").length)).toBe(2);
  expect(await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "connect_host").length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "open_terminal").every((c: any) => c.args.sessionId === "qa-session-1"))).toBe(true);
});

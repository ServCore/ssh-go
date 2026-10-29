import { expect, test, type Page } from "@playwright/test";
import { desktopFixture } from "./fixtures/desktop";

const task = {
  id: "motion-transfer", name: "config.yaml", direction: "upload",
  status: "running", bytesDone: 25, bytesTotal: 100,
  sourcePath: "/local/config.yaml", destinationPath: "/remote/config.yaml",
  destination: { kind: "remote", sessionId: "qa-session-1" }, sessionIds: [],
};
async function open(page: Page) {
  await desktopFixture(page);
  await page.goto("/");
  await expect(page.getByRole("group", { name: "服务器 测试服务器", exact: true })).toBeVisible();
}
async function update(page: Page, changes: Record<string, unknown> = {}) {
  await page.evaluate(t => (window as any).__qa.emit("transfer-update", t), { ...task, ...changes });
}
const footer = (page: Page) => page.getByRole("button", { name: "传输队列", exact: true });
async function visibility(page: Page, hidden: boolean) {
  await page.evaluate(hidden => {
    Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test("transfer motion follows actual state; commit at 100% waits for completion and completion never replays", async ({ page }, info) => {
  await open(page);
  await expect(footer(page).locator(".activity-upload")).toHaveCount(0);
  await update(page);
  await expect(footer(page).locator(".activity-upload")).toHaveCSS("animation-name", "activity-upload");
  await footer(page).click();
  const dialog = page.getByRole("dialog", { name: "传输队列", exact: true });
  await dialog.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const progress = dialog.getByRole("progressbar", { name: "config.yaml 传输进度", exact: true });
  await expect(progress).toHaveAttribute("aria-valuenow", "25");
  await expect(progress.locator("i")).toHaveCSS("transition-duration", "0.24s");
  await page.screenshot({ path: info.outputPath("transfer-progress.png"), animations: "disabled" });
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await update(page, { status: "committing", bytesDone: 100 });
  await expect(progress).toHaveAttribute("aria-valuenow", "100");
  await expect(progress).toHaveAttribute("aria-valuetext", "正在提交");
  await expect(dialog.locator(".is-completed")).toHaveCount(0);
  await expect(footer(page)).not.toContainText("传输已完成");
  await update(page, { status: "completed", bytesDone: 100 });
  await expect(footer(page)).toContainText("传输已完成");
  await expect(dialog.locator(".transfer-direction.is-completed .completion-feedback")).toHaveCount(1);
  await expect(dialog.locator(".activity-upload")).toHaveCount(0);
  await page.clock.runFor(100);
  await page.screenshot({ path: info.outputPath("transfer-completed.png"), animations: "disabled" });
  await page.clock.runFor(1700);
  await expect(footer(page)).toContainText("传输队列空闲");
  await expect(dialog.locator(".completion-feedback")).toHaveCount(0);
  await update(page, { status: "completed", bytesDone: 100 });
  await expect(footer(page)).toContainText("传输队列空闲");
  await expect(dialog.locator(".completion-feedback")).toHaveCount(0);
  await page.getByRole("button", { name: "关闭传输队列", exact: true }).click();
  await footer(page).click();
  await expect(dialog.locator(".transfer-direction.is-completed")).toHaveCount(1);
  await expect(dialog.locator(".completion-feedback")).toHaveCount(0);
});

test("drag target fades in without intercepting input and dropping immediately starts the transfer", async ({ page }, info) => {
  await open(page);
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
  await page.getByRole("button", { name: "SFTP", exact: true }).click();
  const local = page.getByRole("region", { name: "本地文件", exact: true });
  const remote = page.getByRole("region", { name: "远程文件", exact: true });
  await expect(page.getByLabel("远程文件目录路径", { exact: true })).toHaveValue("/remote");
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await local.getByRole("row", { name: "notes.txt", exact: true }).dispatchEvent("dragstart", { dataTransfer });
  await remote.dispatchEvent("dragover", { dataTransfer });
  const overlay = remote.locator(".file-drop-overlay");
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveCSS("pointer-events", "none");
  await expect(overlay).toContainText("松开上传到当前目录");
  await expect(overlay).toHaveCSS("opacity", "0.96");
  await page.screenshot({ path: info.outputPath("drop-target.png"), animations: "disabled" });
  await remote.dispatchEvent("drop", { dataTransfer });
  await expect.poll(() => page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "start_transfer").length)).toBe(1);
  await expect(overlay).toHaveCount(0);
  await expect(remote).not.toHaveClass(/is-drop-target/);
});

test("background work pauses including modal content, reduced motion disables movement, and failures stop activity", async ({ page }) => {
  await open(page);
  await update(page);
  await footer(page).click();
  const moving = page.locator(".activity-upload");
  await expect(moving).toHaveCount(2);
  await visibility(page, true);
  for (const icon of await moving.all()) await expect(icon).toHaveCSS("animation-play-state", "paused");
  await visibility(page, false);
  for (const icon of await moving.all()) await expect(icon).toHaveCSS("animation-play-state", "running");
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const icon of await moving.all()) await expect(icon).toHaveCSS("animation-name", "none");
  await expect(page.locator(".transfer-progress-fill")).toHaveCSS("transition-duration", "0s");
  await update(page, { status: "failed", error: "连接已断开" });
  await expect(moving).toHaveCount(0);
  await expect(footer(page)).toContainText("传输队列空闲");
  await expect(page.locator(".transfer-item")).toContainText("传输失败");
});

test("queued and unknown-size tasks do not simulate progress; hidden completions and startup history do not celebrate", async ({ page }) => {
  await desktopFixture(page);
  await page.addInitScript(history => {
    const qa = (window as any).__qa, invoke = qa.invoke;
    qa.invoke = (command: string, args: unknown) => command === "list_transfers" ? [history] : invoke(command, args);
  }, { ...task, id: "history-transfer", status: "completed", bytesDone: 100 });
  await page.goto("/");
  await expect(footer(page)).toContainText("传输队列空闲");
  await update(page, { status: "queued", bytesDone: 0, bytesTotal: 0 });
  await expect(footer(page)).toContainText("准备中");
  await expect(footer(page).locator('[class*="activity-"]')).toHaveCount(0);
  await footer(page).click();
  const progress = page.getByRole("progressbar", { name: "config.yaml 传输进度", exact: true }).first();
  await expect(progress).not.toHaveAttribute("aria-valuenow");
  await expect(page.locator(".completion-feedback")).toHaveCount(0);
  await visibility(page, true);
  await update(page, { status: "completed", bytesDone: 100 });
  await visibility(page, false);
  await expect(footer(page)).toContainText("传输队列空闲");
  await expect(page.locator(".completion-feedback")).toHaveCount(0);
});

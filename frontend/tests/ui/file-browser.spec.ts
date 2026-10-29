import { expect, test, type Page } from "@playwright/test";
import { desktopFixture } from "./fixtures/desktop";

async function openFiles(page: Page, large = false) {
  await desktopFixture(page, large);
  await page.goto("/");
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
  await page.getByRole("button", { name: "SFTP", exact: true }).click();
  await expect(page.getByLabel("本地文件目录路径", { exact: true })).toHaveValue("/local");
  await expect(page.getByLabel("远程文件目录路径", { exact: true })).toHaveValue("/remote");
}
const panel = (page: Page, kind: "local" | "remote") => page.getByRole("region", { name: kind === "local" ? "本地文件" : "远程文件", exact: true });
async function transferCalls(page: Page) {
  return page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "start_transfer").map((c: any) => c.args.request));
}

test("list and icon modes preserve selection, stay virtualized and remember each panel independently", async ({ page }, info) => {
  await openFiles(page, true);
  const local = panel(page, "local"), remote = panel(page, "remote");
  await local.getByRole("row", { name: "item-00000.txt", exact: true }).click();
  await local.getByRole("button", { name: "本地文件图标展示", exact: true }).click();
  const grid = local.getByRole("grid", { name: "本地文件图标", exact: true });
  await expect(grid.getByRole("gridcell", { name: "item-00000.txt", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(await grid.getByRole("gridcell").count()).toBeLessThan(120);
  await expect(remote.getByRole("table")).toBeVisible();
  await grid.getByRole("gridcell", { name: "item-00000.txt", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(grid.getByRole("gridcell", { name: "item-09999.txt", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(grid.getByRole("gridcell", { name: "item-00000.txt", exact: true })).toBeFocused();
  await local.getByLabel("搜索本地文件", { exact: true }).fill("item-09999");
  await expect(grid.getByRole("gridcell")).toHaveCount(1);
  await expect(grid.getByRole("gridcell")).toHaveAttribute("aria-label", "item-09999.txt");
  await local.getByLabel("搜索本地文件", { exact: true }).fill("");
  await grid.locator(".file-scroll").evaluate(el => { el.scrollTop = 1000000; el.dispatchEvent(new Event("scroll")); });
  await expect(grid.getByRole("gridcell", { name: "item-09999.txt", exact: true })).toBeVisible();
  expect(await grid.getByRole("gridcell").count()).toBeLessThan(120);
  await local.getByRole("button", { name: "本地文件列表展示", exact: true }).click();
  await expect(local.getByRole("row", { name: "item-00000.txt", exact: true })).toHaveAttribute("aria-selected", "true");
  await local.getByRole("button", { name: "本地文件图标展示", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("qa-preferences") || "{}")["files.local.viewMode"])).toBe("icons");
  await page.screenshot({ path: info.outputPath("icons-and-list.png"), animations: "disabled" });
  await page.reload();
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await page.getByRole("button", { name: "SFTP", exact: true }).click();
  await expect(panel(page, "local").getByRole("grid")).toBeVisible();
  await expect(panel(page, "remote").getByRole("table")).toBeVisible();
  for (const width of [1280, 800, 480]) {
    await page.setViewportSize({ width, height: 820 });
    await expect.poll(() => panel(page, "local").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect.poll(() => panel(page, "remote").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
});

for (const kind of ["local", "remote"] as const) {
  test(`${kind} context menu creates in its own directory, changes modes and refreshes with keyboard support`, async ({ page }, info) => {
    await openFiles(page);
    const area = panel(page, kind), title = kind === "local" ? "本地文件" : "远程文件";
    const menu = page.getByRole("menu", { name: `${title}操作`, exact: true });
    const rightClick = () => area.locator(".file-scroll").click({ button: "right", position: { x: 40, y: 220 } });
    await rightClick();
    await expect(menu.getByRole("menuitem", { name: "新建目录", exact: true })).toBeFocused();
    await menu.getByRole("menuitem", { name: "新建文件", exact: true }).click();
    const create = page.getByRole("dialog", { name: "新建文件", exact: true });
    await create.getByLabel("文件名称", { exact: true }).fill("config.yaml");
    await create.getByRole("button", { name: "确认", exact: true }).click();
    await expect(create).toHaveCount(0);
    const calls = await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "create_file"));
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toMatchObject({ endpoint: kind === "local" ? { kind } : { kind, sessionId: "qa-session-1" }, path: `/${kind}/config.yaml` });
    await rightClick();
    await menu.getByRole("menuitem", { name: "新建目录", exact: true }).click();
    const mkdir = page.getByRole("dialog", { name: "新建目录", exact: true });
    await mkdir.getByLabel("目录名称", { exact: true }).fill("new/nested");
    await mkdir.getByRole("button", { name: "确认", exact: true }).click();
    await expect(mkdir).toHaveCount(0);
    await rightClick();
    await menu.getByRole("menuitemradio", { name: "图标展示", exact: true }).click();
    await expect(area.getByRole("grid")).toBeVisible();
    await rightClick();
    await expect(menu.getByRole("menuitemradio", { name: "图标展示", exact: true })).toHaveAttribute("aria-checked", "true");
    await page.screenshot({ path: info.outputPath(`${kind}-context-menu.png`), animations: "disabled" });
    const reads = () => page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "list_files").length);
    const before = await reads();
    await menu.getByRole("menuitem", { name: "刷新", exact: true }).click();
    await expect.poll(reads).toBe(before + 1);
    const notes = area.getByRole("gridcell", { name: "notes.txt", exact: true });
    await area.getByRole("gridcell", { name: "empty", exact: true }).focus();
    await page.keyboard.press("End");
    await expect(notes).toBeFocused();
    await expect(notes).toHaveAttribute("aria-selected", "true");
    await notes.focus();
    await notes.press("Shift+F10");
    await expect(menu.getByRole("menuitem", { name: "重命名", exact: true })).toBeEnabled();
    await page.keyboard.press("End");
    await expect(menu.getByRole("menuitem", { name: "删除", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(notes).toBeFocused();
  });
}

test("dragging across panels copies through the transfer queue, confirms conflicts and supports both directions", async ({ page }) => {
  await openFiles(page);
  const local = panel(page, "local"), remote = panel(page, "remote");
  await local.getByRole("row", { name: "notes.txt", exact: true }).dragTo(remote.locator(".file-scroll"));
  await expect.poll(async () => (await transferCalls(page)).length).toBe(1);
  expect((await transferCalls(page))[0]).toMatchObject({ source: { kind: "local" }, destination: { kind: "remote", sessionId: "qa-session-1" }, sourcePath: "/local/notes.txt", destinationPath: "/remote/notes.txt", overwrite: true });
  await expect(local.getByRole("button", { name: "上传所选文件", exact: true })).toBeEnabled();
  await remote.getByRole("button", { name: "远程文件图标展示", exact: true }).click();
  await remote.getByRole("gridcell", { name: "notes.txt", exact: true }).dragTo(local.locator(".file-scroll"));
  await expect.poll(async () => (await transferCalls(page)).length).toBe(2);
  expect((await transferCalls(page))[1]).toMatchObject({ source: { kind: "remote", sessionId: "qa-session-1" }, destination: { kind: "local" }, sourcePath: "/remote/notes.txt", destinationPath: "/local/notes.txt", overwrite: true });
  await page.evaluate(() => { (window as any).__qa.confirmResult = "取消"; });
  await local.getByRole("row", { name: "notes.txt", exact: true }).dragTo(remote.locator(".file-scroll"));
  await expect(page.getByRole("status").filter({ hasText: "跳过 1 项" })).toBeVisible();
  expect(await transferCalls(page)).toHaveLength(2);
  await expect(page.locator(".file-drop-overlay")).toHaveCount(0);
});

test("dragging multiple selected entries preserves the batch and rejects same-panel or external payloads", async ({ page }) => {
  await openFiles(page);
  await page.evaluate(() => {
    const qa = (window as any).__qa, invoke = qa.invoke;
    qa.invoke = (command: string, args: any) => command === "list_files" && args.endpoint.kind === "remote" ? [] : invoke(command, args);
  });
  const local = panel(page, "local"), remote = panel(page, "remote");
  const notes = local.getByRole("row", { name: "notes.txt", exact: true });
  await notes.dragTo(local.locator(".file-scroll"));
  expect(await transferCalls(page)).toHaveLength(0);
  const data = await page.evaluateHandle(() => { const d = new DataTransfer(); d.setData("application/x-ssh-go-files", "forged"); return d; });
  await remote.dispatchEvent("dragover", { dataTransfer: data });
  await remote.dispatchEvent("drop", { dataTransfer: data });
  expect(await transferCalls(page)).toHaveLength(0);
  await notes.click();
  await local.getByRole("row", { name: "empty", exact: true }).click({ modifiers: ["ControlOrMeta"] });
  await notes.dragTo(remote.locator(".file-scroll"));
  await expect.poll(async () => (await transferCalls(page)).length).toBe(2);
  expect((await transferCalls(page)).map((c: any) => c.sourcePath).sort()).toEqual(["/local/empty", "/local/notes.txt"]);
  await page.evaluate(() => (window as any).__qa.emit("session-closed", { sessionId: "qa-session-1", reason: "断开" }));
  await expect(notes).toHaveAttribute("draggable", "false");
  await remote.locator(".file-scroll").click({ button: "right", position: { x: 40, y: 200 } });
  await expect(page.getByRole("menuitem", { name: "新建文件", exact: true })).toBeDisabled();
});

test("failed file creation keeps its dialog and never refreshes or overwrites through the UI", async ({ page }) => {
  await openFiles(page);
  await page.evaluate(() => {
    const qa = (window as any).__qa, invoke = qa.invoke;
    qa.invoke = (command: string, args: any) => command === "create_file" ? Promise.reject({ code: "file_exists", message: "目标路径已存在" }) : invoke(command, args);
  });
  await panel(page, "remote").locator(".file-scroll").click({ button: "right", position: { x: 40, y: 220 } });
  await page.getByRole("menuitem", { name: "新建文件", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "新建文件", exact: true });
  await modal.getByLabel("文件名称", { exact: true }).fill("notes.txt");
  const readsBefore = await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "list_files").length);
  await modal.getByRole("button", { name: "确认", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("目标路径已存在");
  await expect(modal.getByLabel("文件名称", { exact: true })).toHaveValue("notes.txt");
  expect(await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "list_files").length)).toBe(readsBefore);
});

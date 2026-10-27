import { expect, test, type Page } from "@playwright/test";
import { desktopFixture } from "./fixtures/desktop";
import { selectSession } from "./fixtures/navigation";

async function connectFiles(page: Page, name = "测试服务器") {
  await page.getByRole("group", { name: `服务器 ${name}`, exact: true }).dblclick();
  await expect(page.locator(".xterm:visible")).toBeVisible();
  await page.getByRole("button", { name: "SFTP", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "本地文件目录路径", exact: true })).toHaveValue("/local");
  await expect(page.getByRole("textbox", { name: "远程文件目录路径", exact: true })).toHaveValue("/remote");
  await expect(page.getByRole("button", { name: "刷新远程文件", exact: true })).toBeEnabled();
}
async function reads(page: Page) {
  return page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "list_files").map((c: any) => ({ ...c.args.endpoint, path: c.args.path })));
}
async function clearReads(page: Page) { await page.evaluate(() => { (window as any).__qa.calls = []; }); }
async function finish(page: Page, ids: string[], sessionId: string | null, directory = "/remote") {
  await page.evaluate(({ ids, sessionId, directory }) => {
    const qa = (window as any).__qa;
    for (const id of ids) qa.emit("transfer-update", {
      id, name: `${id}.txt`, direction: sessionId ? "upload" : "download",
      destination: sessionId ? { kind: "remote", sessionId } : { kind: "local" },
      sessionIds: sessionId ? [sessionId] : ["qa-session-2"], status: "completed",
      bytesDone: 64, bytesTotal: 64, error: null,
      sourcePath: `/source/${id}.txt`, destinationPath: `${directory}/${id}.txt`,
    });
  }, { ids, sessionId, directory });
}

test("transfer completions refresh only matching destinations, coalesce bursts and defer hidden sessions", async ({ page }) => {
  await desktopFixture(page, false, false, true);
  await page.clock.install();
  await page.goto("/");
  await connectFiles(page);
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await connectFiles(page, "生产 API");
  const remote = page.getByRole("region", { name: "远程文件", exact: true });
  await remote.getByRole("row", { name: "notes.txt", exact: true }).click();
  await clearReads(page);
  await finish(page, ["b1", "b2", "b3", "b3"], "qa-session-2");
  await finish(page, ["a1", "a2"], "qa-session-1");
  await finish(page, ["unrelated"], "qa-session-2", "/elsewhere");
  await page.clock.runFor(250);
  expect(await reads(page)).toEqual([{ kind: "remote", sessionId: "qa-session-2", path: "/remote" }]);
  await expect(remote.getByRole("row", { name: "notes.txt", exact: true })).toHaveAttribute("aria-selected", "true");
  await clearReads(page);
  await selectSession(page, "测试服务器");
  await page.clock.runFor(250);
  expect(await reads(page)).toEqual([{ kind: "remote", sessionId: "qa-session-1", path: "/remote" }]);
  await clearReads(page);
  await finish(page, ["download1", "download2"], null, "/local");
  await page.clock.runFor(250);
  expect(await reads(page)).toEqual([{ kind: "local", path: "/local" }]);
  await clearReads(page);
  await selectSession(page, "生产 API");
  await page.clock.runFor(250);
  expect(await reads(page)).toEqual([{ kind: "local", path: "/local" }]);
});

test("hidden windows retain dirty directories without IO, and closed or removed remote panels stay idle", async ({ page }) => {
  await desktopFixture(page);
  await page.addInitScript(() => {
    const qa = (window as any).__qa;
    qa.pageHidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => qa.pageHidden });
  });
  await page.clock.install();
  await page.goto("/");
  await connectFiles(page);
  await clearReads(page);
  await page.evaluate(() => { (window as any).__qa.pageHidden = true; document.dispatchEvent(new Event("visibilitychange")); });
  await finish(page, ["remote-hidden"], "qa-session-1");
  await finish(page, ["local-hidden"], null, "/local");
  await page.clock.runFor(1000);
  expect(await reads(page)).toEqual([]);
  await page.evaluate(() => { (window as any).__qa.pageHidden = false; document.dispatchEvent(new Event("visibilitychange")); });
  await page.clock.runFor(250);
  expect(await reads(page)).toEqual(expect.arrayContaining([{ kind: "local", path: "/local" }, { kind: "remote", sessionId: "qa-session-1", path: "/remote" }]));
  expect(await reads(page)).toHaveLength(2);
  await page.getByRole("button", { name: "终端", exact: true }).click();
  await clearReads(page);
  await finish(page, ["after-close-remote"], "qa-session-1");
  await finish(page, ["after-close-local"], null, "/local");
  await page.evaluate(() => (window as any).__qa.emit("session-closed", { sessionId: "qa-session-1", reason: "测试断开" }));
  await page.getByRole("button", { name: "SFTP", exact: true }).click();
  await page.clock.runFor(250);
  expect(await reads(page)).toEqual([{ kind: "local", path: "/local" }]);
  await page.getByRole("button", { name: "移除 测试服务器", exact: true }).click();
  await clearReads(page);
  await finish(page, ["removed-remote"], "qa-session-1");
  await finish(page, ["removed-local"], null, "/local");
  await page.clock.runFor(500);
  expect(await reads(page)).toEqual([]);
});

test("completion during a directory read schedules one follow-up, and a failed refresh retries only after return", async ({ page }) => {
  await desktopFixture(page);
  await page.clock.install();
  await page.goto("/");
  await connectFiles(page);
  await page.evaluate(() => {
    const qa = (window as any).__qa, original = qa.invoke;
    let pause = true;
    qa.invoke = async (command: string, args: any) => {
      const result = await original(command, args);
      if (command === "list_files" && args.endpoint.kind === "remote") {
        if (pause) { pause = false; return new Promise(resolve => { qa.finishRead = () => resolve(result); }); }
        if (qa.failRefresh) throw { message: "测试目录读取失败" };
        return [...result, { name: "arrived.txt", path: `${args.path}/arrived.txt`, kind: "file", size: 1, modified: null }];
      }
      return result;
    };
  });
  await clearReads(page);
  await page.getByRole("button", { name: "刷新远程文件", exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__qa.finishRead)).toBe("function");
  await finish(page, ["during-read1", "during-read2"], "qa-session-1");
  await page.clock.runFor(500);
  expect(await reads(page)).toHaveLength(1);
  await page.evaluate(() => (window as any).__qa.finishRead());
  await page.clock.runFor(250);
  expect(await reads(page)).toHaveLength(2);
  await expect(page.getByRole("region", { name: "远程文件", exact: true }).getByRole("row", { name: "arrived.txt", exact: true })).toBeVisible();
  await clearReads(page);
  await page.evaluate(() => { (window as any).__qa.failRefresh = true; });
  await finish(page, ["failed-read"], "qa-session-1");
  await page.clock.runFor(5000);
  expect(await reads(page)).toHaveLength(1);
  await expect(page.getByRole("alert")).toContainText("测试目录读取失败");
  await page.evaluate(() => { (window as any).__qa.failRefresh = false; });
  await page.getByRole("button", { name: "终端", exact: true }).click();
  await page.getByRole("button", { name: "SFTP", exact: true }).click();
  await page.clock.runFor(250);
  expect(await reads(page)).toHaveLength(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("large selection refresh removes vanished entries while retaining search, ordering and scroll position", async ({ page }) => {
  await desktopFixture(page, true);
  await page.goto("/");
  await connectFiles(page);
  const panel = page.getByRole("region", { name: "本地文件", exact: true });
  await panel.getByRole("row", { name: "item-00000.txt", exact: true }).focus();
  await page.keyboard.press("Meta+a");
  await expect(panel).toContainText("已选 10000 项");
  await panel.getByLabel("本地文件排序", { exact: true }).selectOption("size");
  await panel.getByLabel("搜索本地文件", { exact: true }).fill("item-09");
  await panel.locator(".file-scroll").evaluate(el => { el.scrollTop = 740; });
  await page.evaluate(() => {
    const qa = (window as any).__qa, original = qa.invoke;
    qa.invoke = async (command: string, args: any) => {
      const result = await original(command, args);
      return command === "list_files" && args.endpoint.kind === "local" ? result.slice(1) : result;
    };
  });
  await panel.getByRole("button", { name: "刷新本地文件", exact: true }).click();
  await expect(panel).toContainText("已选 9999 项");
  await expect(panel.getByLabel("搜索本地文件", { exact: true })).toHaveValue("item-09");
  await expect(panel.getByLabel("本地文件排序", { exact: true })).toHaveValue("size");
  expect(await panel.locator(".file-scroll").evaluate(el => el.scrollTop)).toBe(740);
  expect(await panel.getByRole("table").getByRole("row").count()).toBeLessThan(100);
});

test("startup history causes no refresh, and completion for the old directory does not interrupt navigation", async ({ page }) => {
  await desktopFixture(page);
  await page.addInitScript(() => {
    const qa = (window as any).__qa, original = qa.invoke;
    qa.invoke = (command: string, args: any) => command === "list_transfers"
      ? new Promise(resolve => { qa.finishHistory = () => resolve([{ id: "old", name: "old.txt", destination: { kind: "remote", sessionId: "qa-session-1" }, direction: "upload", sessionIds: ["qa-session-1"], status: "completed", bytesDone: 1, bytesTotal: 1, error: null, sourcePath: "/source/old.txt", destinationPath: "/remote/old.txt" }]); })
      : original(command, args);
  });
  await page.clock.install();
  await page.goto("/");
  await connectFiles(page);
  await clearReads(page);
  await page.evaluate(() => (window as any).__qa.finishHistory());
  await page.clock.runFor(250);
  expect(await reads(page)).toEqual([]);
  await page.evaluate(() => {
    const qa = (window as any).__qa, original = qa.invoke;
    qa.invoke = (command: string, args: any) => command === "resolve_file_path" && args.path === "/new"
      ? new Promise(resolve => { qa.finishResolve = () => resolve("/new"); }) : original(command, args);
  });
  const path = page.getByRole("textbox", { name: "远程文件目录路径", exact: true });
  await path.fill("/new");
  await path.press("Enter");
  await expect.poll(() => page.evaluate(() => typeof (window as any).__qa.finishResolve)).toBe("function");
  await finish(page, ["old-directory-change"], "qa-session-1");
  await page.clock.runFor(250);
  expect(await reads(page)).toEqual([]);
  await page.evaluate(() => (window as any).__qa.finishResolve());
  await page.clock.runFor(250);
  await expect(path).toHaveValue("/new");
  expect(await reads(page)).toEqual([{ kind: "remote", sessionId: "qa-session-1", path: "/new" }]);
});

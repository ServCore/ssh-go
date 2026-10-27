import { expect, test, type Page } from "@playwright/test";
import { desktopFixture } from "./fixtures/desktop";

async function files(page: Page, large = false) {
  await desktopFixture(page, large);
  await page.goto("/");
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
  await page.getByRole("button", { name: "SFTP", exact: true }).click();
  await expect(page.getByLabel("本地文件目录路径")).toHaveValue("/local");
  await expect(page.getByLabel("远程文件目录路径")).toHaveValue("/remote");
}

test("explicit light appearance overrides the system and fits laptop widths", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    localStorage.setItem("ssh-go.appearance.mode", "light");
    localStorage.setItem(
      "qa-preferences",
      JSON.stringify({ "appearance.mode": "light" }),
    );
  });
  await desktopFixture(page, false, false, true);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByLabel("外观模式", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "服务器 生产 API", exact: true }),
  ).toBeVisible();
  for (const width of [1440, 1280, 960, 800]) {
    await page.setViewportSize({ width, height: 820 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.locator(".ssh-app")).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.test-artifacts/vue-hosts-light-${width}.png`,
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.keyboard.press("Meta+,");
  await expect(page.getByLabel("外观模式", { exact: true })).toHaveValue("light");
  await page.screenshot({
    path: ".test-artifacts/vue-settings-light.png",
    animations: "disabled",
  });
});

test("empty workspace is useful without adding sample or fake servers", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("qa-hosts", "[]"));
  await desktopFixture(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "添加第一台服务器", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".host-card")).toHaveCount(0);
  await page.screenshot({
    path: ".test-artifacts/vue-empty-light.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "添加服务器", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "添加服务器", exact: true });
  await expect(dialog.getByLabel("服务器名称")).toBeFocused();
  await expect(dialog.locator(".arco-modal")).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: ".test-artifacts/vue-host-editor-light.png",
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).__qa.calls.filter((c: any) => c.command === "save_host")
          .length,
    ),
  ).toBe(0);
});

test("command search works with keyboard and dialogs contain and restore focus", async ({
  page,
}) => {
  await desktopFixture(page);
  await page.goto("/");
  const trigger = page.getByRole("button", {
    name: "搜索资源与操作",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "搜索资源与操作",
    exact: true,
  });
  const input = dialog.getByLabel("搜索资源", { exact: true });
  await expect(input).toBeFocused();
  const buttons = dialog.getByRole("button");
  await buttons.last().focus();
  await page.keyboard.press("Tab");
  await expect(buttons.first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Meta+k");
  await expect(dialog).toBeVisible();
  await input.fill("设置");
  await input.press("Enter");
  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();
});

test("large SFTP directories remain virtualized and shift selection submits every selected file", async ({
  page,
}) => {
  await files(page, true);
  const local = page.getByRole("region", { name: "本地文件", exact: true });
  const table = local.getByRole("table");
  await expect(table).toHaveAttribute("aria-rowcount", "10001");
  expect(await table.getByRole("row").count()).toBeLessThan(100);
  await table.getByRole("row", { name: "item-00000.txt", exact: true }).click();
  await table
    .getByRole("row", { name: "item-00002.txt", exact: true })
    .click({ modifiers: ["Shift"] });
  await expect(local).toContainText("已选 3 项");
  await local
    .getByRole("button", { name: "上传所选文件", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "已提交 3 项" }),
  ).toBeVisible();
  const calls = await page.evaluate(() =>
    (window as any).__qa.calls.filter(
      (c: any) => c.command === "start_transfer",
    ),
  );
  expect(calls.map((c: any) => c.args.request.sourcePath)).toEqual([
    "/local/item-00000.txt",
    "/local/item-00001.txt",
    "/local/item-00002.txt",
  ]);
  await page.getByRole("button", { name: "传输队列", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "传输队列", exact: true }),
  ).toContainText("item-00002.txt");
  await expect(
    page
      .getByRole("dialog", { name: "传输队列", exact: true })
      .locator(".arco-modal"),
  ).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: ".test-artifacts/vue-transfers-light.png",
    animations: "disabled",
  });
});

test("SFTP path requests discard stale replies and file actions use the selected endpoint", async ({
  page,
}) => {
  await files(page);
  const local = page.getByRole("region", { name: "本地文件", exact: true });
  await local
    .getByRole("button", { name: "本地文件新建目录", exact: true })
    .click();
  let modal = page.getByRole("dialog", { name: "新建目录", exact: true });
  await modal.getByLabel("目录名称").fill("project");
  await modal.getByRole("button", { name: "确认", exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).__qa.calls.find((c: any) => c.command === "mkdir_file")
          .args,
    ),
  ).toMatchObject({ endpoint: { kind: "local" }, path: "/local/project" });
  await local.getByRole("row", { name: "notes.txt", exact: true }).click();
  await local
    .getByRole("button", { name: "本地文件重命名", exact: true })
    .click();
  modal = page.getByRole("dialog", { name: "重命名文件", exact: true });
  await modal.getByLabel("新名称").fill("renamed.txt");
  await modal.getByRole("button", { name: "确认", exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).__qa.calls.find((c: any) => c.command === "rename_file")
          .args,
    ),
  ).toMatchObject({
    source: "/local/notes.txt",
    destination: "/local/renamed.txt",
  });
  await page.evaluate(() => {
    const qa = (window as any).__qa,
      original = qa.invoke;
    qa.invoke = async (command: string, args: any = {}) => {
      if (command === "list_files" && args.path === "/slow")
        return new Promise((resolve) => {
          qa.finishSlow = () =>
            resolve([
              {
                name: "stale.txt",
                path: "/slow/stale.txt",
                kind: "file",
                size: 1,
                modified: null,
              },
            ]);
        });
      return original(command, args);
    };
  });
  const path = page.getByLabel("远程文件目录路径");
  await path.fill("/slow");
  await path.press("Enter");
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).__qa.finishSlow))
    .toBe("function");
  await path.fill("/new");
  await path.press("Enter");
  await expect(
    page
      .getByRole("region", { name: "远程文件", exact: true })
      .getByRole("row", { name: "notes.txt", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).__qa.finishSlow());
  await expect(path).toHaveValue("/new");
  await expect(
    page.getByRole("row", { name: "stale.txt", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: ".test-artifacts/vue-sftp-light.png",
    animations: "disabled",
  });
});

test("queue-full stops the batch and a stale RPC result cannot regress a transfer event", async ({
  page,
}) => {
  await files(page, true);
  await page.evaluate(() => {
    const qa = (window as any).__qa;
    qa.queueLimit = 2;
    const original = qa.invoke;
    qa.invoke = async (command: string, args: any = {}) => {
      const result = await original(command, args);
      return command === "start_transfer"
        ? { ...result, status: "queued", bytesDone: 0 }
        : result;
    };
  });
  const local = page.getByRole("region", { name: "本地文件", exact: true });
  await local.getByRole("row", { name: "item-00000.txt", exact: true }).click();
  await local
    .getByRole("row", { name: "item-00004.txt", exact: true })
    .click({ modifiers: ["Shift"] });
  await local
    .getByRole("button", { name: "上传所选文件", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "已提交 2 项" }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "传输队列已满" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).__qa.calls.filter(
          (c: any) => c.command === "start_transfer",
        ).length,
    ),
  ).toBe(3);
  await page.getByRole("button", { name: "传输队列", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "传输队列", exact: true });
  await expect(dialog.locator(".transfer-item")).toHaveCount(2);
  await expect(dialog.getByText("传输中", { exact: true })).toHaveCount(2);
  await expect(dialog.getByText("排队中", { exact: true })).toHaveCount(0);
});

test("SFTP uploads live in the remote heading and target the current directory", async ({ page }, info) => {
  await files(page);
  await expect(page.locator(".file-workspace-toolbar")).toHaveCount(0);
  const remote = page.getByRole("region", { name: "远程文件", exact: true });
  const local = page.getByRole("region", { name: "本地文件", exact: true });
  await expect(remote.locator(".file-panel-title").getByRole("button", { name: "上传文件", exact: true })).toBeEnabled();
  await expect(local.getByRole("button", { name: "上传文件", exact: true })).toHaveCount(0);
  const workspaceBounds = (await page.locator(".file-workspace").boundingBox())!;
  expect((await remote.boundingBox())!.y).toBeCloseTo(workspaceBounds.y, 0);
  expect((await local.boundingBox())!.y).toBeCloseTo(workspaceBounds.y, 0);
  await page.screenshot({ path: info.outputPath("sftp-integrated-actions.png"), animations: "disabled" });
  const path = page.getByLabel("远程文件目录路径");
  await path.fill("/target");
  await path.press("Enter");
  await expect(remote.getByRole("button", { name: "刷新远程文件", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    (window as any).__qa.filesToUpload = ["/local/upload-one.txt", "/local/upload-two.txt"];
    (window as any).__qa.selectedFile = "/local/archive";
  });
  await remote.getByRole("button", { name: "上传文件", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已提交 2 项" })).toBeVisible();
  await remote.getByRole("button", { name: "上传目录", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已提交 1 项" })).toBeVisible();
  const transfers = await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "start_transfer").map((c: any) => c.args.request));
  expect(transfers.map((t: any) => t.destinationPath)).toEqual(["/target/upload-one.txt", "/target/upload-two.txt", "/target/archive"]);
  for (const transfer of transfers) expect(transfer.destination).toEqual({ kind: "remote", sessionId: "qa-session-1" });
  await page.setViewportSize({ width: 800, height: 700 });
  expect(await remote.locator(".file-panel-title").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.evaluate(() => (window as any).__qa.emit("session-closed", { sessionId: "qa-session-1", reason: "连接断开" }));
  await expect(remote.getByRole("button", { name: "上传文件", exact: true })).toBeDisabled();
  await expect(remote.getByRole("button", { name: "上传目录", exact: true })).toBeDisabled();
});

test("terminal navigation uses SFTP for files and retains each workspace", async ({ page }) => {
  await files(page);
  const path = page.getByLabel("远程文件目录路径");
  await path.fill("/retained");
  await path.press("Enter");
  await expect(page.getByRole("button", { name: "刷新远程文件", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "终端", exact: true }).click();
  await expect(page.locator(".xterm")).toBeVisible();
  await expect(page.getByRole("button", { name: "文件面板", exact: true })).toHaveCount(0);
  await expect(page.locator(".files-slot")).toBeHidden();
  await page.getByRole("button", { name: "SFTP", exact: true }).click();
  await expect(page.getByRole("button", { name: "SFTP", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(path).toHaveValue("/retained");
  await expect(page.getByRole("button", { name: "上传文件", exact: true })).toBeEnabled();
  await expect(page.locator(".files-slot.is-docked")).toHaveCount(0);
  await page.getByRole("button", { name: "终端", exact: true }).click();
  await expect(page.locator(".files-slot")).toBeHidden();
  await expect(page.locator(".xterm")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "open_terminal").length)).toBe(1);
});

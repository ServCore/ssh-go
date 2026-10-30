import { openHostSettings } from "./fixtures/navigation";
import { expect, test } from "@playwright/test";
import { desktopFixture } from "./fixtures/desktop";

test("server cards keep a comfortable wide proportion, wrap responsively and retain search", async ({
  page,
}) => {
  await desktopFixture(page, false, false, true);
  await page.goto("/");
  const cards = page.locator(".host-card");
  await expect(cards).toHaveCount(7);
  await expect(cards.locator(".host-card-identity p")).toHaveCount(0);
  await expect(
    page.locator(".host-row, .host-list-header, .host-inspector"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "连接详情", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".host-grid")).toHaveCSS("flex-wrap", "wrap");
  await expect(page.locator(".workspace-navigation")).toHaveCount(0);
  await expect(page.getByText("已打开的连接", { exact: true })).toHaveCount(0);
  const first = await cards.nth(0).boundingBox(),
    second = await cards.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second!.x).toBeGreaterThan(first!.x + first!.width);
  expect(second!.y).toBe(first!.y);
  expect(first!.width).toBeGreaterThanOrEqual(240);
  expect(first!.height).toBeLessThanOrEqual(100);
  expect(second!.width).toBeGreaterThan(first!.width);
  for (const width of [1440, 1280, 960, 800]) {
    await page.setViewportSize({ width, height: 820 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const toolbar = await page.locator(".hosts-toolbar").boundingBox();
    const grid = await page.locator(".host-grid").boundingBox();
    expect(toolbar!.height).toBeLessThanOrEqual(40);
    expect(grid!.y - toolbar!.y).toBeLessThanOrEqual(56);
    for (const box of await cards.evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width };
      }),
    )) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
      expect(box.width).toBeGreaterThanOrEqual(240);
      expect(box.width).toBeLessThanOrEqual(320);
    }
  }
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({
    path: ".test-artifacts/vue-host-cards.png",
    animations: "disabled",
  });
  await page.getByLabel("搜索服务器", { exact: true }).fill("ubuntu.example");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("生产 API");
});

test("single clicks leave no selected highlight, hover and keyboard expose edit and copy, and right-click keeps deletion", async ({ page }) => {
  await desktopFixture(page, false, false, true);
  await page.goto("/");
  const card = page.getByRole("group", { name: "服务器 测试服务器", exact: true });
  const actions = card.locator(".host-card-quick-actions");
  const edit = card.getByRole("button", { name: "编辑连接 测试服务器", exact: true });
  const copy = card.getByRole("button", { name: "复制连接 测试服务器", exact: true });
  const background = await card.evaluate(element => getComputedStyle(element).backgroundColor);
  const border = await card.evaluate(element => getComputedStyle(element).borderColor);
  await expect(actions).toHaveCSS("opacity", "0");
  await card.click();
  await expect(card).not.toHaveClass(/selected/);
  await expect(page.getByRole("region", { name: "服务器", exact: true })).toBeVisible();
  await expect(page.locator(".host-settings-tab")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "connect_host").length)).toBe(0);
  await page.getByLabel("搜索服务器", { exact: true }).focus();
  await page.getByRole("heading", { name: "服务器", exact: true }).hover();
  await expect(actions).toHaveCSS("opacity", "0");
  await expect(card).toHaveCSS("background-color", background);
  await expect(card).toHaveCSS("border-color", border);
  await card.hover();
  await expect(actions).toHaveCSS("opacity", "1");
  await expect(edit).toHaveAttribute("title", "编辑连接");
  await expect(copy).toHaveAttribute("title", "复制连接");
  const titleBox = (await card.locator("h2").boundingBox())!;
  const actionsBox = (await actions.boundingBox())!;
  expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(titleBox.y);
  await page.screenshot({ path: ".test-artifacts/vue-host-card-hover-actions.png", animations: "disabled" });
  await card.focus();
  await page.mouse.move(0, 0);
  await page.keyboard.press("Tab");
  await expect(edit).toBeFocused();
  await expect(actions).toHaveCSS("opacity", "1");
  await edit.press("Enter");
  await expect(page.getByRole("tabpanel", { name: "测试服务器 · 连接设置", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await card.hover();
  await copy.click();
  await expect(page.getByRole("tabpanel", { name: "测试服务器（副本） · 连接设置", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "duplicate_host").length)).toBe(1);
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await card.click({ button: "right" });
  for (const name of ["编辑连接", "复制连接", "删除服务器"]) {
    await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
  }
  await page.getByRole("menuitem", { name: "编辑连接", exact: true }).click();
  await expect(page.getByRole("tab", { name: "测试服务器 · 连接设置", exact: true })).toHaveCount(1);
});

test("blank-space right-click offers page actions, keyboard navigation, refresh and adding a server", async ({ page }) => {
  await desktopFixture(page, false, false, true);
  await page.goto("/");
  await expect(page.locator(".host-card")).toHaveCount(7);
  const list = page.locator(".hosts-list");
  const openMenu = async () => {
    const box = (await list.boundingBox())!;
    await list.click({ button: "right", position: { x: box.width - 8, y: box.height - 8 } });
  };
  await openMenu();
  const menu = page.getByRole("menu", { name: "服务器列表操作", exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "添加服务器", exact: true })).toBeFocused();
  await expect(menu.getByRole("menuitem", { name: "清除筛选", exact: true })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "删除服务器", exact: true })).toHaveCount(0);
  const box = (await menu.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(1280);
  expect(box.y + box.height).toBeLessThanOrEqual(820);
  await page.screenshot({ path: ".test-artifacts/vue-host-list-context-menu.png", animations: "disabled" });
  const calls = await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "list_hosts").length);
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "刷新服务器列表", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "list_hosts").length)).toBe(calls + 1);
  await openMenu();
  await page.keyboard.press("Escape");
  const region = page.getByRole("region", { name: "服务器", exact: true });
  await expect(menu).toHaveCount(0);
  await expect(region).toBeFocused();
  await region.press("Shift+F10");
  await expect(menu).toBeVisible();
  await page.getByLabel("搜索服务器", { exact: true }).click();
  await expect(menu).toHaveCount(0);
  await openMenu();
  await page.getByLabel("搜索服务器", { exact: true }).click({ button: "right" });
  await expect(menu).toHaveCount(0);
  await page.keyboard.press("Escape");
  await openMenu();
  await menu.getByRole("menuitem", { name: "添加服务器", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "添加服务器", exact: true })).toBeVisible();
  await expect(menu).toHaveCount(0);
});

test("blank-space menus clear active filters and remain distinct from card menus and empty lists", async ({ page }) => {
  await desktopFixture(page, false, false, true);
  await page.goto("/");
  await page.getByLabel("服务器分组", { exact: true }).selectOption({ label: "生产" });
  await page.getByLabel("搜索服务器", { exact: true }).fill("不存在的服务器");
  await expect(page.locator(".host-card")).toHaveCount(0);
  const list = page.locator(".hosts-list");
  const openMenu = async () => {
    const box = (await list.boundingBox())!;
    await list.click({ button: "right", position: { x: 12, y: box.height - 8 } });
  };
  await openMenu();
  const menu = page.getByRole("menu", { name: "服务器列表操作", exact: true });
  await menu.getByRole("menuitem", { name: "清除筛选", exact: true }).click();
  await expect(page.getByLabel("搜索服务器", { exact: true })).toHaveValue("");
  await expect(page.locator(".host-card")).toHaveCount(7);
  await openMenu();
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).click({ button: "right" });
  await expect(menu).toHaveCount(0);
  const cardMenu = page.getByRole("menu", { name: "服务器操作", exact: true });
  await expect(cardMenu.getByRole("menuitem", { name: "删除服务器", exact: true })).toBeVisible();
  await expect(cardMenu.getByRole("menuitem", { name: "添加服务器", exact: true })).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem("qa-hosts", "[]"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "添加第一台服务器", exact: true })).toBeVisible();
  await page.getByRole("heading", { name: "添加第一台服务器", exact: true }).click({ button: "right" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "添加服务器", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "添加服务器", exact: true })).toBeVisible();
});

test("the edit shortcut opens a unique connection-settings tab and saving keeps it open", async ({ page }) => {
  await desktopFixture(page, false, false, true);
  await page.goto("/");
  const card = page.getByRole("group", { name: "服务器 生产 API", exact: true });
  await openHostSettings(card);
  const tab = page.getByRole("tab", { name: "生产 API · 连接设置", exact: true });
  const panel = page.getByRole("tabpanel", { name: "生产 API · 连接设置", exact: true });
  expect(await panel.count()).toBe(1);
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByLabel("主机地址", { exact: true })).toHaveValue("ubuntu.example.internal");
  await expect(page.locator(".arco-drawer, .host-editor-slot")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "connect_host").length)).toBe(0);
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await openHostSettings(card);
  await expect(tab).toHaveCount(1);
  await panel.getByLabel("服务器名称", { exact: true }).fill("生产 API 已修改");
  await panel.getByRole("button", { name: "保存服务器", exact: true }).click();
  const updated = page.getByRole("tabpanel", { name: "生产 API 已修改 · 连接设置", exact: true });
  await expect(updated).toBeVisible();
  await expect(updated.getByRole("status")).toContainText("连接设置已保存");
  await expect(updated.getByLabel("密码", { exact: true })).toHaveValue("qa-saved-password");
  await page.screenshot({ path: ".test-artifacts/vue-host-settings-tab.png", animations: "disabled" });
  await page.getByRole("button", { name: "关闭 生产 API 已修改 · 连接设置", exact: true }).click();
  await expect(page.getByRole("region", { name: "服务器", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "服务器 生产 API 已修改", exact: true })).toBeVisible();
});

test("connection-settings tabs retain independent drafts and share navigation with settings and terminals", async ({ page }) => {
  await desktopFixture(page, false, false, true);
  await page.goto("/");
  const panel = page.getByRole("tabpanel", { name: "测试服务器 · 连接设置", exact: true });
  await openHostSettings(page.getByRole("group", { name: "服务器 测试服务器", exact: true }));
  await panel.getByLabel("服务器名称", { exact: true }).fill("尚未保存的名称");
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await openHostSettings(page.getByRole("group", { name: "服务器 生产 API", exact: true }));
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("tab", { name: "设置", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "测试服务器 · 连接设置", exact: true }).click();
  await expect(panel.getByLabel("服务器名称", { exact: true })).toHaveValue("尚未保存的名称");
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
  await expect(page.getByRole("tab", { name: "测试服务器", exact: true })).toBeVisible();
  const config = page.getByRole("tab", { name: "测试服务器 · 连接设置", exact: true });
  await config.click();
  await expect(panel.getByLabel("服务器名称", { exact: true })).toHaveValue("尚未保存的名称");
  await config.press("End");
  await expect(page.getByRole("tab", { name: "设置", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "生产 API · 连接设置", exact: true })).toBeFocused();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("tab", { name: "生产 API · 连接设置", exact: true })).toHaveCount(0);
  await expect(config).toBeFocused();
  await page.getByRole("button", { name: "关闭连接 测试服务器", exact: true }).click();
  await expect(config).toBeVisible();
  await expect(panel).toBeVisible();
});

test("connection settings fit laptop and narrow viewports without covering the server list", async ({ page }) => {
  await desktopFixture(page, false, false, true);
  await page.goto("/");
  await openHostSettings(page.getByRole("group", { name: "服务器 生产 API", exact: true }));
  const panel = page.getByRole("tabpanel", { name: "生产 API · 连接设置", exact: true });
  for (const width of [1440, 1280, 960, 800, 560]) {
    await page.setViewportSize({ width, height: 820 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(panel.getByLabel("服务器名称", { exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "保存服务器", exact: true })).toBeVisible();
    await page.screenshot({ path: `.test-artifacts/vue-host-settings-${width}.png`, animations: "disabled" });
  }
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator(".host-card")).toHaveCount(7);
});

test("connection settings show all password fields at the default size and keep actions visible in smaller windows", async ({ page }) => {
  await desktopFixture(page);
  await page.setViewportSize({ width: 1080, height: 700 });
  await page.goto("/");
  await openHostSettings(page.getByRole("group", { name: "服务器 测试服务器", exact: true }));
  const panel = page.getByRole("tabpanel", { name: "测试服务器 · 连接设置", exact: true });
  const fields = panel.locator(".host-editor-fields");
  const save = panel.getByRole("button", { name: "保存服务器", exact: true });
  const close = panel.getByRole("button", { name: "关闭标签页", exact: true });
  for (const height of [700, 672]) {
    await page.setViewportSize({ width: 1080, height });
    await expect(save).toBeInViewport({ ratio: 1 });
    await expect(close).toBeInViewport({ ratio: 1 });
    expect(await fields.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  }
  await page.screenshot({ path: ".test-artifacts/vue-host-settings-default-size.png", animations: "disabled" });
  await page.setViewportSize({ width: 800, height: 560 });
  await panel.getByLabel("认证方式").selectOption("privateKey");
  for (const position of [0, 10000]) {
    await fields.evaluate((element, top) => { element.scrollTop = top; }, position);
    await expect(save).toBeInViewport({ ratio: 1 });
    await expect(close).toBeInViewport({ ratio: 1 });
    const actions = (await panel.locator(".modal-actions").boundingBox())!;
    const status = (await page.locator(".statusbar").boundingBox())!;
    expect(actions.y + actions.height).toBeLessThanOrEqual(status.y);
  }
  await page.screenshot({ path: ".test-artifacts/vue-host-settings-small-size.png", animations: "disabled" });
  await close.click();
  await expect(page.getByRole("region", { name: "服务器", exact: true })).toBeVisible();
});

test("an earlier save updates its own tab without interrupting another settings tab", async ({ page }) => {
  await desktopFixture(page, false, false, true);
  await page.goto("/");
  await page.evaluate(() => {
    const qa = (window as any).__qa, original = qa.invoke;
    qa.invoke = async (command: string, args: any) => {
      if (command === "save_host") await new Promise(resolve => { qa.finishSave = resolve; });
      return original(command, args);
    };
  });
  await openHostSettings(page.getByRole("group", { name: "服务器 测试服务器", exact: true }));
  const first = page.getByRole("tabpanel", { name: "测试服务器 · 连接设置", exact: true });
  await first.getByLabel("服务器名称", { exact: true }).fill("已保存的服务器");
  await first.getByRole("button", { name: "保存服务器", exact: true }).click();
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await openHostSettings(page.getByRole("group", { name: "服务器 生产 API", exact: true }));
  const second = page.getByRole("tabpanel", { name: "生产 API · 连接设置", exact: true });
  await page.evaluate(() => (window as any).__qa.finishSave());
  await expect(page.getByRole("tab", { name: "已保存的服务器 · 连接设置", exact: true })).toBeVisible();
  await expect(second).toBeVisible();
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await page.getByRole("group", { name: "服务器 已保存的服务器", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "删除服务器", exact: true }).click();
  await expect(page.getByRole("tab", { name: "已保存的服务器 · 连接设置", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "生产 API · 连接设置", exact: true })).toBeVisible();
});

test("saved passwords are masked, can be revealed, and reset when reopening or switching authentication", async ({ page }) => {
  await desktopFixture(page);
  await page.goto("/");
  const card = page.getByRole("group", { name: "服务器 测试服务器", exact: true });
  const panel = page.getByRole("tabpanel", { name: "测试服务器 · 连接设置", exact: true });
  await openHostSettings(card);
  const password = panel.getByLabel("密码", { exact: true });
  await expect(password).toHaveValue("qa-saved-password");
  await expect(password).toHaveAttribute("type", "password");
  await panel.getByRole("button", { name: "显示密码", exact: true }).click();
  await expect(password).toHaveAttribute("type", "text");
  await panel.getByLabel("认证方式").selectOption("privateKey");
  const passphrase = panel.getByLabel("私钥口令", { exact: true });
  await expect(passphrase).toHaveValue("");
  await expect(passphrase).toHaveAttribute("type", "password");
  await panel.getByLabel("认证方式").selectOption("password");
  await expect(password).toHaveValue("qa-saved-password");
  await panel.getByRole("button", { name: "显示密码", exact: true }).click();
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await openHostSettings(card);
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "关闭 测试服务器 · 连接设置", exact: true }).click();
  await openHostSettings(card);
  await expect(password).toHaveValue("qa-saved-password");
  await expect(password).toHaveAttribute("type", "password");
});

test("late credential responses cannot overwrite another authentication method", async ({ page }) => {
  await desktopFixture(page);
  await page.goto("/");
  await page.evaluate(() => {
    const qa = (window as any).__qa, original = qa.invoke;
    qa.invoke = (command: string, args: any) => command === "get_host_password"
      ? new Promise(resolve => { qa.resolvePassword = resolve; }) : original(command, args);
  });
  await openHostSettings(page.getByRole("group", { name: "服务器 测试服务器", exact: true }));
  const panel = page.getByRole("tabpanel", { name: "测试服务器 · 连接设置", exact: true });
  await expect(panel.getByLabel("密码", { exact: true })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "保存服务器", exact: true })).toBeDisabled();
  await panel.getByLabel("认证方式").selectOption("privateKey");
  const password = panel.getByLabel("私钥口令", { exact: true });
  await password.fill("new-key-passphrase");
  await page.evaluate(() => (window as any).__qa.resolvePassword("old-password"));
  await expect(password).toHaveValue("new-key-passphrase");
});

test("double-click and Enter open the terminal without extra settings tabs or duplicate connections", async ({ page }) => {
  await desktopFixture(page);
  await page.goto("/");
  const card = page.getByRole("group", { name: "服务器 测试服务器", exact: true });
  await card.dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
  await expect(page.locator(".host-settings-tab")).toHaveCount(0);
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await card.dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await card.focus();
  await card.press("Enter");
  await expect(page.locator(".xterm")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "connect_host").length)).toBe(1);
});

test("system avatars use detected OS metadata, preserve cached detection and do not guess from host names", async ({ page }, info) => {
  await desktopFixture(page, false, false, true);
  await page.goto("/");
  for (const [name, system, label] of [
    ["生产 API", "ubuntu", "Ubuntu 24.04"],
    ["数据库", "debian", "Debian 12"],
    ["测试环境", "rocky", "Rocky Linux 9.5"],
    ["Windows 构建机", "windows", "Windows"],
    ["macOS 构建机", "macos", "macOS 15.0"],
  ]) {
    const avatar = page.getByRole("group", { name: `服务器 ${name}`, exact: true }).locator(".server-avatar");
    await expect(avatar).toHaveAttribute("data-system", system);
    await expect(avatar.getByRole("img", { name: label, exact: true })).toBeVisible();
    await expect(avatar.locator(".system-icon svg path")).toHaveAttribute("d", /M/);
  }
  const card = page.getByRole("group", { name: "服务器 测试服务器", exact: true });
  await expect(card.locator(".server-avatar")).toHaveAttribute("data-system", "server");
  await card.dblclick();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("qa-hosts") || "[]")[0]?.remoteSystem?.id)).toBe("ubuntu");
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await expect(card.locator(".server-avatar")).toHaveAttribute("data-system", "ubuntu");
  await page.screenshot({ path: info.outputPath("system-avatars.png"), animations: "disabled" });
  await page.reload();
  await expect(card.getByRole("img", { name: "Ubuntu 24.04", exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__qa.detectFailure = true);
  await card.dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await expect(card.locator(".server-avatar")).toHaveAttribute("data-system", "ubuntu");
  await page.evaluate(() => {
    const hosts = JSON.parse(localStorage.getItem("qa-hosts") || "[]");
    hosts[0].name = "Windows Ubuntu 都只是自定义名称";
    hosts[0].remoteSystem = null;
    hosts[1].remoteSystem = { id: "ctyunos", name: "ctyunos", version: "2.0.1" };
    localStorage.setItem("qa-hosts", JSON.stringify(hosts));
  });
  await page.reload();
  await expect(page.getByRole("group", { name: "服务器 Windows Ubuntu 都只是自定义名称", exact: true }).locator(".server-avatar")).toHaveAttribute("data-system", "server");
  await expect(page.getByRole("group", { name: "服务器 生产 API", exact: true }).locator(".server-avatar")).toHaveAttribute("data-system", "linux");
});

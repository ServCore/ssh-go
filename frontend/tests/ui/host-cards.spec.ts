import { expect, test } from "@playwright/test";
import { desktopFixture } from "./fixtures/desktop";

test("servers use independent cards in a responsive grid and retain search", async ({
  page,
}) => {
  await desktopFixture(page, false, false, true);
  await page.goto("/");
  const cards = page.locator(".host-card");
  await expect(cards).toHaveCount(7);
  await expect(
    page.locator(".host-row, .host-list-header, .host-inspector"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "连接详情", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".host-grid")).toHaveCSS("display", "grid");
  await expect(page.locator(".workspace-navigation")).toHaveCount(0);
  await expect(page.getByText("已打开的连接", { exact: true })).toHaveCount(0);
  const first = await cards.nth(0).boundingBox(),
    second = await cards.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second!.x).toBeGreaterThan(first!.x + first!.width);
  expect(second!.y).toBe(first!.y);
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

test("connection details open from the right, contain focus, close and edit", async ({
  page,
}) => {
  await desktopFixture(page, false, false, true);
  await page.goto("/");
  const card = page.getByRole("group", {
    name: "服务器 生产 API",
    exact: true,
  });
  await card.click();
  await expect(page.getByRole("dialog", { name: "连接详情", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "connect_host").length)).toBe(0);
  const details = card.getByRole("button", { name: "查看详情 生产 API", exact: true });
  await details.focus();
  await details.press("Enter");
  const drawer = page.getByRole("dialog", { name: "连接详情", exact: true });
  const close = drawer.getByRole("button", {
    name: "关闭连接详情",
    exact: true,
  });
  await expect(
    drawer.getByRole("heading", { name: "生产 API", exact: true }),
  ).toBeVisible();
  await expect(drawer).toContainText("ubuntu.example.internal:22");
  await expect(drawer).toContainText("Ubuntu 24.04");
  await expect(close).toBeFocused();
  await expect
    .poll(async () => {
      const box = await drawer.locator(".arco-drawer").boundingBox();
      return box ? Math.round(box.x + box.width) : 0;
    })
    .toBe(1280);
  expect((await drawer.locator(".arco-drawer").boundingBox())!.width).toBe(420);
  await drawer.getByRole("button", { name: "打开终端", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.screenshot({
    path: ".test-artifacts/vue-host-details-drawer.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(details).toBeFocused();
  await details.click();
  await expect(drawer).toBeVisible();
  await drawer
    .locator(".arco-drawer-mask")
    .click({ position: { x: 50, y: 100 } });
  await expect(drawer).toHaveCount(0);
  await details.click();
  await drawer.getByRole("button", { name: "编辑连接", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  const editor = page.getByRole("dialog", { name: "编辑服务器", exact: true });
  await expect(
    editor.getByRole("textbox", { name: "服务器名称", exact: true }),
  ).toHaveValue("生产 API");
  await expect(
    editor.getByRole("textbox", { name: "服务器名称", exact: true }),
  ).toBeFocused();
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(await page.locator("#root").evaluate((root) => root.inert)).toBe(
    false,
  );
});

test("double-click and Enter open the terminal without details or duplicate connections", async ({ page }) => {
  await desktopFixture(page);
  await page.goto("/");
  const card = page.getByRole("group", { name: "服务器 测试服务器", exact: true });
  const drawer = page.getByRole("dialog", { name: "连接详情", exact: true });
  await card.dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
  await expect(drawer).toHaveCount(0);
  await page.getByRole("button", { name: "监控", exact: true }).click();
  await expect(page.getByRole("region", { name: "服务器监控", exact: true })).toContainText("37.5%");
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await card.dblclick();
  await expect(page.getByRole("button", { name: "终端", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".xterm")).toBeVisible();
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await card.focus();
  await card.press("Enter");
  await expect(page.locator(".xterm")).toBeVisible();
  await expect(drawer).toHaveCount(0);
  await page.getByRole("button", { name: "返回服务器", exact: true }).click();
  await card.getByRole("button", { name: "查看详情 测试服务器", exact: true }).click();
  await expect(drawer).toContainText("已连接");
  await drawer.getByRole("button", { name: "打开终端", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.locator(".xterm")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "connect_host").length)).toBe(1);
  await expect(page.locator(".session-workspace")).toHaveCount(1);
  expect(await page.locator("#root").evaluate(root => root.inert)).toBe(false);
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

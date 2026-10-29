import { selectSession } from "./fixtures/navigation";
import { expect, test, type Page } from "@playwright/test";
import { desktopFixture } from "./fixtures/desktop";

async function connect(page: Page) {
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
}
const monitor = (page: Page) => page.getByRole("region", { name: "服务器监控", exact: true });
const calls = (page: Page) => page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "get_server_metrics").length);

test("monitor samples on demand, calculates after baseline, pauses offscreen, and retains history", async ({ page }, info) => {
  await desktopFixture(page);
  await page.clock.install();
  await page.goto("/");
  await connect(page);
  expect(await calls(page)).toBe(0);
  await page.getByRole("button", { name: "监控", exact: true }).click();
  const panel = monitor(page);
  await expect(panel).toContainText("等待下一次采样");
  await expect(panel).toContainText("37.5%");
  await expect(panel).toContainText("2 天 3 小时 47 分钟");
  await expect(panel.getByRole("meter", { name: "/data 使用率", exact: true })).toHaveAttribute("aria-valuenow", "92.9");
  await page.clock.fastForward(3100);
  await expect(panel).toContainText("17.6%");
  await expect(panel).toContainText("2.4 MB/s");
  await expect(panel.getByRole("img", { name: "CPU 使用率 17.6%", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "内存", exact: true }).click();
  await expect(panel.getByRole("img", { name: "最近 5 分钟内存使用率趋势" })).toBeVisible();
  await panel.getByRole("button", { name: "CPU", exact: true }).click();
  await expect(panel.getByRole("img", { name: "最近 5 分钟 CPU 使用率趋势" })).toBeVisible();
  await page.clock.fastForward(3100);
  await expect(panel.getByRole("img", { name: "最近 5 分钟 CPU 使用率趋势" }).locator(".chart-line").first()).toHaveAttribute("d", /L/);
  await page.screenshot({ path: info.outputPath("monitor-light.png"), fullPage: true });
  await page.keyboard.press("Meta+,");
  await page.getByLabel("外观模式", { exact: true }).selectOption("dark");
  await selectSession(page, "测试服务器");
  await expect(page.locator("body")).toHaveAttribute("arco-theme", "dark");
  await page.screenshot({ path: info.outputPath("monitor-dark.png"), fullPage: true });
  await page.getByRole("button", { name: "终端", exact: true }).click();
  await expect(page.locator(".xterm")).toBeVisible();
  const count = await calls(page);
  await page.clock.fastForward(10000);
  expect(await calls(page)).toBe(count);
  await page.getByRole("button", { name: "监控", exact: true }).click();
  await expect(panel).toContainText("17.6%");
  await expect.poll(() => calls(page)).toBe(count + 1);
  await page.getByRole("button", { name: "暂停采集", exact: true }).click();
  await expect(page.getByRole("group", { name: "监控采集控制" })).toContainText("已暂停");
  const paused = await calls(page);
  await page.clock.fastForward(10000);
  expect(await calls(page)).toBe(paused);
  await page.getByRole("button", { name: "继续采集", exact: true }).click();
  await expect.poll(() => calls(page)).toBe(paused + 1);
});

test("disconnect stops sampling, preserves last data, and reconnect starts a fresh monitor", async ({ page }) => {
  await desktopFixture(page); await page.clock.install(); await page.goto("/"); await connect(page);
  await page.getByRole("button", { name: "监控", exact: true }).click();
  await expect(monitor(page)).toContainText("37.5%");
  await page.evaluate(() => (window as any).__qa.emit("session-closed", { sessionId: "qa-session-1", reason: "连接中断" }));
  await expect(monitor(page)).toContainText("SSH 连接已断开");
  await expect(monitor(page).getByRole("article", { name: "系统负载", exact: true })).toContainText("状态待确认");
  await expect(monitor(page).getByRole("img", { name: "内存使用率 37.5%", exact: true })).toHaveClass(/unavailable/);
  await expect(page.getByRole("button", { name: "刷新监控" })).toBeDisabled();
  const count = await calls(page); await page.clock.fastForward(10000); expect(await calls(page)).toBe(count);
  await page.getByRole("button", { name: "重新连接", exact: true }).click();
  await expect(page.getByRole("button", { name: "监控", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(monitor(page)).toBeVisible();
  await expect(monitor(page)).toContainText("等待下一次采样");
  expect(await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "get_server_metrics").at(-1).args.sessionId)).toBe("qa-session-2");
});

test("unsupported systems show an explanation and stop automatic retries", async ({ page }) => {
  await desktopFixture(page); await page.clock.install(); await page.goto("/"); await connect(page);
  await page.evaluate(() => (window as any).__qa.monitorError = { code: "monitor_unsupported", message: "实时监控暂仅支持 Linux 服务器" });
  await page.getByRole("button", { name: "监控", exact: true }).click();
  await expect(monitor(page).getByRole("alert")).toContainText("仅支持 Linux");
  const count = await calls(page); await page.clock.fastForward(10000); expect(await calls(page)).toBe(count);
  await page.evaluate(() => (window as any).__qa.monitorError = null);
  await page.getByRole("button", { name: "刷新监控" }).click();
  await expect(monitor(page)).toContainText("37.5%");
});

test("failed refresh marks old data and recovers without hiding the terminal", async ({ page }) => {
  await desktopFixture(page); await page.clock.install(); await page.goto("/"); await connect(page);
  await page.getByRole("button", { name: "监控", exact: true }).click();
  await expect(monitor(page)).toContainText("37.5%");
  await page.evaluate(() => (window as any).__qa.monitorError = { code: "monitor_timeout", message: "监控采样超时" });
  await page.clock.fastForward(3100);
  await expect(monitor(page).getByRole("alert")).toContainText("上次成功采样");
  await expect(monitor(page)).toContainText("37.5%");
  await expect(monitor(page).getByRole("article", { name: "系统负载", exact: true })).toHaveClass(/unavailable/);
  await page.evaluate(() => (window as any).__qa.monitorError = null);
  await page.getByRole("button", { name: "刷新监控" }).click();
  await expect(monitor(page).getByRole("alert")).toHaveCount(0);
  await expect(monitor(page).getByRole("img", { name: "内存使用率 37.5%", exact: true })).toHaveClass(/normal/);
  await page.getByRole("button", { name: "终端", exact: true }).click();
  await expect(page.locator(".xterm")).toBeVisible();
});

test("a late sample after disconnect is ignored and no overlapping probes are sent", async ({ page }) => {
  await desktopFixture(page); await page.clock.install(); await page.goto("/"); await connect(page);
  await page.evaluate(() => (window as any).__qa.pauseMonitor = true);
  await page.getByRole("button", { name: "监控", exact: true }).click();
  await expect(monitor(page)).toContainText("正在读取服务器状态");
  await expect.poll(() => calls(page)).toBe(1);
  await page.clock.fastForward(10000); expect(await calls(page)).toBe(1);
  await page.evaluate(() => {
    (window as any).__qa.emit("session-closed", { sessionId: "qa-session-1", reason: "连接中断" });
    (window as any).__qa.finishMonitor();
  });
  await expect(monitor(page)).toContainText("暂无监控数据");
  await expect(monitor(page)).not.toContainText("37.5%");
  await page.clock.fastForward(10000); expect(await calls(page)).toBe(1);
});

test("monitor fits a small laptop and a narrow viewport without page overflow", async ({ page }, info) => {
  await desktopFixture(page); await page.goto("/"); await connect(page);
  await page.getByRole("button", { name: "监控", exact: true }).click();
  await expect(monitor(page)).toContainText("37.5%");
  for (const width of [1280, 1024, 640, 480]) {
    await page.setViewportSize({ width, height: 700 });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const bounds = await monitor(page).boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(width);
    expect(await monitor(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(monitor(page).getByRole("heading", { name: "服务器概览" })).toHaveCount(0);
    const cards = await monitor(page).getByRole("region", { name: "实时资源状态" }).boundingBox();
    expect(cards!.y - bounds!.y).toBeLessThanOrEqual(16);
    const controls = page.getByRole("banner", { name: "工作区导航" }).getByRole("group", { name: "监控采集控制" });
    const before = (await controls.boundingBox())!;
    await expect(monitor(page).getByRole("group", { name: "监控采集控制" })).toHaveCount(0);
    expect(before.y + before.height).toBeLessThanOrEqual(bounds!.y);
    expect(before.x).toBeGreaterThanOrEqual(bounds!.x);
    expect(before.x + before.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
    await page.screenshot({ path: info.outputPath(`monitor-${width}.png`), fullPage: true });
    await monitor(page).locator(".monitor-scroll").evaluate(el => el.scrollTop = el.scrollHeight);
    const after = (await controls.boundingBox())!;
    expect(after.y).toBeCloseTo(before.y, 0);
    const footer = (await monitor(page).locator(".monitor-footer").boundingBox())!;
    expect(footer.y + footer.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
    await monitor(page).locator(".monitor-scroll").evaluate(el => el.scrollTop = 0);
  }
});


test("chart inspection exposes paired rates and keyboard navigation across samples", async ({ page }) => {
  await desktopFixture(page); await page.clock.install(); await page.goto("/"); await connect(page);
  await page.getByRole("button", { name: "监控", exact: true }).click();
  await expect(monitor(page)).toContainText("等待下一次采样");
  await page.clock.fastForward(3100);
  const network = monitor(page).getByRole("article", { name: "网络速率" });
  const chart = network.getByRole("img", { name: "最近 5 分钟网络接收与发送速率趋势" });
  await chart.focus();
  const tooltip = network.getByRole("status");
  await expect(tooltip).toContainText("下行");
  await expect(tooltip).toContainText("2.4 MB/s");
  await expect(tooltip).toContainText("上行");
  await expect(tooltip).toContainText("384 KB/s");
  await chart.press("Home");
  await expect(tooltip).toContainText("等待采样");
  await chart.press("ArrowRight");
  await expect(tooltip).toContainText("2.4 MB/s");
  await chart.press("Escape");
  await expect(tooltip).toHaveCount(0);
  const cpu = monitor(page).getByRole("img", { name: "最近 5 分钟 CPU 使用率趋势" });
  await cpu.focus();
  await expect(monitor(page).getByRole("article", { name: "资源趋势" }).getByRole("status")).toContainText("17.6%");
});

// Supply resource pressure independently of IPC timing and SSH connection state.
async function healthFixture(page: Page) {
  await desktopFixture(page);
  await page.addInitScript(() => {
    const qa = (window as any).__qa, invoke = qa.invoke;
    qa.healthSample = { cpuPercent: 18.4 };
    qa.invoke = async (command: string, args: any) => {
      const result = await invoke(command, args);
      if (command !== "get_server_metrics") return result;
      return { ...result, disks: result.disks.map((disk: any) => ({ ...disk, usedPercent: 38.9 })), ...qa.healthSample };
    };
  });
  await page.clock.install();
  await page.goto("/");
  await connect(page);
  await page.getByRole("button", { name: "监控", exact: true }).click();
}

test("resource mood follows actual pressure, includes non-root disks, and keeps paused readings neutral", async ({ page }, info) => {
  await healthFixture(page);
  const panel = monitor(page), summary = panel.getByRole("article", { name: "系统负载", exact: true });
  await expect(summary).toContainText("负载正常");
  await expect(summary).toContainText("当前未发现资源压力");
  await page.keyboard.press("Meta+,");
  await page.getByLabel("外观模式", { exact: true }).selectOption("dark");
  await selectSession(page, "测试服务器");
  await expect(summary).toContainText("负载正常");
  await expect(panel.getByRole("img", { name: "内存使用率 37.5%", exact: true })).toHaveCSS("color", "rgb(76, 231, 172)");
  await page.screenshot({ path: info.outputPath("mood-healthy-dark.png"), animations: "disabled" });

  await page.evaluate(() => { (window as any).__qa.healthSample.memoryUsed = 8 * 1024 ** 3 * .84; });
  await page.clock.fastForward(3100);
  await expect(summary).toContainText("内存使用率偏高");
  await expect(summary).toContainText("内存 · 使用率 84.0%");
  await expect(panel.getByRole("img", { name: "内存使用率 84.0%", exact: true })).toHaveClass(/elevated/);
  await expect(panel.getByRole("article", { name: "内存使用量", exact: true })).toContainText("使用率偏高");
  await page.screenshot({ path: info.outputPath("mood-attention-dark.png"), animations: "disabled" });

  await page.evaluate(() => { (window as any).__qa.healthSample = { cpuPercent: 93.2 }; });
  await page.clock.fastForward(3100);
  await expect(summary).toContainText("CPU使用率很高");
  await expect(summary).toContainText("CPU · 使用率 93.2%");
  await expect(panel.getByRole("img", { name: "CPU 使用率 93.2%", exact: true })).toHaveClass(/high/);
  await expect(panel.getByRole("img", { name: "内存使用率 37.5%", exact: true })).toHaveClass(/normal/);
  await page.screenshot({ path: info.outputPath("mood-pressure-dark.png"), animations: "disabled" });

  await page.evaluate(() => {
    (window as any).__qa.healthSample = { cpuPercent: 12, disks: [
      { filesystem: "/dev/sda1", mount: "/", total: 100, used: 20, available: 80, usedPercent: 20 },
      { filesystem: "/dev/sdb1", mount: "/data", total: 100, used: 94.2, available: 5.8, usedPercent: 94.2 },
    ] };
  });
  await page.clock.fastForward(3100);
  await expect(summary).toContainText("/data 分区 · 已用 94.2%");
  await expect(summary).toHaveClass(/normal/);
  await expect(summary.locator(".load-status")).toHaveText("负载正常");
  await expect(summary.getByRole("status", { name: "资源提示", exact: true })).toHaveClass(/high/);
  await expect(panel.getByRole("img", { name: "CPU 使用率 12.0%", exact: true })).toHaveClass(/normal/);
  await page.getByRole("button", { name: "暂停采集", exact: true }).click();
  await expect(summary).toContainText("状态待确认");
  await expect(summary).toContainText("采集已暂停");
  await expect(panel.getByRole("img", { name: "CPU 使用率 12.0%", exact: true })).toHaveClass(/unavailable/);
  await page.screenshot({ path: info.outputPath("mood-paused-dark.png"), animations: "disabled" });
  await page.getByRole("button", { name: "继续采集", exact: true }).click();
  await expect(summary).toContainText("分区空间紧张");
  await page.evaluate(() => { (window as any).__qa.healthSample = { cpuPercent: 18.4, load: [4.8, 4.2, 3.7] }; });
  await page.clock.fastForward(3100);
  await expect(summary).toHaveClass(/high/);
  await expect(summary.locator(".load-status")).toHaveText("负载较高");
  await expect(summary.locator(".load-copy > strong")).toContainText("4.80");
});

test("a stalled sample expires without losing history and missing metrics never imply healthy resources", async ({ page }) => {
  await healthFixture(page);
  const panel = monitor(page), summary = panel.getByRole("article", { name: "系统负载", exact: true });
  await expect(summary).toContainText("负载正常");
  await page.evaluate(() => { (window as any).__qa.pauseMonitor = true; });
  await page.clock.fastForward(16000);
  await expect(summary).toContainText("状态待确认");
  await expect(summary).toContainText("数据已过期");
  await expect(panel.getByRole("img", { name: "CPU 使用率 18.4%", exact: true })).toHaveClass(/unavailable/);
  expect(await calls(page)).toBe(2);
  await page.evaluate(() => { const qa = (window as any).__qa; qa.pauseMonitor = false; qa.healthSample = { cpuPercent: null }; qa.finishMonitor(); });
  await expect(summary).toContainText("正在采样");
  await expect(summary).toContainText("等待CPU采样");
  await page.evaluate(() => { (window as any).__qa.healthSample = { cpuPercent: 18.4, memoryTotal: 0 }; });
  await page.clock.fastForward(3100);
  await expect(summary).toContainText("等待内存采样");
  await expect(panel.getByRole("img", { name: "内存使用率 等待采样", exact: true })).toHaveClass(/unavailable/);
  await page.evaluate(() => { (window as any).__qa.healthSample = { cpuPercent: 18.4 }; });
  await page.clock.fastForward(3100);
  await expect(summary).toContainText("负载正常");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await summary.locator(".load-dot").evaluate(el => getComputedStyle(el, "::after").animationName)).toBe("none");
});


test("a partition space reminder leaves healthy system load calm and identifies the exact affected partition", async ({ page }, info) => {
  await healthFixture(page);
  await page.evaluate(() => {
    const gb = 1024 ** 3;
    (window as any).__qa.healthSample = {
      cpuPercent: 3.8, cpuCores: 8, load: [0.48, 0.42, 0.39],
      memoryTotal: 32 * gb, memoryUsed: 7.8 * gb,
      disks: [
        { filesystem: "/dev/sda1", mount: "/", total: 40 * gb, used: 18.96 * gb, available: 21.04 * gb, usedPercent: 47.4 },
        { filesystem: "/dev/sdb1", mount: "/data", total: 100 * gb, used: 82.6 * gb, available: 17.4 * gb, usedPercent: 82.6 },
      ],
    };
  });
  await page.clock.fastForward(3100);
  const summary = monitor(page).getByRole("article", { name: "系统负载", exact: true });
  await expect(summary).toHaveClass(/normal/);
  await expect(summary.locator(".load-status")).toHaveText("负载正常");
  await expect(summary.locator(".load-copy > strong")).toContainText("0.48");
  await expect(summary.getByRole("img", { name: "负载占核心数比例 6.0%", exact: true })).toHaveClass(/normal/);
  const reminder = summary.getByRole("status", { name: "资源提示", exact: true });
  await expect(reminder).toHaveClass(/elevated/);
  await expect(reminder).toContainText("分区空间提醒");
  await expect(reminder).toContainText("/data 分区 · 已用 82.6% · 可用 17.4 GB");
  await expect(summary).not.toContainText("需要关注");
  await expect(monitor(page).getByRole("img", { name: "根分区使用率 47.4%", exact: true })).toHaveClass(/normal/);
  await page.setViewportSize({ width: 1080, height: 700 });
  await page.clock.runFor(50);
  await page.screenshot({ path: info.outputPath("partition-reminder-light.png"), animations: "disabled" });
  await summary.screenshot({ path: info.outputPath("load-card-partition-reminder.png"), animations: "disabled" });
  await page.keyboard.press("Meta+,");
  await page.getByLabel("外观模式", { exact: true }).selectOption("dark");
  await selectSession(page, "测试服务器");
  await expect(summary.locator(".load-status")).toHaveText("负载正常");
  await page.screenshot({ path: info.outputPath("partition-reminder-dark.png"), animations: "disabled" });
});

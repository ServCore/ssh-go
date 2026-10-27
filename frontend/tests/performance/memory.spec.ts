import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { desktopFixture } from "../ui/fixtures/desktop";

// Production assets and deterministic IPC snapshots isolate frontend retention.
// CDP numbers describe Chromium's JS heap, not the native app's total memory.
test("profile idle, large directories, and released session", async ({ page }) => {
  test.slow();
  const count = 100_000;
  await desktopFixture(page);
  await page.addInitScript((count) => {
    const qa = (window as any).__qa;
    const invoke = qa.invoke;
    qa.invoke = (command: string, args: any) => {
      if (command !== "list_files") return invoke(command, args);
      qa.calls.push({ command, args: structuredClone(args) });
      return Promise.resolve(
        Array.from({ length: count }, (_, index) => ({
          name: `item-${String(index).padStart(6, "0")}.txt`,
          path: `${args.path}/item-${String(index).padStart(6, "0")}.txt`,
          kind: "file",
          size: index,
          modified: 1700000000,
        })),
      );
    };
  }, count);
  const cdp = await page.context().newCDPSession(page);
  const samples: Record<string, { jsHeapBytes: number; backingStorageBytes?: number; documents: number; nodes: number; jsEventListeners: number }> = {};
  async function sample(name: string) {
    await page.evaluate(() => new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    ));
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.collectGarbage");
    const { usedSize, backingStorageSize } = await cdp.send("Runtime.getHeapUsage");
    samples[name] = {
      jsHeapBytes: usedSize,
      backingStorageBytes: backingStorageSize,
      ...await cdp.send("Memory.getDOMCounters"),
    };
  }
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "服务器", exact: true })).toBeVisible();
  await sample("idle");
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
  await sample("terminal");
  await page.getByRole("button", { name: "SFTP", exact: true }).click();
  await expect(page.getByRole("table")).toHaveCount(2);
  for (const table of await page.getByRole("table").all()) {
    await expect(table).toHaveAttribute("aria-rowcount", String(count + 1));
    expect(await table.getByRole("row").count()).toBeLessThan(100);
  }
  await sample("twoLargeDirectories");
  // A broad retained-heap budget catches accidental deep proxying of 200k rows.
  // Forced GC removes allocation timing from this production-only regression check.
  expect(samples.twoLargeDirectories!.jsHeapBytes).toBeLessThan(80 * 1024 * 1024);
  const selectedRefreshMs: Record<string, number> = {};
  for (const title of ["本地文件", "远程文件"]) {
    const panel = page.getByRole("region", { name: title, exact: true });
    await panel.locator(".file-scroll").focus();
    await page.keyboard.press("Meta+a");
    await expect(panel).toContainText(`已选 ${count} 项`);
    const before = await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "list_files").length);
    const started = await page.evaluate(() => performance.now());
    await panel.getByRole("button", { name: `刷新${title}`, exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "list_files").length)).toBe(before + 1);
    await expect(panel.getByRole("button", { name: `刷新${title}`, exact: true })).toBeEnabled();
    await expect(panel).toContainText(`已选 ${count} 项`);
    selectedRefreshMs[title] = await page.evaluate(() => performance.now()) - started;
    // A broad UI budget catches the former quadratic selection reconciliation.
    expect(selectedRefreshMs[title]).toBeLessThan(5000);
  }
  await page.getByRole("button", { name: "关闭连接 测试服务器", exact: true }).click();
  await expect(page.locator(".xterm")).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  await sample("sessionRemoved");
  const result = JSON.stringify({
    engine: "Chromium / production Vite build / forced GC",
    entriesPerPanel: count,
    selectedRefreshMs,
    samples,
  }, null, 2);
  const label = process.env.MEMORY_PROFILE_LABEL || "current";
  if (!/^[a-z0-9-]+$/i.test(label)) throw new Error("Invalid memory profile label");
  await mkdir(".test-artifacts/memory", { recursive: true });
  await writeFile(`.test-artifacts/memory/${label}-${test.info().repeatEachIndex}.json`, result);
  await test.info().attach("memory-profile", { body: result, contentType: "application/json" });
  console.log(result);
});

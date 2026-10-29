import { expect, test } from "@playwright/test";
import { desktopFixture } from "./fixtures/desktop";

for (const kind of ["local", "remote"] as const) {
  test(`${kind} directory creation accepts nested relative paths and preserves rename validation`, async ({ page }) => {
    await desktopFixture(page);
    await page.goto("/");
    await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
    await expect(page.locator(".xterm")).toBeVisible();
    await page.getByRole("button", { name: "SFTP", exact: true }).click();
    const title = kind === "local" ? "本地文件" : "远程文件";
    const root = kind === "local" ? "/local" : "/remote";
    const endpoint = kind === "local" ? { kind } : { kind, sessionId: "qa-session-1" };
    const panel = page.getByRole("region", { name: title, exact: true });
    await expect(page.getByLabel(`${title}目录路径`)).toHaveValue(root);
    await panel.getByRole("button", { name: `${title}新建目录`, exact: true }).click();
    const modal = page.getByRole("dialog", { name: "新建目录", exact: true });
    await expect(modal).toContainText("缺少的父目录会自动创建");
    const input = modal.getByLabel("目录名称");
    for (const invalid of ["../escape", "data/../escape", "/absolute", ".", "./"]) {
      await input.fill(invalid);
      await modal.getByRole("button", { name: "确认", exact: true }).click();
      await expect(modal.getByRole("alert")).toContainText("相对路径");
    }
    expect(await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "mkdir_file"))).toHaveLength(0);
    const readsBefore = await page.evaluate((root) => (window as any).__qa.calls.filter((c: any) => c.command === "list_files" && c.args.path === root).length, root);
    await input.fill("data/yiqiban/config/builtin_models.yaml");
    await modal.getByRole("button", { name: "确认", exact: true }).click();
    await expect(modal).toHaveCount(0);
    const calls = await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "mkdir_file"));
    expect(calls.map((c: any) => ({ endpoint: c.args.endpoint, path: c.args.path }))).toEqual([{ endpoint, path: `${root}/data/yiqiban/config/builtin_models.yaml` }]);
    await expect.poll(() => page.evaluate((root) => (window as any).__qa.calls.filter((c: any) => c.command === "list_files" && c.args.path === root).length, root)).toBeGreaterThan(readsBefore);
    await expect(page.getByLabel(`${title}目录路径`)).toHaveValue(root);

    await panel.getByRole("row", { name: "notes.txt", exact: true }).click();
    await panel.getByRole("button", { name: `${title}重命名`, exact: true }).click();
    const rename = page.getByRole("dialog", { name: "重命名文件", exact: true });
    await rename.getByLabel("新名称").fill("other/notes.txt");
    await rename.getByRole("button", { name: "确认", exact: true }).click();
    await expect(rename.getByRole("alert")).toContainText("不包含路径分隔符");
    expect(await page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "rename_file"))).toHaveLength(0);
  });
}

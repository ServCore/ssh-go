import { expect, test, type Page } from "@playwright/test";
import { desktopFixture } from "./fixtures/desktop";
import { editDirectoryPath } from "./fixtures/navigation";
async function openFiles(page: Page) {
  await page.goto("/");
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await page.getByRole("button", { name: "SFTP", exact: true }).click();
  await expect(page.getByLabel("本地文件目录路径", { exact: true })).toHaveValue("/local");
  await expect(page.getByLabel("远程文件目录路径", { exact: true })).toHaveValue("/remote");
}
for (const kind of ["local", "remote"] as const) {
  test(`${kind} breadcrumb segments navigate immediately to their own directory without a popup`, async ({ page }, info) => {
    await desktopFixture(page);
    await openFiles(page);
    const title = kind === "local" ? "本地文件" : "远程文件";
    const input = page.getByLabel(`${title}目录路径`, { exact: true });
    const target = kind === "local" ? "/Users/w/Desktop/project" : "/opt/duidui/legacy-php";
    const parent = kind === "local" ? "/Users/w" : "/opt/duidui";
    await editDirectoryPath(input);
    await input.fill(target);
    await input.press("Enter");
    await expect(input).not.toBeEditable();
    const nav = page.getByRole("navigation", { name: `${title}路径分段`, exact: true });
    const resolves = () => page.evaluate(() => (window as any).__qa.calls.filter((c: any) => c.command === "resolve_file_path").length);
    const before = await resolves();
    await nav.getByRole("button", { name: `转到 ${parent}`, exact: true }).click();
    await expect(input).toHaveValue(parent);
    await expect(nav.getByRole("button", { name: `转到 ${parent}`, exact: true })).toHaveAttribute("aria-current", "location");
    expect(await resolves()).toBe(before + 1);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(page.getByLabel(`${kind === "local" ? "远程文件" : "本地文件"}目录路径`, { exact: true })).toHaveValue(kind === "local" ? "/remote" : "/local");
    await nav.getByRole("button", { name: `转到 ${parent}`, exact: true }).click();
    expect(await resolves()).toBe(before + 1);
    await page.screenshot({ path: info.outputPath(`${kind}-breadcrumb.png`), animations: "disabled" });
    await nav.getByRole("button", { name: "转到 /", exact: true }).click();
    await expect(input).toHaveValue("/");
  });
}

test("double clicking the blank address area edits the full path; Enter and Go submit, Escape and outside focus cancel", async ({ page }) => {
  await desktopFixture(page);
  await openFiles(page);
  const input = page.getByLabel("远程文件目录路径", { exact: true });
  await editDirectoryPath(input);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(input).toBeEditable();
  expect(await input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, "/remote".length]);
  await input.fill("/opt/duidui/legacy-php");
  await input.press("Enter");
  await expect(input).toHaveValue("/opt/duidui/legacy-php");
  await expect(input).not.toBeEditable();
  await input.focus();
  await input.press("F2");
  await expect(input).toBeEditable();
  await input.fill("/draft");
  await input.press("Escape");
  await expect(input).toHaveValue("/opt/duidui/legacy-php");
  await expect(input).not.toBeEditable();
  await editDirectoryPath(input);
  await input.fill("/var/log");
  await page.getByRole("button", { name: "远程文件前往目录", exact: true }).click();
  await expect(input).toHaveValue("/var/log");
  await expect(input).not.toBeEditable();
  await editDirectoryPath(input);
  await input.fill("/discard");
  await page.getByLabel("搜索远程文件", { exact: true }).click();
  await expect(input).toHaveValue("/var/log");
  await expect(input).not.toBeEditable();
});

test("failed editing keeps the draft and cancelling restores the actual breadcrumb path", async ({ page }) => {
  await desktopFixture(page);
  await page.addInitScript(() => {
    const qa = (window as any).__qa, invoke = qa.invoke;
    qa.invoke = (command: string, args: any) => command === "resolve_file_path" && args.path === "/missing"
      ? Promise.reject({ message: "目录不存在" }) : invoke(command, args);
  });
  await openFiles(page);
  const input = page.getByLabel("远程文件目录路径", { exact: true });
  await editDirectoryPath(input);
  await input.fill("/missing");
  await input.press("Enter");
  await expect(page.getByRole("alert")).toContainText("目录不存在");
  await expect(input).toHaveValue("/missing");
  await expect(input).toBeEditable();
  await input.press("Escape");
  await expect(input).toHaveValue("/remote");
  const nav = page.getByRole("navigation", { name: "远程文件路径分段", exact: true });
  await expect(nav.getByRole("button", { name: "转到 /remote", exact: true })).toHaveAttribute("aria-current", "location");
  await expect(nav.getByRole("button", { name: "转到 /missing", exact: true })).toHaveCount(0);
  await nav.getByRole("button", { name: "转到 /", exact: true }).click();
  await expect(input).toHaveValue("/");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("long breadcrumbs fit narrow panels and ancestors remain reachable using the keyboard", async ({ page }, info) => {
  await desktopFixture(page);
  await openFiles(page);
  const input = page.getByLabel("远程文件目录路径", { exact: true });
  const target = "/opt/" + Array.from({ length: 20 }, (_, index) => `long directory_${index}`).join("/");
  await editDirectoryPath(input);
  await input.fill(target);
  await input.press("Enter");
  await expect(input).not.toBeEditable();
  await page.setViewportSize({ width: 480, height: 700 });
  const area = page.getByRole("region", { name: "远程文件", exact: true });
  const nav = area.getByRole("navigation", { name: "远程文件路径分段", exact: true });
  await expect.poll(() => area.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const last = nav.getByRole("button", { name: `转到 ${target}`, exact: true });
  await expect.poll(async () => (await last.boundingBox())!.x + (await last.boundingBox())!.width <= (await input.boundingBox())!.x + (await input.boundingBox())!.width).toBe(true);
  await page.screenshot({ path: info.outputPath("narrow-breadcrumb.png"), animations: "disabled" });
  await last.focus();
  await last.press("Home");
  const root = nav.getByRole("button", { name: "转到 /", exact: true });
  await expect(root).toBeFocused();
  await root.press("Enter");
  await expect(input).toHaveValue("/");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

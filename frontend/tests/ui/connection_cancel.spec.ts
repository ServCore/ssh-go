import { expect, test, type Page } from "@playwright/test";
import { desktopFixture } from "./fixtures/desktop";

async function cancellationFixture(page: Page) {
  await desktopFixture(page);
  await page.addInitScript(() => {
    const w = window as any;
    const original = w.__qa.invoke;
    const attempts = new Map<
      string,
      {
        resolve: (v: unknown) => void;
        reject: (v: unknown) => void;
        hostId: string;
      }
    >();
    w.__qa.attemptIds = [];
    w.__qa.cancelledIds = [];
    w.__qa.releaseConnection = (
      id: string,
      result: "success" | "auth" | "fingerprint",
    ) => {
      const attempt = attempts.get(id)!;
      if (result === "auth")
        attempt.reject({
          code: "ssh_auth_failed",
          message: "过期请求的认证失败",
        });
      else if (result === "fingerprint")
        attempt.reject({
          code: "host_key_unknown",
          message: "请确认服务器",
          details: { fingerprint: "SHA256:fixture" },
        });
      else
        attempt.resolve({
          id: "session-" + id,
          hostId: attempt.hostId,
          hostName: "测试服务器",
          fingerprint: "SHA256:fixture",
        });
    };
    w.__qa.invoke = async (command: string, args: any = {}) => {
      if (command === "connect_host") {
        w.__qa.attemptIds.push(args.requestId);
        return new Promise((resolve, reject) =>
          attempts.set(args.requestId, {
            resolve,
            reject,
            hostId: args.hostId,
          }),
        );
      }
      if (command === "cancel_host_connection") {
        w.__qa.cancelledIds.push(args.requestId);
        return;
      }
      if (
        command === "dialog_confirm" &&
        args.title === "确认服务器身份"
      ) {
        return new Promise((resolve) => {
          w.__qa.acceptFingerprint = () => resolve(true);
        });
      }
      return original(command, args);
    };
  });
}

const hostName = "测试服务器";
const cardName = `服务器 ${hostName}`;
const cancelName = `取消连接 ${hostName}`;

test("cancelling an attempt suppresses late success without clearing the replacement attempt", async ({
  page,
}) => {
  await cancellationFixture(page);
  await page.goto("/");
  await page.getByRole("group", { name: cardName, exact: true }).dblclick();
  await expect(
    page.getByRole("button", { name: cancelName, exact: true }),
  ).toBeVisible();
  const first = await page.evaluate(() => (window as any).__qa.attemptIds[0]);
  await page.getByRole("button", { name: cancelName, exact: true }).click();
  await expect(
    page.getByRole("group", { name: cardName, exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).__qa.cancelledIds))
    .toEqual([first]);
  await page.getByRole("group", { name: cardName, exact: true }).dblclick();
  await expect
    .poll(() => page.evaluate(() => (window as any).__qa.attemptIds.length))
    .toBe(2);
  const second = await page.evaluate(() => (window as any).__qa.attemptIds[1]);
  expect(second).not.toBe(first);
  await page.evaluate(
    (id) => (window as any).__qa.releaseConnection(id, "success"),
    first,
  );
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          (window as any).__qa.calls.some(
            (c: any) =>
              c.command === "disconnect_session" &&
              c.args.id === "session-" + id,
          ),
        first,
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: cancelName, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { selected: true }),
  ).toHaveCount(0);
  await page.evaluate(
    (id) => (window as any).__qa.releaseConnection(id, "success"),
    second,
  );
  await expect(
    page.getByRole("tab", { selected: true }),
  ).toBeVisible();
  await expect(page.locator(".xterm")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).__qa.calls.filter(
          (c: any) => c.command === "open_terminal",
        ).length,
    ),
  ).toBe(1);
});

test("cancelled authentication errors do not prompt for passwords or replace the current workspace", async ({
  page,
}) => {
  await cancellationFixture(page);
  await page.goto("/");
  await page.getByRole("group", { name: cardName, exact: true }).dblclick();
  const id = await page.evaluate(() => (window as any).__qa.attemptIds[0]);
  await page.getByRole("button", { name: cancelName, exact: true }).click();
  await page.keyboard.press("Meta+,");
  await page.evaluate(
    (id) => (window as any).__qa.releaseConnection(id, "auth"),
    id,
  );
  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "服务器", exact: true }).click();
  await expect(
    page.getByRole("group", { name: cardName, exact: true }),
  ).toBeVisible();
});

test("cancelling during fingerprint confirmation prevents an approved-key retry", async ({
  page,
}) => {
  await cancellationFixture(page);
  await page.goto("/");
  await page.getByRole("group", { name: cardName, exact: true }).dblclick();
  const id = await page.evaluate(() => (window as any).__qa.attemptIds[0]);
  await page.evaluate(
    (id) => (window as any).__qa.releaseConnection(id, "fingerprint"),
    id,
  );
  await expect
    .poll(() =>
      page.evaluate(() => typeof (window as any).__qa.acceptFingerprint),
    )
    .toBe("function");
  await page.getByRole("button", { name: cancelName, exact: true }).click();
  await page.evaluate(() => (window as any).__qa.acceptFingerprint());
  await expect(
    page.getByRole("group", { name: cardName, exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).__qa.attemptIds)).toEqual([
    id,
  ]);
  await expect(
    page.getByRole("tab", { selected: true }),
  ).toHaveCount(0);
});

test("closing the last session preserves the independent settings workspace", async ({
  page,
}) => {
  await desktopFixture(page);
  await page.goto("/");
  await page.getByRole("group", { name: cardName, exact: true }).dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
  await page.keyboard.press("Meta+,");
  await page
    .getByRole("button", { name: `关闭连接 ${hostName}`, exact: true })
    .click();
  await expect(page.locator(".workspace-navigation")).toBeVisible();
  await expect(page.getByRole("tab", { selected: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "关闭 设置", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "设置", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("concurrent session closes reconcile selection against the remaining sessions", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "qa-hosts",
      JSON.stringify(
        ["A", "B"].map((name) => ({
          id: name,
          name,
          address: name.toLowerCase() + ".example",
          port: 22,
          username: "test",
          group: "测试",
          rememberPassword: true,
        })),
      ),
    );
  });
  await desktopFixture(page);
  await page.addInitScript(() => {
    const w = window as any;
    const original = w.__qa.invoke;
    const callbacks = new Map<string, () => void>();
    w.__qa.pendingCloses = [];
    w.__qa.finishClose = (id: string) => callbacks.get(id)!();
    w.__qa.invoke = async (command: string, args: any = {}) => {
      if (command === "disconnect_session") {
        w.__qa.pendingCloses.push(args.id);
        await new Promise<void>((resolve) => callbacks.set(args.id, resolve));
      }
      return original(command, args);
    };
  });
  await page.goto("/");
  for (const name of ["A", "B"]) {
    await page.getByRole("button", { name: "服务器", exact: true }).click();
    await page.getByRole("group", { name: `服务器 ${name}`, exact: true }).dblclick();
    await expect(page.getByRole("tab", { selected: true })).toHaveText(name);
  }
  await page.getByRole("button", { name: "关闭连接 B", exact: true }).click();
  await page.getByRole("button", { name: "关闭连接 A", exact: true }).click();
  await page.getByRole("button", { name: "关闭连接 B", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__qa.pendingCloses.length))
    .toBe(2);
  const [first, second] = await page.evaluate(
    () => (window as any).__qa.pendingCloses,
  );
  await page.evaluate((id) => (window as any).__qa.finishClose(id), first);
  await expect(
    page.getByRole("tab", { selected: true }),
  ).toHaveText("A");
  await page.evaluate((id) => (window as any).__qa.finishClose(id), second);
  const tabs = page.locator(".workspace-navigation");
  await expect(tabs).toHaveCount(0);
  await expect(page.getByLabel("搜索服务器", { exact: true })).toBeVisible();
});

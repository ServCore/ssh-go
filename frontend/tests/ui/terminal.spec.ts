import { selectSession } from "./fixtures/navigation";
import { expect, test } from "@playwright/test";
import { desktopFixture } from "./fixtures/desktop";

async function connect(page: import("@playwright/test").Page) {
  await desktopFixture(page);
  await page.goto("/");
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
}

test("terminal changes ANSI palettes in place without reconnecting or losing output", async ({
  page,
}) => {
  await connect(page);
  await expect(page.locator(".xterm-viewport")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.evaluate(() =>
    (window as any).__qa.terminal(
      "\r\n\x1b[32mSUCCESS\x1b[0m \x1b[33mWARNING\x1b[0m \x1b[31mERROR\x1b[0m\r\n\x1b[36mhost\x1b[0m:\x1b[34m~/project\x1b[0m $ ls\r\n",
    ),
  );
  const colors: string[][] = [];
  for (const theme of ["light", "dark"]) {
    await page.keyboard.press("Meta+,");
    await page.getByLabel("外观模式", { exact: true }).selectOption(theme);
    await selectSession(page, "测试服务器");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByLabel("外观模式", { exact: true })).toHaveCount(0);
    await expect(page.locator(".xterm-viewport")).toHaveCSS("background-color", theme === "dark" ? "rgb(34, 33, 41)" : "rgb(255, 255, 255)");
    await expect(page.locator(".xterm-rows")).toContainText("SUCCESS");
    const values = await page.locator(".xterm-rows").evaluate((root) =>
      ["SUCCESS", "WARNING", "ERROR"].map((word) => {
        const row = [...root.children].find((element) => element.textContent?.includes(word));
        if (!row) return "";
        const start = row.textContent!.indexOf(word);
        let offset = 0;
        const colors = new Set<string>();
        for (const span of row.querySelectorAll("span")) {
          const end = offset + (span.textContent || "").length;
          if (end > start && offset < start + word.length) colors.add(getComputedStyle(span).color);
          offset = end;
        }
        return colors.size === 1 ? [...colors][0] : "";
      }),
    );
    expect(values.every(Boolean)).toBe(true);
    expect(new Set(values).size).toBe(3);
    colors.push(values);
    await page.screenshot({
      path: `.test-artifacts/terminal-colors-${theme}-1280.png`,
      animations: "disabled",
    });
  }
  expect(colors).toHaveLength(2);
  expect(colors[0]).not.toEqual(colors[1]);
  expect(
    await page.evaluate(
      () =>
        (window as any).__qa.calls.filter(
          (call: any) => call.command === "open_terminal",
        ).length,
    ),
  ).toBe(1);
});

test("color prompt controls only fill commands, preserve terminal and refuse disconnected input", async ({
  page,
}) => {
  await connect(page);
  await page.getByRole("button", { name: "终端配色", exact: true }).click();
  let panel = page.getByRole("dialog", { name: "终端配色", exact: true });
  await expect(panel.getByLabel("提示符颜色示例")).toContainText("~/project");
  await panel
    .getByRole("button", { name: "填入启用命令", exact: true })
    .click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".xterm-helper-textarea")).toBeFocused();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (window as any).__qa.calls.filter(
            (call: any) => call.command === "write_terminal",
          ).length,
      ),
    )
    .toBeGreaterThan(0);
  const first = await page.evaluate(() =>
    (window as any).__qa.calls
      .filter((call: any) => call.command === "write_terminal")
      .map((call: any) =>
        new TextDecoder().decode(new Uint8Array(call.args.data)),
      )
      .join(""),
  );
  expect(first).toContain("SSH_TOOLS_ORIGINAL_PS1");
  expect(first).toContain("ZSH_VERSION");
  expect(first).not.toMatch(/[\r\n]/);
  await page.evaluate(() => {
    (window as any).__qa.calls = (window as any).__qa.calls.filter(
      (call: any) => call.command !== "write_terminal",
    );
  });
  await page.getByRole("button", { name: "终端配色", exact: true }).click();
  panel = page.getByRole("dialog", { name: "终端配色", exact: true });
  await panel
    .getByRole("button", { name: "填入恢复命令", exact: true })
    .click();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (window as any).__qa.calls.filter(
            (call: any) => call.command === "write_terminal",
          ).length,
      ),
    )
    .toBeGreaterThan(0);
  const restore = await page.evaluate(() =>
    (window as any).__qa.calls
      .filter((call: any) => call.command === "write_terminal")
      .map((call: any) =>
        new TextDecoder().decode(new Uint8Array(call.args.data)),
      )
      .join(""),
  );
  expect(restore).toContain("unset SSH_TOOLS_ORIGINAL_PS1");
  expect(restore).not.toMatch(/[\r\n]/);
  await page.getByRole("button", { name: "终端配色", exact: true }).click();
  await page.evaluate(() =>
    (window as any).__qa.emit("session-closed", {
      sessionId: "qa-session-1",
      reason: "测试断开",
    }),
  );
  await expect(
    page.getByRole("button", { name: "填入启用命令", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("dialog", { name: "终端配色", exact: true })
    .press("Escape");
  await expect(
    page.getByRole("dialog", { name: "终端配色", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).__qa.calls.filter(
          (call: any) => call.command === "open_terminal",
        ).length,
    ),
  ).toBe(1);
});

test("terminal fills all space above status bar after layout changes", async ({
  page,
}) => {
  await connect(page);
  await page.locator(".xterm").evaluate((element) => {
    (window as any).__qa.geometryTerminal = element;
  });
  const gap = () =>
    page.evaluate(() => {
      const viewport = document
        .querySelector(".session-workspace .terminal-pane")!
        .getBoundingClientRect();
      const main = document
        .querySelector(".workspace-main")!
        .getBoundingClientRect();
      return Math.abs(main.bottom - viewport.bottom);
    });
  await expect.poll(gap).toBeLessThanOrEqual(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const pane = document
          .querySelector(".session-workspace .terminal-pane")!
          .getBoundingClientRect();
        const screen = document
          .querySelector(".session-workspace .xterm-screen")!
          .getBoundingClientRect();
        return pane.bottom - screen.bottom;
      }),
    )
    .toBeLessThan(32);
  for (const size of [
    { width: 1280, height: 820 },
    { width: 1440, height: 1040 },
    { width: 960, height: 760 },
  ]) {
    await page.setViewportSize(size);
    await expect.poll(gap).toBeLessThanOrEqual(1);
    await expect(page.locator(".workspace-sidebar")).toHaveCount(0);
    await page.getByRole("button", { name: "返回服务器", exact: true }).click();
    await selectSession(page, "测试服务器");
    await expect.poll(gap).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "SFTP", exact: true }).click();
    await expect(page.getByLabel("远程文件目录路径")).toBeVisible();
    await page.getByRole("button", { name: "终端", exact: true }).click();
    await expect.poll(gap).toBeLessThanOrEqual(1);
  }
  expect(
    await page
      .locator(".xterm")
      .evaluate((element) => element === (window as any).__qa.geometryTerminal),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.screenshot({
    path: ".test-artifacts/terminal-full-height-light-1280.png",
    animations: "disabled",
  });
});

const dockerTable =
  "REPOSITORY       TAG       IMAGE ID       CREATED          SIZE\r\nexample/web      v1.2.0    aabbcc112233   12 minutes ago   108MB\r\nexample/api      latest    ddffee445566   2 weeks ago      3.11GB\r\n";
async function rowColors(
  page: import("@playwright/test").Page,
  text = "example/web",
) {
  return page
    .locator(".xterm-rows > div")
    .filter({ hasText: text })
    .first()
    .evaluate((row) => {
      const spans = [...row.querySelectorAll("span")];
      const text = row.textContent || "";
      return ["example/web", "v1.2.0", "aabbcc112233", "108MB"].map((word) => {
        const start = text.indexOf(word);
        let offset = 0;
        const colors = new Set<string>();
        for (const span of spans) {
          const end = offset + (span.textContent || "").length;
          if (start >= 0 && end > start && offset < start + word.length)
            colors.add(getComputedStyle(span).color);
          offset = end;
        }
        return colors.size === 1 ? [...colors][0] : "";
      });
    });
}

test("plain Docker output receives display colors, can be disabled and preserves output text", async ({
  page,
}) => {
  await connect(page);
  await page.evaluate(
    (table) =>
      (window as any).__qa.terminal(
        "[root@server ~]# docker images\r\n" + table + "[root@server ~]# ",
      ),
    dockerTable,
  );
  await expect.poll(async () => new Set(await rowColors(page)).size).toBe(4);
  const nativeText = await page.locator(".xterm-rows").textContent();
  await page.screenshot({
    path: ".test-artifacts/terminal-docker-highlight-light-1280.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "终端配色", exact: true }).click();
  await page.getByLabel("纯文本显示高亮", { exact: true }).uncheck();
  await expect.poll(async () => new Set(await rowColors(page)).size).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("qa-preferences") || "{}")[
            "terminal.highlightOutput"
          ],
      ),
    )
    .toBe(false);
  expect(await page.locator(".xterm-rows").textContent()).toBe(nativeText);
  await page.getByLabel("纯文本显示高亮", { exact: true }).check();
  await expect.poll(async () => new Set(await rowColors(page)).size).toBe(4);
  await page.getByRole("button", { name: "关闭终端配色", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).__qa.calls.filter(
          (call: any) => call.command === "write_terminal",
        ).length,
    ),
  ).toBe(0);
});

test("structured highlighting skips alternate screen, restores normal screen and persists disabled preference", async ({
  page,
}) => {
  await connect(page);
  await page.evaluate(
    (table) => (window as any).__qa.terminal(table),
    dockerTable,
  );
  await expect.poll(async () => new Set(await rowColors(page)).size).toBe(4);
  await page.evaluate(
    (table) => (window as any).__qa.terminal("\x1b[?1049h" + table),
    dockerTable,
  );
  await expect.poll(async () => new Set(await rowColors(page)).size).toBe(1);
  await page.evaluate(() => (window as any).__qa.terminal("\x1b[?1049l"));
  await expect.poll(async () => new Set(await rowColors(page)).size).toBe(4);
  await page.getByRole("button", { name: "终端配色", exact: true }).click();
  await page.getByLabel("纯文本显示高亮", { exact: true }).uncheck();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("qa-preferences") || "{}")[
            "terminal.highlightOutput"
          ],
      ),
    )
    .toBe(false);
  await page.reload();
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).__qa.terminal))
    .toBe("function");
  await page.evaluate(
    (table) => (window as any).__qa.terminal(table),
    dockerTable,
  );
  await expect.poll(async () => new Set(await rowColors(page)).size).toBe(1);
  await page.getByRole("button", { name: "终端配色", exact: true }).click();
  await expect(
    page.getByLabel("纯文本显示高亮", { exact: true }),
  ).not.toBeChecked();
});

test("container table columns and statuses keep display colors when output wraps", async ({
  page,
}) => {
  await connect(page);
  const fields = [
    "CONTAINER ID",
    "IMAGE",
    "COMMAND",
    "CREATED",
    "STATUS",
    "PORTS",
    "NAMES",
    "SIZE",
  ];
  const rows = [
    [
      "aabbcc112233",
      "example/web:latest",
      '"sh -c echo  hello"',
      "2 hours ago",
      "Up 2 hours (healthy)",
      "0.0.0.0:8080->80/tcp",
      "web",
      "35.58 kB (virtual 109.2 MB)",
    ],
    [
      "ddffee445566",
      "example/api:v1",
      '"/entrypoint.sh"',
      "2 weeks ago",
      "Exited (137) 2 hours ago",
      "",
      "api",
      "0 B (virtual 209.5 MB)",
    ],
    [
      "112233aabbcc",
      "redis:latest",
      '"redis-server"',
      "2 days ago",
      "Up 2 days (Paused)",
      "6379/tcp",
      "cache",
      "0 B (virtual 90 MB)",
    ],
  ];
  const widths = fields.map(
    (field, index) =>
      Math.max(field.length, ...rows.map((row) => row[index].length)) + 3,
  );
  const output =
    [fields, ...rows]
      .map((row) =>
        row
          .map((value, index) =>
            index === fields.length - 1 ? value : value.padEnd(widths[index]),
          )
          .join(""),
      )
      .join("\r\n") + "\r\n[root@server ~]# ";
  await page.evaluate((text) => (window as any).__qa.terminal(text), output);
  const colors = () =>
    page.locator(".xterm-rows").evaluate((root) => {
      const spans = [...root.querySelectorAll("span")];
      const text = root.textContent || "";
      return [
        "aabbcc112233",
        "example/web:latest",
        "Up 2 hours (healthy)",
        "Exited (137) 2 hours ago",
        "Up 2 days (Paused)",
      ].map((word) => {
        const start = text.indexOf(word);
        let offset = 0;
        const result = new Set<string>();
        for (const span of spans) {
          const end = offset + (span.textContent || "").length;
          if (start >= 0 && end > start && offset < start + word.length)
            result.add(getComputedStyle(span).color);
          offset = end;
        }
        return result.size === 1 ? [...result][0] : "";
      });
    });
  for (const theme of ["light"]) {
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByLabel("外观模式", { exact: true })).toHaveCount(0);
    for (const width of [1280, 960]) {
      await page.setViewportSize({ width, height: 820 });
      await expect
        .poll(async () => {
          const values = await colors();
          return values.every(Boolean) ? new Set(values).size : 0;
        })
        .toBe(5);
      await page.screenshot({
        path: `.test-artifacts/terminal-containers-${theme}-${width}.png`,
        animations: "disabled",
      });
    }
  }
  await page.getByRole("button", { name: "终端配色", exact: true }).click();
  await page.getByLabel("纯文本显示高亮", { exact: true }).uncheck();
  await expect.poll(async () => new Set(await colors()).size).toBe(1);
  expect(
    await page.evaluate(
      () =>
        (window as any).__qa.calls.filter(
          (call: any) => call.command === "write_terminal",
        ).length,
    ),
  ).toBe(0);
});

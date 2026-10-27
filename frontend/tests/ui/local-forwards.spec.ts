import {expect,test} from "@playwright/test";
import {desktopFixture} from "./fixtures/desktop";

async function openForwards(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "搜索资源与操作", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "搜索资源与操作", exact: true });
  const input = dialog.getByRole("textbox", { name: "搜索资源", exact: true });
  await input.fill("端口转发");
  await input.press("Enter");
}



test("local forwarding allocates a loopback port, survives reopening its panel and stops explicitly",async({page})=>{
  await desktopFixture(page);await page.goto("/");
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
  await openForwards(page);
  const dialog=page.getByRole("dialog",{name:"端口转发 · 测试服务器",exact:true});
  await expect(dialog.getByLabel("本地端口")).toHaveValue("0");
  await dialog.getByRole("button",{name:"开启转发",exact:true}).click();
  await expect(dialog.getByRole("list",{name:"当前端口转发",exact:true})).toContainText("127.0.0.1:12345");
  const start=await page.evaluate(()=>(window as any).__qa.calls.find((item:any)=>item.command==="start_local_forward"));
  expect(start.args).toMatchObject({sessionId:"qa-session-1",remoteHost:"127.0.0.1",remotePort:5432,localPort:0});
  await dialog.getByRole("button",{name:"关闭",exact:true}).click();
  await openForwards(page);
  await expect(dialog.getByRole("button",{name:"停止转发 12345",exact:true})).toBeVisible();
  await dialog.getByRole("button",{name:"停止转发 12345",exact:true}).click();
  await expect(dialog).toContainText("当前没有端口转发");
  expect(await page.evaluate(()=>(window as any).__qa.calls.filter((item:any)=>item.command==="stop_local_forward").length)).toBe(1);
});

test("disconnect disables new forwarding and clears the displayed listeners",async({page})=>{
  await desktopFixture(page);await page.goto("/");
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
  await openForwards(page);
  const dialog=page.getByRole("dialog",{name:"端口转发 · 测试服务器",exact:true});
  await dialog.getByRole("button",{name:"开启转发",exact:true}).click();
  await expect(dialog.getByRole("button",{name:"停止转发 12345",exact:true})).toBeVisible();
  await page.evaluate(()=>(window as any).__qa.emit("session-closed",{sessionId:"qa-session-1",reason:"连接中断"}));
  await expect(dialog).toContainText("SSH 已断开，端口转发已停止");
  await expect(dialog.getByRole("button",{name:"开启转发",exact:true})).toHaveCount(0);
  await expect(dialog.getByRole("listitem")).toHaveCount(0);
  await dialog.getByRole("button",{name:"关闭",exact:true}).click();
  await expect(page.getByRole("button", { name: "端口转发", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "搜索资源与操作", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索资源", exact: true }).fill("端口转发");
  await expect(page.getByRole("button", { name: /^端口转发/ })).toHaveCount(0);
});

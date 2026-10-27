import { expect, test } from "@playwright/test";
import { desktopFixture } from "./fixtures/desktop";

test("duplicate produces an independent host and preserves the source while editing the copy", async ({ page }) => {
  await desktopFixture(page);
  await page.goto("/");
  const source = page.getByRole("group", { name: "服务器 测试服务器", exact: true });
  await source.click({ button: "right" });
  await page.screenshot({ path: ".test-artifacts/duplicate-connection-menu.png", animations: "disabled" });
  await page.getByRole("menuitem", { name: "复制连接", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("服务器名称").fill("复制后修改");
  await dialog.getByLabel("主机地址").fill("new.example.com");
  await dialog.getByRole("button", { name: "保存服务器", exact: true }).click();
  await expect(source).toBeVisible();
  await expect(page.getByRole("group", { name: "服务器 复制后修改", exact: true })).toBeVisible();
  const hosts = await page.evaluate(() => JSON.parse(localStorage.getItem("qa-hosts")!));
  expect(hosts.find((item: any) => item.id === "qa-host").address).toBe("127.0.0.1");
  expect(hosts.find((item: any) => item.name === "复制后修改").id).not.toBe("qa-host");
  await source.focus(); await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(source).toBeFocused();
});

test("private key and Agent forms clear transient secrets when changing authentication", async ({ page }) => {
  await desktopFixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "添加服务器", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("服务器名称").fill("Agent 主机");
  await dialog.getByLabel("主机地址").fill("agent.example.com");
  await dialog.getByLabel("用户名").fill("dev");
  await dialog.getByLabel("认证方式").selectOption("privateKey");
  await page.evaluate(() => { (window as any).__qa.selectedFile = "/Users/test/.ssh/id_ed25519"; });
  await dialog.getByRole("button", { name: "选择私钥文件" }).click();
  await expect(dialog.getByRole("textbox", { name: /私钥文件/ })).toHaveValue("/Users/test/.ssh/id_ed25519");
  await dialog.getByLabel("私钥口令").fill("transient-secret");
  await dialog.getByLabel("认证方式").selectOption("agent");
  await expect(dialog.getByLabel("私钥口令")).toHaveCount(0);
  await dialog.getByRole("button", { name: "保存服务器" }).click();
  const call = await page.evaluate(() => (window as any).__qa.calls.findLast((item: any) => item.command === "save_host"));
  expect(call.args.passwordSupplied).toBe(false);
  expect(call.args.host.authMethod).toBe("agent");
  expect(call.args.host.privateKeyPath).toBeNull();
});

test("import previews warnings before explicit confirmation and cancellation never writes", async ({ page }) => {
  await desktopFixture(page);
  await page.goto("/");
  await page.evaluate(() => {
    const qa=(window as any).__qa; qa.selectedFile="/local/hosts.json";
    qa.importPreview={hosts:[{id:"imported-host",name:"导入主机",address:"import.example.com",port:22,username:"test",group:"",rememberPassword:false}],warnings:["已忽略不支持的 SSH 指令"]};
  });
  await page.keyboard.press("Meta+,");
  await page.getByRole("button", { name: "导入 JSON 配置", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("导入主机");
  await expect(page.getByRole("dialog")).toContainText("已忽略不支持的 SSH 指令");
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__qa.calls.filter((item:any)=>item.command==="import_hosts").length)).toBe(0);
  await page.getByRole("button", { name: "导入 JSON 配置", exact: true }).click();
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page.getByRole("status").filter({hasText:"已导入 1 台服务器"})).toBeVisible();
  await page.getByRole("button", { name: "服务器", exact: true }).click();
  await expect(page.getByRole("group", { name: "服务器 导入主机", exact: true })).toBeVisible();
});

test("forgetting a trusted server requires an explicit confirmation and matching fingerprint", async ({ page }) => {
  await desktopFixture(page);
  await page.goto("/");
  await page.keyboard.press("Meta+,");
  await page.getByRole("button", { name: "移除信任", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("SHA256:qa");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__qa.calls.filter((item:any)=>item.command==="forget_known_host").length)).toBe(0);
  await page.getByRole("button", { name: "移除信任", exact: true }).click();
  await page.getByRole("button", { name: "确认移除信任", exact: true }).click();
  await expect(page.getByText("还没有已信任的服务器。",{exact:true})).toBeVisible();
  const call=await page.evaluate(() => (window as any).__qa.calls.find((item:any)=>item.command==="forget_known_host"));
  expect(call.args).toMatchObject({address:"127.0.0.1",port:2222,expectedFingerprint:"SHA256:qa"});
});

test("manual reconnect creates fresh terminal and ignores old session close events", async ({ page }) => {
  await desktopFixture(page);
  await page.goto("/");
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
  await page.evaluate(() => (window as any).__qa.emit("session-closed", {sessionId:"qa-session-1",reason:"网络断开"}));
  await page.getByRole("button", { name: "重新连接", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__qa.calls.filter((item:any)=>item.command==="open_terminal").length)).toBe(2);
  await page.evaluate(() => (window as any).__qa.emit("session-closed", {sessionId:"qa-session-1",reason:"旧事件"}));
  await expect(page.getByRole("button", { name: "重新连接", exact: true })).toHaveCount(0);
  await expect(page.locator(".xterm")).toBeVisible();
  const calls=await page.evaluate(() => (window as any).__qa.calls.filter((item:any)=>item.command==="open_terminal"));
  expect(calls[0].args.sessionId).not.toBe(calls[1].args.sessionId);
});

test("jump authentication prompts for the hop and confirms each server identity separately", async ({ page }) => {
  await desktopFixture(page);
  await page.addInitScript(() => {
    const w=window as any; const original=w.__qa.invoke;
    const jump={id:"qa-jump",name:"跳板服务器",address:"jump.example.com",port:2200,username:"gateway",group:"",authMethod:"privateKey",privateKeyPath:"/local/id_ed25519",rememberPassword:false};
    let jumpConfirmed=false, targetConfirmed=false, stored=false;
    w.__qa.hopAttempts=[];
    w.__qa.invoke=async(command:string,args:any={}) => {
      if(command==="list_hosts")return [...await original(command,args),jump];
      if(command==="save_host" && args.host.id===jump.id) {stored=Boolean(args.password);return {...jump,rememberPassword:stored};}
      if(command==="connect_host") {
        w.__qa.hopAttempts.push({hostId:args.hostId,passwordSupplied:Boolean(args.password),acceptedHostId:args.acceptedHostId});
        if(args.acceptedHostId===jump.id)jumpConfirmed=true;
        if(args.acceptedHostId==="qa-host")targetConfirmed=true;
        if(!jumpConfirmed)throw {code:"host_key_unknown",message:"确认跳板机",details:{hostId:jump.id,address:jump.address,port:jump.port,fingerprint:"SHA256:jump"}};
        if(!targetConfirmed)throw {code:"host_key_unknown",message:"确认目标",details:{hostId:"qa-host",address:"target.example.com",port:22,fingerprint:"SHA256:target"}};
        if(!stored)throw {code:"key_passphrase_required",message:"请输入跳板机私钥口令",details:{hostId:jump.id}};
      }
      return original(command,args);
    };
  });
  await page.goto("/");
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  const dialog=page.getByRole("dialog");
  await expect(dialog).toContainText("连接 跳板服务器");
  await dialog.getByLabel("私钥口令").fill("temporary-passphrase");
  await dialog.getByRole("button",{name:"连接",exact:true}).click();
  await expect(page.locator(".xterm")).toBeVisible();
  const calls=await page.evaluate(() => (window as any).__qa.calls.filter((item:any)=>item.command==="dialog_confirm"));
  expect(calls[0].args.message).toContain("jump.example.com:2200");
  expect(calls[1].args.message).toContain("target.example.com:22");
  const attempts=await page.evaluate(() => (window as any).__qa.hopAttempts);
  expect(attempts.map((item:any)=>item.acceptedHostId).slice(0,3)).toEqual([null,"qa-jump","qa-host"]);
  expect(attempts.every((item:any)=>item.hostId==="qa-host" && !item.passwordSupplied)).toBe(true);
});

test("removing a session during reconnect cancels the request and cleans late success", async ({page}) => {
  await desktopFixture(page);
  await page.addInitScript(() => {
    const w=window as any;const original=w.__qa.invoke; let count=0;
    w.__qa.invoke=async(command:string,args:any={}) => {
      if(command==="connect_host" && ++count>1) {
        w.__qa.reconnectRequest=args.requestId;
        return new Promise(resolve => {w.__qa.finishReconnect=()=>resolve({id:"late-reconnect",hostId:args.hostId,hostName:"测试服务器",fingerprint:"SHA256:qa"});});
      }
      return original(command,args);
    };
  });
  await page.goto("/");
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
  await page.evaluate(() => (window as any).__qa.emit("session-closed",{sessionId:"qa-session-1",reason:"网络断开"}));
  await page.getByRole("button", {name:"重新连接",exact:true}).click();
  await expect(page.getByRole("button", {name:"重连中…",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"移除 测试服务器",exact:true}).click();
  await expect(page.getByRole("tab", { selected: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).__qa.finishReconnect());
  await expect.poll(() => page.evaluate(() => (window as any).__qa.calls.some((item:any)=>item.command==="disconnect_session" && item.args.id==="late-reconnect"))).toBe(true);
  expect(await page.evaluate(() => (window as any).__qa.calls.filter((item:any)=>item.command==="open_terminal").length)).toBe(1);
});

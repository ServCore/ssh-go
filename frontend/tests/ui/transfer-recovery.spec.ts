import {expect,test} from "@playwright/test";
import {desktopFixture} from "./fixtures/desktop";

const localRecord={id:"local-interrupted",name:"local.txt",hostId:null,finalPath:"/local/local.txt",stagingPath:"/local/.farbridge-local.part",backupPath:"/local/.farbridge-local.backup",phase:"backupCreated"};

test("local interrupted files require confirmation, cancellation writes nothing and discard preserves backups",async({page})=>{
  await desktopFixture(page);await page.goto("/");
  await page.evaluate(record=>{(window as any).__qa.recoveries=[record];},localRecord);
  await page.getByRole("button",{name:"传输队列",exact:true}).click();
  const panel=page.getByRole("region",{name:"中断传输处理",exact:true});
  await expect(panel).toContainText(localRecord.finalPath);
  await panel.getByRole("button",{name:"恢复原文件",exact:true}).click();
  const restore=page.getByRole("dialog",{name:"确认恢复原文件",exact:true});
  await expect(restore).toContainText("仅在目标文件不存在时");
  await restore.getByRole("button",{name:"取消",exact:true}).click();
  expect(await page.evaluate(()=>(window as any).__qa.calls.filter((item:any)=>item.command==="recover_transfer").length)).toBe(0);
  await panel.getByRole("button",{name:"清理临时文件",exact:true}).click();
  const discard=page.getByRole("dialog",{name:"确认清理临时文件",exact:true});
  await expect(discard).toContainText("保留原文件及原文件备份");
  await discard.getByRole("button",{name:"确认清理临时文件",exact:true}).click();
  await expect(panel).toContainText("没有待处理的中断传输");
  const call=await page.evaluate(()=>(window as any).__qa.calls.find((item:any)=>item.command==="recover_transfer"));
  expect(call.args).toMatchObject({id:"local-interrupted",action:"discard"});
  expect(call.args.sessionId).toBeNull();
});

test("remote recovery uses a fresh authenticated session only for the recorded host",async({page})=>{
  await desktopFixture(page);await page.goto("/");
  await page.evaluate(record=>{(window as any).__qa.recoveries=[{...record,id:"remote-interrupted",hostId:"qa-host"},{...record,id:"different-host",name:"different.txt",hostId:"other-host"}];},localRecord);
  await page.getByRole("button",{name:"传输队列",exact:true}).click();
  const panel=page.getByRole("region",{name:"中断传输处理",exact:true});
  const remote=panel.getByRole("listitem",{name:"中断传输 local.txt",exact:true});
  await expect(remote.getByRole("button",{name:"恢复原文件",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"关闭传输队列",exact:true}).click();
  await page.getByRole("group", { name: "服务器 测试服务器", exact: true }).dblclick();
  await expect(page.locator(".xterm")).toBeVisible();
  await page.getByRole("button",{name:"传输队列",exact:true}).click();
  await expect(remote.getByRole("button",{name:"恢复原文件",exact:true})).toBeEnabled();
  await expect(panel.getByRole("listitem",{name:"中断传输 different.txt",exact:true}).getByRole("button",{name:"清理临时文件",exact:true})).toBeDisabled();
  await remote.getByRole("button",{name:"恢复原文件",exact:true}).click();
  await page.getByRole("dialog",{name:"确认恢复原文件",exact:true}).getByRole("button",{name:"确认恢复原文件",exact:true}).click();
  const call=await page.evaluate(()=>(window as any).__qa.calls.find((item:any)=>item.command==="recover_transfer"));
  expect(call.args).toMatchObject({id:"remote-interrupted",action:"restore",sessionId:"qa-session-1"});
});

test("corrupt journals and ambiguous targets are visible and never silently reset",async({page})=>{
  await desktopFixture(page);await page.goto("/");
  await page.evaluate(()=>{(window as any).__qa.recoveryReadError="恢复记录损坏，请保留原记录并检查备份";});
  await page.getByRole("button",{name:"传输队列",exact:true}).click();
  const panel=page.getByRole("region",{name:"中断传输处理",exact:true});
  await expect(panel.getByRole("alert")).toContainText("恢复记录损坏");
  expect(await page.evaluate(()=>(window as any).__qa.calls.filter((item:any)=>item.command==="recover_transfer").length)).toBe(0);
  await page.evaluate(record=>{const qa=(window as any).__qa;qa.recoveryReadError=null;qa.recoveries=[record];qa.recoveryActionError="目标文件已存在，已保留目标与原文件备份";},localRecord);
  await panel.getByRole("button",{name:"刷新中断记录",exact:true}).click();
  await panel.getByRole("button",{name:"恢复原文件",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"确认恢复原文件",exact:true});
  await dialog.getByRole("button",{name:"确认恢复原文件",exact:true}).click();
  await expect(dialog.getByRole("alert")).toContainText("目标文件已存在");
  expect(await page.evaluate(()=>(window as any).__qa.recoveries.length)).toBe(1);
});

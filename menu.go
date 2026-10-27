package main

import (
	"runtime"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
)

// macOS puts application commands in the system menu bar. Other platforms use
// the same commands in the window, where the Vue menu also works in previews.
func (a *App) applicationMenu() *menu.Menu {
	if runtime.GOOS != "darwin" {
		return nil
	}
	m := menu.NewMenu()
	m.Append(menu.AppMenu())
	command := func(action string) menu.Callback {
		return func(*menu.CallbackData) { a.emit("app:menu", action) }
	}
	file := m.AddSubmenu("文件")
	file.AddText("添加服务器…", keys.CmdOrCtrl("n"), command("new"))
	file.AddSeparator()
	file.AddText("关闭当前工作区", keys.CmdOrCtrl("w"), command("close"))
	m.Append(menu.EditMenu())
	view := m.AddSubmenu("查看")
	view.AddText("服务器", nil, command("hosts"))
	view.AddText("搜索资源与操作…", keys.CmdOrCtrl("k"), command("search"))
	view.AddText("传输队列", nil, command("transfers"))
	view.AddSeparator()
	view.AddText("设置…", keys.CmdOrCtrl(","), command("settings"))
	m.Append(menu.WindowMenu())
	return m
}

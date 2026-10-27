package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"ssh-go/internal/core"
)

type App struct {
	ctx     context.Context
	engine  *core.Engine
	ready   chan struct{}
	initErr error
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	defer close(a.ready)
	dir, err := os.UserConfigDir()
	if err == nil {
		a.engine, err = core.NewEngine(filepath.Join(dir, "dev.worklane.ssh.go", "data"), a.emit)
	}
	a.initErr = err
}
func (a *App) shutdown(context.Context) {
	<-a.ready
	if a.engine != nil {
		a.engine.Close()
	}
}
func (a *App) emit(name string, payload any) {
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, name, payload)
	}
}

// Call is the sole RPC entry. Wails' ErrorFormatter preserves AppError codes
// and details so the existing credential and fingerprint dialogs can react.
func (a *App) Call(command string, args map[string]any) (any, error) {
	<-a.ready
	if a.initErr != nil {
		return nil, a.initErr
	}
	if strings.HasPrefix(command, "dialog_") {
		return a.dialog(command, args)
	}
	raw, err := json.Marshal(args)
	if err != nil {
		return nil, err
	}
	var input core.Arguments
	if err = json.Unmarshal(raw, &input); err != nil {
		return nil, &core.AppError{Code: "invalid_arguments", Message: "桌面命令参数无效"}
	}
	return a.engine.Call(command, input)
}
func (a *App) dialog(command string, args map[string]any) (any, error) {
	title, _ := args["title"].(string)
	switch command {
	case "dialog_open":
		options := runtime.OpenDialogOptions{Title: title}
		if directory, _ := args["directory"].(bool); directory {
			return runtime.OpenDirectoryDialog(a.ctx, options)
		}
		if multiple, _ := args["multiple"].(bool); multiple {
			return runtime.OpenMultipleFilesDialog(a.ctx, options)
		}
		return runtime.OpenFileDialog(a.ctx, options)
	case "dialog_save":
		name, _ := args["defaultPath"].(string)
		return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{Title: title, DefaultFilename: name, Filters: []runtime.FileFilter{{DisplayName: "JSON 配置", Pattern: "*.json"}}})
	case "dialog_confirm":
		message, _ := args["message"].(string)
		result, err := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{Type: runtime.WarningDialog, Title: title, Message: message, Buttons: []string{"取消", "确认"}, DefaultButton: "取消", CancelButton: "取消"})
		return result == "确认", err
	default:
		return nil, &core.AppError{Code: "unknown_command", Message: "未知对话框命令"}
	}
}

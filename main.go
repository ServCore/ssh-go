package main

import (
	"embed"
	"fmt"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"ssh-go/internal/core"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := &App{ready: make(chan struct{})}
	err := wails.Run(&options.App{
		Title: "ssh-go", Menu: app.applicationMenu(),
		Width: 1280, Height: 820, MinWidth: 800, MinHeight: 560,
		AssetServer:      &assetserver.Options{Assets: assets},
		BackgroundColour: options.NewRGB(255, 255, 255),
		OnStartup:        app.startup, OnShutdown: app.shutdown,
		Bind: []interface{}{app}, ErrorFormatter: core.ErrorValue,
		SingleInstanceLock: &options.SingleInstanceLock{UniqueId: "dev.worklane.ssh.go"},
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

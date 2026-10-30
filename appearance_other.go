//go:build !darwin || !cgo

package main

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func setWindowAppearance(ctx context.Context, mode string) {
	switch mode {
	case "light":
		runtime.WindowSetLightTheme(ctx)
	case "dark":
		runtime.WindowSetDarkTheme(ctx)
	default:
		runtime.WindowSetSystemDefaultTheme(ctx)
	}
}

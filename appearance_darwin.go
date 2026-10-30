//go:build darwin && cgo

package main

/*
#cgo CFLAGS: -fblocks
#cgo LDFLAGS: -framework Cocoa
void sshGoSetAppearance(int mode);
*/
import "C"

import "context"

func setWindowAppearance(_ context.Context, mode string) {
	value := 0 // nil restores the system appearance, including future OS changes.
	if mode == "light" {
		value = 1
	} else if mode == "dark" {
		value = 2
	}
	C.sshGoSetAppearance(C.int(value))
}

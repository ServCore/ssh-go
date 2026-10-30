package core

import (
	"context"
	"errors"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

// LOGFONTW is the first member of ENUMLOGFONTEXW supplied to the callback.
type fontLogW struct {
	Height, Width, Escapement, Orientation, Weight int32
	Italic, Underline, StrikeOut, CharSet          byte
	OutPrecision, ClipPrecision, Quality, Pitch    byte
	FaceName                                       [32]uint16
}

var fontEnumerationMu sync.Mutex
var fontEnumerationNames *[]string
var fontCallback = windows.NewCallback(func(logFont, _textMetric, _fontType, _parameter uintptr) uintptr {
	if fontEnumerationNames != nil && logFont != 0 {
		name := windows.UTF16ToString((*fontLogW)(unsafe.Pointer(logFont)).FaceName[:])
		*fontEnumerationNames = append(*fontEnumerationNames, name)
	}
	return 1
})

func systemFontFamilies(context.Context) ([]string, error) {
	fontEnumerationMu.Lock()
	defer fontEnumerationMu.Unlock()
	user32 := windows.NewLazySystemDLL("user32.dll")
	gdi32 := windows.NewLazySystemDLL("gdi32.dll")
	dc, _, _ := user32.NewProc("GetDC").Call(0)
	if dc == 0 {
		return nil, errors.New("GetDC failed")
	}
	defer user32.NewProc("ReleaseDC").Call(0, dc)
	names := []string{}
	fontEnumerationNames = &names
	defer func() { fontEnumerationNames = nil }()
	filter := fontLogW{CharSet: 1} // DEFAULT_CHARSET: enumerate all available families.
	gdi32.NewProc("EnumFontFamiliesExW").Call(dc, uintptr(unsafe.Pointer(&filter)), fontCallback, 0, 0)
	return names, nil
}

//go:build darwin && cgo

package core

/*
#cgo LDFLAGS: -framework CoreText -framework CoreFoundation
#include <CoreText/CoreText.h>
*/
import "C"

import (
	"context"
	"errors"
	"unsafe"
)

func systemFontFamilies(context.Context) ([]string, error) {
	families := C.CTFontManagerCopyAvailableFontFamilyNames()
	if families == 0 {
		return nil, errors.New("CoreText returned no font families")
	}
	defer C.CFRelease(C.CFTypeRef(families))
	count := C.CFArrayGetCount(families)
	names := make([]string, 0, int(count))
	for i := C.CFIndex(0); i < count; i++ {
		name := C.CFStringRef(C.CFArrayGetValueAtIndex(families, i))
		size := C.CFStringGetMaximumSizeForEncoding(C.CFStringGetLength(name), C.kCFStringEncodingUTF8) + 1
		if size <= 0 || size > 4096 {
			continue
		}
		buffer := make([]byte, int(size))
		pointer := (*C.char)(unsafe.Pointer(&buffer[0]))
		if C.CFStringGetCString(name, pointer, size, C.kCFStringEncodingUTF8) != 0 {
			names = append(names, C.GoString(pointer))
		}
	}
	return names, nil
}

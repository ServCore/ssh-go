//go:build (!darwin && !linux && !windows) || (darwin && !cgo)

package core

import (
	"context"
	"errors"
)

func systemFontFamilies(context.Context) ([]string, error) {
	return nil, errors.New("system font enumeration is unavailable on this build")
}

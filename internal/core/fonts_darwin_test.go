//go:build darwin && cgo

package core

import (
	"sort"
	"testing"
)

func TestFontCommandReturnsInstalledMacFamilies(t *testing.T) {
	e := newTestEngine(t, nil)
	value, err := e.Call("list_system_fonts", Arguments{})
	if err != nil {
		t.Fatal(err)
	}
	names, ok := value.([]string)
	if !ok || len(names) == 0 || !sort.StringsAreSorted(names) {
		t.Fatalf("invalid installed font list: %v", value)
	}
	t.Logf("Read %d installed macOS font families", len(names))
}

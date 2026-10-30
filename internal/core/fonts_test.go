package core

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestFontFamiliesNormalizeNamesAndRemoveAliasesAndInternalFaces(t *testing.T) {
	got := normalizeFontFamilies([]string{" Menlo ", "menlo", "Arial", "手札体-简", "", ".Hidden", "@Vertical", "bad\nname", strings.Repeat("x", 481)})
	want := []string{"Arial", "Menlo", "手札体-简"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("font families: got %q, want %q", got, want)
	}
}

func TestFontEnumerationHonorsCancelledRequests(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := ListSystemFonts(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled font enumeration: %v", err)
	}
}

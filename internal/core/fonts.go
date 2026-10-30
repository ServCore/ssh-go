package core

import (
	"context"
	"sort"
	"strings"
)

// Enumerate installed families, never copy font files into the app or its data.
func ListSystemFonts(ctx context.Context) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	names, err := systemFontFamilies(ctx)
	if err != nil {
		return nil, fail("font_list_error", "暂时无法读取系统字体，仍可手动输入字体名称")
	}
	return normalizeFontFamilies(names), nil
}

func normalizeFontFamilies(names []string) []string {
	result := make([]string, 0, len(names))
	seen := make(map[string]bool, len(names))
	for _, name := range names {
		name = strings.TrimSpace(name)
		key := strings.ToLower(name)
		if name == "" || len(name) > 480 || hasControls(name) || strings.HasPrefix(name, ".") || strings.HasPrefix(name, "@") || seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, name)
	}
	sort.Strings(result)
	return result
}

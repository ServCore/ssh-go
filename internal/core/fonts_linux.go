package core

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

func systemFontFamilies(parent context.Context) ([]string, error) {
	ctx, cancel := context.WithTimeout(parent, 5*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, "fc-list", "--format", "%{family}\n").Output()
	if err != nil {
		return nil, err
	}
	return strings.FieldsFunc(string(output), func(c rune) bool { return c == '\n' || c == ',' }), nil
}

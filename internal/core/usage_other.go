//go:build !darwin && !linux

package core

import "runtime"

func processUsage() (float64, uint64, string, bool) {
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	return 0, memory.Sys, "go-runtime", false
}

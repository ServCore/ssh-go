//go:build darwin || linux

package core

import (
	"golang.org/x/sys/unix"
	"runtime"
)

func processUsage() (float64, uint64, string, bool) {
	var usage unix.Rusage
	if err := unix.Getrusage(unix.RUSAGE_SELF, &usage); err != nil {
		return 0, 0, "unavailable", false
	}
	cpu := float64(usage.Utime.Sec+usage.Stime.Sec) + float64(usage.Utime.Usec+usage.Stime.Usec)/1e6
	memory := uint64(max(0, usage.Maxrss))
	if runtime.GOOS == "linux" {
		memory *= 1024
	}
	memory, kind := currentProcessMemory(memory)
	return cpu, memory, kind, true
}

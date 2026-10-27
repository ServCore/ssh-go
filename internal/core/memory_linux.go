package core

import (
	"os"
	"strconv"
	"strings"
)

func currentProcessMemory(peakRSS uint64) (uint64, string) {
	data, err := os.ReadFile("/proc/self/statm")
	if err == nil {
		fields := strings.Fields(string(data))
		if len(fields) >= 2 {
			pages, err := strconv.ParseUint(fields[1], 10, 64)
			if err == nil {
				return pages * uint64(os.Getpagesize()), "rss"
			}
		}
	}
	return peakRSS, "peak-rss"
}

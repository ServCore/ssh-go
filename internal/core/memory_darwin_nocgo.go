//go:build darwin && !cgo

package core

func currentProcessMemory(peakRSS uint64) (uint64, string) {
	return peakRSS, "peak-rss"
}

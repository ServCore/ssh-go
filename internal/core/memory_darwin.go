//go:build darwin && cgo

package core

/*
#include <libproc.h>
#include <sys/resource.h>
#include <unistd.h>

static int self_memory_footprint(uint64_t *bytes) {
    struct rusage_info_v2 info = {0};
    if (proc_pid_rusage(getpid(), RUSAGE_INFO_V2, (rusage_info_t *)&info) != 0) {
        return -1;
    }
    *bytes = info.ri_phys_footprint;
    return 0;
}
*/
import "C"

func currentProcessMemory(peakRSS uint64) (uint64, string) {
	var bytes C.uint64_t
	if C.self_memory_footprint(&bytes) == 0 {
		return uint64(bytes), "footprint"
	}
	return peakRSS, "peak-rss"
}

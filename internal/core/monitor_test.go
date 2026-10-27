package core

import (
	"context"
	"math"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"
)

const monitorTestOutput = `WORKLANE_MONITOR_V1
@@stat
cpu 100 20 30 400 50 6 7 8 90 5
cpu0 100 20 30 400 50 6 7 8 90 5
cpu1 100 20 30 400 50 6 7 8 90 5
@@memory
MemTotal: 1000 kB
MemFree: 100 kB
MemAvailable: 400 kB
Buffers: 50 kB
Cached: 200 kB
SReclaimable: 70 kB
Shmem: 20 kB
SwapTotal: 200 kB
SwapFree: 150 kB
@@uptime
1000.50 100.00
@@load
0.10 0.20 0.30 1/100 42
@@network
Inter-| Receive | Transmit
eth0: 1000 1 0 0 0 0 0 0 2000 1 0 0 0 0 0 0
lo: 999999 1 0 0 0 0 0 0 999999 1 0 0 0 0 0 0
@@disks
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/sda1 1000 600 300 67% /
tmpfs 1000 10 990 1% /run
server:/volume 2000 100 1900 5% /mnt/shared volume
@@end
`

func TestMonitorParsesLinuxMetrics(t *testing.T) {
	m, c, err := parseServerMetrics(monitorTestOutput)
	if err != nil {
		t.Fatal(err)
	}
	if m.CPUCores != 2 || c.total != 621 || c.idle != 450 {
		t.Fatalf("CPU counts include guest twice or wrong idle: %+v %+v", m, c)
	}
	if m.MemoryTotal != 1000*1024 || m.MemoryUsed != 600*1024 || m.SwapUsed != 50*1024 {
		t.Fatalf("incorrect memory: %+v", m)
	}
	if len(c.network) != 1 || c.network["eth0"].receive != 1000 {
		t.Fatalf("network includes loopback: %+v", c)
	}
	if len(m.Disks) != 2 || m.Disks[1].Mount != "/mnt/shared volume" || math.Abs(m.Disks[0].UsedPercent-600.0/900*100) > 0.001 {
		t.Fatalf("incorrect df reserved blocks/mount parsing: %+v", m.Disks)
	}
	if m.CPUPercent != nil || m.NetworkReceiveRate != nil {
		t.Fatal("first sample invented a rate")
	}
	if len(m.Warnings) != 0 {
		t.Fatal(m.Warnings)
	}
	fallback, _, err := parseServerMetrics(strings.ReplaceAll(monitorTestOutput, "MemAvailable: 400 kB\n", ""))
	if err != nil || fallback.MemoryUsed != 600*1024 {
		t.Fatalf("old kernel memory fallback: %+v %v", fallback, err)
	}
}

func TestMonitorRejectsIncompleteAndNonfiniteData(t *testing.T) {
	for _, raw := range []string{
		strings.ReplaceAll(monitorTestOutput, "@@end", ""),
		strings.ReplaceAll(monitorTestOutput, "MemTotal: 1000 kB", "MemTotal: invalid kB"),
		strings.ReplaceAll(monitorTestOutput, "cpu 100", "cpu -100"),
		strings.ReplaceAll(monitorTestOutput, "1000.50 100.00", "NaN 100.00"),
		strings.ReplaceAll(monitorTestOutput, "0.10 0.20 0.30", "+Inf 0.20 0.30"),
	} {
		if _, _, err := parseServerMetrics(raw); err == nil {
			t.Fatal("accepted corrupt monitor output")
		}
	}
	// Optional probes must leave CPU/memory available with explicit warnings.
	raw := strings.ReplaceAll(monitorTestOutput, "eth0:", "invalid:")
	raw = strings.ReplaceAll(raw, "1000 1 0 0 0 0 0 0 2000", "bad 1 0 0 0 0 0 0 bad")
	raw = strings.ReplaceAll(raw, "/dev/sda1 1000", "/dev/sda1 bad")
	raw = strings.ReplaceAll(raw, "server:/volume 2000", "server:/volume bad")
	m, _, err := parseServerMetrics(raw)
	if err != nil || len(m.Warnings) != 2 {
		t.Fatalf("optional probe failure lost required metrics: %+v %v", m, err)
	}
}

func TestMonitorRatesHandleCounterResetsAndGaps(t *testing.T) {
	before := &monitorCounters{total: 1000, idle: 500, uptime: 100, network: map[string]networkCounters{"eth0": {1000, 2000}}}
	current := &monitorCounters{total: 1200, idle: 650, uptime: 102, network: map[string]networkCounters{"eth0": {5000, 4000}, "new0": {999999, 999999}}}
	m := &ServerMetrics{}
	applyMonitorRates(m, current, before)
	if m.CPUPercent == nil || *m.CPUPercent != 25 || m.NetworkReceiveRate == nil || *m.NetworkReceiveRate != 2000 || *m.NetworkTransmitRate != 1000 {
		t.Fatalf("bad delta rates: %+v", m)
	}
	for _, test := range []string{"reset", "gap", "clock-reset"} {
		copy := *current
		switch test {
		case "reset":
			copy.total = 1
			copy.idle = 0
			copy.network = map[string]networkCounters{"eth0": {1, 1}}
		case "gap":
			copy.uptime = 200
		case "clock-reset":
			copy.uptime = 1
		}
		m := &ServerMetrics{}
		applyMonitorRates(m, &copy, before)
		if m.CPUPercent != nil || m.NetworkReceiveRate != nil {
			t.Fatalf("%s invented rates: %+v", test, m)
		}
	}
}

func TestMonitorOverSSHAndUnsupportedSystem(t *testing.T) {
	for _, mode := range []string{"monitor-ok", "monitor-unsupported"} {
		t.Run(mode, func(t *testing.T) {
			s := newTestSSH(t, mode)
			e := newTestEngine(t, nil)
			host := saveTestHost(t, e, s.host(), ptr("test-secret"))
			info := connectTestHost(t, e, s, host)
			value, err := e.Call("get_server_metrics", Arguments{SessionID: info.ID})
			if mode == "monitor-unsupported" {
				requireCode(t, err, "monitor_unsupported")
			} else if err != nil || value.(*ServerMetrics).MemoryUsed != 600*1024 {
				t.Fatalf("metrics RPC failed: %+v %v", value, err)
			}
			if _, err = e.DetectSystem(info.ID); err != nil {
				t.Fatalf("probe broke shared SSH transport: %v", err)
			}
			if err = e.Disconnect(info.ID); err != nil {
				t.Fatal(err)
			}
			_, err = e.ServerMetrics(info.ID)
			requireCode(t, err, "session_closed")
		})
	}
}

func TestMonitorTimeoutDoesNotCloseSharedSSH(t *testing.T) {
	for _, mode := range []string{"monitor-hang", "monitor-slow-open"} {
		t.Run(mode, func(t *testing.T) {
			s := newTestSSH(t, mode)
			e := newTestEngine(t, nil)
			host := saveTestHost(t, e, s.host(), ptr("test-secret"))
			info := connectTestHost(t, e, s, host)
			started := time.Now()
			_, err := e.serverMetrics(info.ID, 40*time.Millisecond)
			requireCode(t, err, "monitor_timeout")
			if time.Since(started) > time.Second {
				t.Fatal("probe ignored deadline")
			}
			if mode == "monitor-slow-open" {
				_, err = e.serverMetrics(info.ID, 40*time.Millisecond)
				requireCode(t, err, "monitor_busy")
			}
			if _, err = e.DetectSystem(info.ID); err != nil {
				t.Fatalf("timed-out monitor closed shared SSH: %v", err)
			}
		})
	}
}

func TestMonitorCommandOnLinux(t *testing.T) {
	image := os.Getenv("SSH_TOOLS_MONITOR_CONTAINER")
	if runtime.GOOS != "linux" && image == "" {
		t.Skip("read-only /proc probe requires Linux")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "sh", "-c", monitorCommand)
	if image != "" {
		command = exec.CommandContext(ctx, "docker", "run", "--rm", "--pull", "never", "--network", "none", "--read-only", "--entrypoint", "sh", image, "-c", monitorCommand)
	}
	output, err := command.Output()
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = parseServerMetrics(string(output)); err != nil {
		t.Fatalf("real Linux probe failed: %v", err)
	}
	if len(output) > 65536 {
		t.Fatalf("real Linux output exceeds SSH probe limit: %d bytes", len(output))
	}
}

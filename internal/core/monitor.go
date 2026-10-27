package core

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// A fixed, read-only command; no host configuration or user input is interpolated.
// Separate sections let optional disk/network probes fail without losing CPU/RAM.
const monitorCommand = `export LC_ALL=C
if [ "$(uname -s)" != Linux ]; then printf 'WORKLANE_UNSUPPORTED\n'; exit 42; fi
printf 'WORKLANE_MONITOR_V1\n'
printf '\n@@stat\n'; cat /proc/stat
printf '\n@@memory\n'; cat /proc/meminfo
printf '\n@@uptime\n'; cat /proc/uptime
printf '\n@@load\n'; cat /proc/loadavg
printf '\n@@network\n'; cat /proc/net/dev 2>/dev/null
printf '\n@@disks\n'; df -Pk 2>/dev/null
printf '\n@@end\n'
`

type ServerMetrics struct {
	SampledAt           int64        `json:"sampledAt"`
	CPUPercent          *float64     `json:"cpuPercent"`
	CPUCores            int          `json:"cpuCores"`
	MemoryTotal         uint64       `json:"memoryTotal"`
	MemoryUsed          uint64       `json:"memoryUsed"`
	MemoryAvailable     uint64       `json:"memoryAvailable"`
	SwapTotal           uint64       `json:"swapTotal"`
	SwapUsed            uint64       `json:"swapUsed"`
	UptimeSeconds       float64      `json:"uptimeSeconds"`
	Load                []float64    `json:"load"`
	NetworkReceiveRate  *float64     `json:"networkReceiveRate"`
	NetworkTransmitRate *float64     `json:"networkTransmitRate"`
	Disks               []ServerDisk `json:"disks"`
	Warnings            []string     `json:"warnings"`
}

type ServerDisk struct {
	Filesystem  string  `json:"filesystem"`
	Mount       string  `json:"mount"`
	Total       uint64  `json:"total"`
	Used        uint64  `json:"used"`
	Available   uint64  `json:"available"`
	UsedPercent float64 `json:"usedPercent"`
}

type networkCounters struct{ receive, transmit uint64 }
type monitorCounters struct {
	total, idle uint64
	uptime      float64
	network     map[string]networkCounters
}

// One probe per connection, including timed-out work. A slow monitor channel
// never closes the shared SSH transport used by terminals and file transfers.
func (e *Engine) ServerMetrics(id string) (*ServerMetrics, error) {
	return e.serverMetrics(id, 5*time.Second)
}

func (e *Engine) serverMetrics(id string, timeout time.Duration) (*ServerMetrics, error) {
	s, err := e.session(id)
	if err != nil {
		return nil, err
	}
	if !s.monitorMu.TryLock() {
		return nil, fail("monitor_busy", "上一次监控采样仍在结束，请稍后重试")
	}
	e.mu.Lock()
	if e.ctx.Err() != nil || s.ctx.Err() != nil {
		e.mu.Unlock()
		s.monitorMu.Unlock()
		return nil, fail("session_closed", "SSH 连接已断开")
	}
	e.wg.Add(1)
	e.mu.Unlock()
	ctx, cancel := context.WithTimeout(s.ctx, timeout)
	defer cancel()
	type result struct {
		metrics *ServerMetrics
		err     error
	}
	done := make(chan result, 1)
	go func() {
		defer e.wg.Done()
		defer s.monitorMu.Unlock()
		var answer result
		defer func() { done <- answer }()
		channel, err := s.client.NewSession()
		if err != nil {
			answer.err = fail("monitor_unavailable", "无法打开服务器监控通道")
			return
		}
		defer channel.Close()
		if ctx.Err() != nil {
			answer.err = ctx.Err()
			return
		}
		stop := context.AfterFunc(ctx, func() { _ = channel.Close() })
		defer stop()
		var output boundedOutput
		channel.Stdout = &output
		// Never parse command diagnostics as measurements.
		var diagnostics boundedOutput
		channel.Stderr = &diagnostics
		err = channel.Run(monitorCommand)
		raw := output.String()
		if strings.Contains(raw, "WORKLANE_UNSUPPORTED") {
			answer.err = fail("monitor_unsupported", "实时监控暂仅支持 Linux 服务器")
			return
		}
		if err != nil {
			answer.err = fail("monitor_unavailable", "监控采样失败，请确认服务器允许执行命令并可读取 /proc")
			return
		}
		metrics, counters, err := parseServerMetrics(raw)
		if err != nil {
			answer.err = fail("monitor_unavailable", "服务器监控数据不完整或格式不受支持")
			return
		}
		if ctx.Err() != nil {
			answer.err = ctx.Err()
			return
		}
		applyMonitorRates(metrics, counters, s.monitorPrevious)
		s.monitorPrevious = counters
		answer.metrics = metrics
	}()
	select {
	case result := <-done:
		if ctx.Err() != nil {
			return nil, monitorContextError(s)
		}
		return result.metrics, result.err
	case <-ctx.Done():
		return nil, monitorContextError(s)
	}
}

func monitorContextError(s *connection) error {
	if s.ctx.Err() != nil {
		return fail("session_closed", "SSH 连接已断开")
	}
	return fail("monitor_timeout", "监控采样超时，可稍后重试；终端连接保持可用")
}

func parseServerMetrics(raw string) (*ServerMetrics, *monitorCounters, error) {
	invalid := fmt.Errorf("invalid monitor data")
	sections := map[string][]string{}
	section := ""
	header, ended := false, false
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "WORKLANE_MONITOR_V1" {
			header = true
			continue
		}
		if strings.HasPrefix(line, "@@") {
			section = strings.TrimPrefix(line, "@@")
			if section == "end" {
				ended = true
			}
			continue
		}
		if line != "" && section != "" {
			sections[section] = append(sections[section], line)
		}
	}
	if !header || !ended {
		return nil, nil, invalid
	}
	m := &ServerMetrics{SampledAt: time.Now().UnixMilli(), Load: []float64{}, Disks: []ServerDisk{}, Warnings: []string{}}
	c := &monitorCounters{network: map[string]networkCounters{}}
	for _, line := range sections["stat"] {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if fields[0] == "cpu" {
			if len(fields) < 5 {
				return nil, nil, invalid
			}
			// guest and guest_nice are already included in user/nice.
			for i := 1; i < len(fields) && i <= 8; i++ {
				n, err := strconv.ParseUint(fields[i], 10, 64)
				if err != nil || math.MaxUint64-c.total < n {
					return nil, nil, invalid
				}
				c.total += n
				if i == 4 || i == 5 {
					c.idle += n
				}
			}
		} else if strings.HasPrefix(fields[0], "cpu") {
			if _, err := strconv.ParseUint(strings.TrimPrefix(fields[0], "cpu"), 10, 32); err == nil {
				m.CPUCores++
			}
		}
	}
	memory := map[string]uint64{}
	for _, line := range sections["memory"] {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		n, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil || n > math.MaxUint64/1024 {
			return nil, nil, invalid
		}
		memory[strings.TrimSuffix(fields[0], ":")] = n * 1024
	}
	m.MemoryTotal = memory["MemTotal"]
	available, ok := memory["MemAvailable"]
	if !ok {
		if _, exists := memory["MemFree"]; !exists {
			return nil, nil, invalid
		}
		for _, key := range []string{"MemFree", "Buffers", "Cached", "SReclaimable"} {
			available += min(memory[key], m.MemoryTotal-min(available, m.MemoryTotal))
		}
		available -= min(available, memory["Shmem"])
	}
	m.MemoryAvailable = min(available, m.MemoryTotal)
	m.MemoryUsed = m.MemoryTotal - m.MemoryAvailable
	m.SwapTotal = memory["SwapTotal"]
	m.SwapUsed = m.SwapTotal - min(memory["SwapFree"], m.SwapTotal)
	if len(sections["uptime"]) != 1 || len(sections["load"]) != 1 {
		return nil, nil, invalid
	}
	uptime := strings.Fields(sections["uptime"][0])
	load := strings.Fields(sections["load"][0])
	if len(uptime) < 1 || len(load) < 3 {
		return nil, nil, invalid
	}
	var err error
	c.uptime, err = strconv.ParseFloat(uptime[0], 64)
	if err != nil || math.IsNaN(c.uptime) || math.IsInf(c.uptime, 0) || c.uptime < 0 {
		return nil, nil, invalid
	}
	m.UptimeSeconds = c.uptime
	for _, v := range load[:3] {
		n, err := strconv.ParseFloat(v, 64)
		if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 {
			return nil, nil, invalid
		}
		m.Load = append(m.Load, n)
	}
	if c.total == 0 || m.CPUCores == 0 || m.MemoryTotal == 0 {
		return nil, nil, invalid
	}
	for _, line := range sections["network"] {
		name, values, ok := strings.Cut(line, ":")
		if !ok || strings.TrimSpace(name) == "lo" {
			continue
		}
		fields := strings.Fields(values)
		if len(fields) < 16 {
			continue
		}
		rx, e1 := strconv.ParseUint(fields[0], 10, 64)
		tx, e2 := strconv.ParseUint(fields[8], 10, 64)
		if e1 == nil && e2 == nil {
			c.network[strings.TrimSpace(name)] = networkCounters{rx, tx}
		}
	}
	if len(c.network) == 0 {
		m.Warnings = append(m.Warnings, "网络采样不可用：未读取到非回环网卡")
	}
	for _, line := range sections["disks"] {
		fields := strings.Fields(line)
		if len(fields) < 6 || fields[0] == "Filesystem" {
			continue
		}
		mount := strings.Join(fields[5:], " ")
		// Hide virtual filesystems; retain the root volume, device-backed volumes
		// and network filesystems mounted outside /proc, /sys and /dev.
		if fields[0] == "tmpfs" || fields[0] == "devtmpfs" || mount == "/dev" || strings.HasPrefix(mount, "/proc") || strings.HasPrefix(mount, "/sys") || strings.HasPrefix(mount, "/dev/") {
			continue
		}
		total, e1 := strconv.ParseUint(fields[1], 10, 64)
		used, e2 := strconv.ParseUint(fields[2], 10, 64)
		free, e3 := strconv.ParseUint(fields[3], 10, 64)
		if e1 != nil || e2 != nil || e3 != nil || total == 0 || total > math.MaxUint64/1024 || used > total || free > total {
			continue
		}
		// Match df: reserved blocks are excluded from space available to the user.
		percent := float64(used) / math.Max(1, float64(used)+float64(free)) * 100
		m.Disks = append(m.Disks, ServerDisk{fields[0], mount, total * 1024, used * 1024, free * 1024, min(100, percent)})
	}
	if len(m.Disks) == 0 {
		m.Warnings = append(m.Warnings, "磁盘采样不可用：df 未返回可用分区")
	}
	return m, c, nil
}

func applyMonitorRates(m *ServerMetrics, current, previous *monitorCounters) {
	if previous == nil || current.uptime <= previous.uptime {
		return
	}
	// Gaps from a hidden/paused panel start a new baseline, not an apparent live rate.
	elapsed := current.uptime - previous.uptime
	if elapsed > 15 {
		return
	}
	if current.total > previous.total && current.idle >= previous.idle {
		total, idle := current.total-previous.total, current.idle-previous.idle
		if idle <= total {
			v := float64(total-idle) / float64(total) * 100
			m.CPUPercent = &v
		}
	}
	var rx, tx float64
	matched := false
	for name, counters := range current.network {
		before, ok := previous.network[name]
		if !ok || counters.receive < before.receive || counters.transmit < before.transmit {
			continue
		}
		rx += float64(counters.receive-before.receive) / elapsed
		tx += float64(counters.transmit-before.transmit) / elapsed
		matched = true
	}
	if matched {
		m.NetworkReceiveRate = &rx
		m.NetworkTransmitRate = &tx
	}
}

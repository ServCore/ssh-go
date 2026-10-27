package core

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

func homeDirectory() (string, error) { return os.UserHomeDir() }
func (e *Engine) resourceSnapshot() any {
	e.metricsMu.Lock()
	defer e.metricsMu.Unlock()
	cpu, memory, kind, supported := processUsage()
	now := time.Now()
	var percent any
	if supported && now.After(e.metricTime) {
		percent = max(0, (cpu-e.metricCPU)/now.Sub(e.metricTime).Seconds()*100)
	}
	e.metricCPU = cpu
	e.metricTime = now
	description := map[string]string{
		"footprint":   "当前物理占用",
		"rss":         "当前 RSS",
		"peak-rss":    "峰值 RSS（当前采样不可用）",
		"go-runtime":  "Go 运行时保留内存（非进程总内存）",
		"unavailable": "采样不可用",
	}[kind]
	return map[string]any{"cpuPercent": percent, "memoryBytes": memory, "memoryKind": kind, "processCount": 1, "scope": "Go 主进程（含原生窗口）；内存为" + description + "，不含 WebView"}
}

type boundedOutput struct {
	buffer bytes.Buffer
	mu     sync.Mutex
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.buffer.Len()+len(p) > 65536 {
		return 0, fmt.Errorf("系统检测输出超出限制")
	}
	return b.buffer.Write(p)
}
func (b *boundedOutput) String() string { b.mu.Lock(); defer b.mu.Unlock(); return b.buffer.String() }
func (e *Engine) DetectSystem(id string) (*RemoteSystem, error) {
	s, err := e.session(id)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(s.ctx, 5*time.Second)
	defer cancel()
	stopOpening := context.AfterFunc(ctx, s.close)
	channel, err := s.client.NewSession()
	stopOpening()
	if err != nil {
		return nil, err
	}
	defer channel.Close()
	done := make(chan struct{})
	defer close(done)
	stop := context.AfterFunc(ctx, func() {
		_ = channel.Close()
		select {
		case <-done:
		case <-time.After(time.Second):
			s.close()
		}
	})
	defer stop()
	var output boundedOutput
	channel.Stdout = &output
	channel.Stderr = &output
	err = channel.Run("if [ -r /etc/os-release ]; then cat /etc/os-release; elif command -v sw_vers >/dev/null 2>&1; then sw_vers; else uname -s; fi")
	if err != nil {
		return nil, fail("probe_unavailable", "服务器系统检测不可用")
	}
	result := &RemoteSystem{}
	text := output.String()
	for _, line := range strings.Split(text, "\n") {
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		value = strings.Trim(value, "\"'\r ")
		switch key {
		case "ID":
			result.ID = value
		case "NAME":
			result.Name = value
		case "VERSION_ID":
			result.Version = ptr(value)
		}
	}
	if result.ID == "" {
		if strings.Contains(text, "ProductName:") || strings.TrimSpace(text) == "Darwin" {
			result.ID = "macos"
			result.Name = "macOS"
			for _, line := range strings.Split(text, "\n") {
				if strings.HasPrefix(line, "ProductVersion:") {
					result.Version = ptr(strings.TrimSpace(strings.TrimPrefix(line, "ProductVersion:")))
				}
			}
		} else if strings.Contains(text, "Windows") || strings.Contains(text, "MINGW") {
			result.ID = "windows"
			result.Name = "Windows"
		} else {
			return nil, nil
		}
	}
	if len(result.ID) > 128 || len(result.Name) > 256 || result.Version != nil && (len(*result.Version) > 128 || hasControls(*result.Version)) || hasControls(result.ID) || hasControls(result.Name) {
		return nil, nil
	}
	if result.Name == "" {
		result.Name = result.ID
	}
	err = e.Store.mutate(func(d *persisted) error {
		for i, h := range d.Hosts {
			if h.ID == s.host.ID && identity(h, s.host) {
				d.Hosts[i].RemoteSystem = result
				return nil
			}
		}
		return nil
	})
	return result, err
}

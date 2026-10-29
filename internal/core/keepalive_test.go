package core

import (
	"strings"
	"testing"
	"time"
)

func TestKeepaliveRejectionsKeepIdleConnectionAlive(t *testing.T) {
	s := newTestSSH(t)
	closed := make(chan string, 4)
	e := newTestEngine(t, func(name string, value any) {
		if name == "session-closed" {
			closed <- value.(map[string]any)["reason"].(string)
		}
	})
	h := saveTestHost(t, e, s.host(), ptr("test-secret"))
	info := connectTestHost(t, e, s, h)
	connection, err := e.session(info.ID)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { e.keepalive(connection, 5*time.Millisecond, time.Second); close(done) }()
	for range 3 {
		select {
		case <-s.keepalives:
		case <-time.After(2 * time.Second):
			t.Fatal("idle connection was not probed")
		}
	}
	if _, err = e.session(info.ID); err != nil {
		t.Fatal("negative keepalive reply closed a live session", err)
	}
	select {
	case reason := <-closed:
		t.Fatal("healthy idle session closed:", reason)
	default:
	}
	if err = e.Disconnect(info.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("keepalive did not stop after disconnect")
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("missing close event")
	}
	select {
	case reason := <-closed:
		t.Fatal("duplicate close event:", reason)
	default:
	}
}

func TestKeepaliveTimeoutClosesSilentTransport(t *testing.T) {
	s := newTestSSH(t, "no-keepalive")
	closed := make(chan string, 4)
	e := newTestEngine(t, func(name string, value any) {
		if name == "session-closed" {
			closed <- value.(map[string]any)["reason"].(string)
		}
	})
	h := saveTestHost(t, e, s.host(), ptr("test-secret"))
	info := connectTestHost(t, e, s, h)
	connection, err := e.session(info.ID)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { e.keepalive(connection, 5*time.Millisecond, 40*time.Millisecond); close(done) }()
	select {
	case reason := <-closed:
		if !strings.Contains(reason, "无响应") {
			t.Fatal("timeout reason lost:", reason)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("silent transport was not reported closed")
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("keepalive request leaked after timeout")
	}
	if _, err = e.session(info.ID); err == nil {
		t.Fatal("timed-out session still usable")
	}
	select {
	case reason := <-closed:
		t.Fatal("duplicate close event:", reason)
	default:
	}
}

func TestKeepalivePendingProbeStopsOnEngineClose(t *testing.T) {
	s := newTestSSH(t, "no-keepalive")
	e := newTestEngine(t, nil)
	h := saveTestHost(t, e, s.host(), ptr("test-secret"))
	info := connectTestHost(t, e, s, h)
	connection, err := e.session(info.ID)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { e.keepalive(connection, 5*time.Millisecond, time.Hour); close(done) }()
	select {
	case <-s.keepalives:
	case <-time.After(time.Second):
		t.Fatal("probe did not start")
	}
	engineClosed := make(chan struct{})
	go func() { e.Close(); close(engineClosed) }()
	select {
	case <-engineClosed:
	case <-time.After(2 * time.Second):
		t.Fatal("engine close blocked on pending probe")
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("probe did not stop on cancellation")
	}
}

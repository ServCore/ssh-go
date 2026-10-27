package core

import (
	"context"
	"io"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

const terminalWindow = 256 * 1024

type terminal struct {
	info        TerminalInfo
	session     *ssh.Session
	stdin       io.WriteCloser
	ctx         context.Context
	cancel      context.CancelFunc
	writeMu     sync.Mutex
	mu          sync.Mutex
	cond        *sync.Cond
	outstanding int
	eventName   string
	emit        func(string, any)
	once        sync.Once
}

func (t *terminal) close() { t.once.Do(func() { t.cancel(); _ = t.session.Close() }) }
func (t *terminal) Write(p []byte) (int, error) {
	written := 0
	for len(p) > 0 {
		n := min(len(p), 16384)
		t.mu.Lock()
		for t.outstanding+n > terminalWindow && t.ctx.Err() == nil {
			t.cond.Wait()
		}
		if t.ctx.Err() != nil {
			t.mu.Unlock()
			return written, io.ErrClosedPipe
		}
		t.outstanding += n
		t.mu.Unlock()
		data := make([]int, n)
		for i, b := range p[:n] {
			data[i] = int(b)
		}
		t.emit(t.eventName, map[string]any{"kind": "output", "data": data})
		written += n
		p = p[n:]
	}
	return written, nil
}
func dimensions(cols, rows int) error {
	if cols < 1 || cols > 1000 || rows < 1 || rows > 1000 {
		return fail("invalid_terminal_size", "终端尺寸必须在 1 到 1000 之间")
	}
	return nil
}
func (e *Engine) OpenTerminal(sessionID string, cols, rows int, eventName string) (TerminalInfo, error) {
	if err := dimensions(cols, rows); err != nil {
		return TerminalInfo{}, err
	}
	if !strings.HasPrefix(eventName, "terminal:") || len(eventName) > 128 {
		return TerminalInfo{}, fail("invalid_terminal_event", "终端事件标识无效")
	}
	s, err := e.session(sessionID)
	if err != nil {
		return TerminalInfo{}, err
	}
	opening, stopOpening := context.WithTimeout(s.ctx, 15*time.Second)
	defer stopOpening()
	stopWatchdog := context.AfterFunc(opening, s.close)
	defer stopWatchdog()
	channel, err := s.client.NewSession()
	if err != nil {
		return TerminalInfo{}, err
	}
	ctx, cancel := context.WithCancel(s.ctx)
	t := &terminal{info: TerminalInfo{ID: newID(), SessionID: sessionID}, session: channel, ctx: ctx, cancel: cancel, eventName: eventName, emit: e.emit}
	t.cond = sync.NewCond(&t.mu)
	stop := context.AfterFunc(ctx, func() { t.mu.Lock(); t.cond.Broadcast(); t.mu.Unlock(); _ = channel.Close() })
	channel.Stdout = t
	channel.Stderr = t
	t.stdin, err = channel.StdinPipe()
	if err == nil {
		err = channel.RequestPty("xterm-256color", rows, cols, ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 14400, ssh.TTY_OP_OSPEED: 14400})
	}
	if err == nil {
		err = channel.Shell()
	}
	if err != nil {
		t.close()
		stop()
		return TerminalInfo{}, err
	}
	e.mu.Lock()
	if ctx.Err() != nil {
		e.mu.Unlock()
		t.close()
		stop()
		return TerminalInfo{}, fail("session_closed", "SSH 连接已断开")
	}
	e.terminals[t.info.ID] = t
	e.wg.Add(1)
	e.mu.Unlock()
	go func() {
		defer e.wg.Done()
		err := channel.Wait()
		t.close()
		stop()
		e.mu.Lock()
		delete(e.terminals, t.info.ID)
		e.mu.Unlock()
		reason := "终端已关闭"
		if err != nil && s.ctx.Err() == nil {
			reason = err.Error()
		}
		e.emit(eventName, map[string]any{"kind": "closed", "reason": reason})
	}()
	return t.info, nil
}
func (e *Engine) terminal(id string) (*terminal, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	t := e.terminals[id]
	if t == nil || t.ctx.Err() != nil {
		return nil, fail("terminal_closed", "终端已关闭")
	}
	return t, nil
}
func (e *Engine) WriteTerminal(id string, data []int) error {
	if len(data) > 65536 {
		return fail("terminal_input_too_large", "单次终端输入超出限制")
	}
	t, err := e.terminal(id)
	if err != nil {
		return err
	}
	b := make([]byte, len(data))
	for i, v := range data {
		if v < 0 || v > 255 {
			return fail("invalid_terminal_data", "终端输入不是字节序列")
		}
		b[i] = byte(v)
	}
	t.writeMu.Lock()
	defer t.writeMu.Unlock()
	_, err = t.stdin.Write(b)
	return err
}
func (e *Engine) ResizeTerminal(id string, cols, rows int) error {
	if err := dimensions(cols, rows); err != nil {
		return err
	}
	t, err := e.terminal(id)
	if err != nil {
		return err
	}
	return t.session.WindowChange(rows, cols)
}
func (e *Engine) AckTerminal(id string, n int) error {
	t, err := e.terminal(id)
	if err != nil {
		return err
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if n < 0 || n > t.outstanding {
		return fail("invalid_terminal_ack", "终端确认字节数无效")
	}
	t.outstanding -= n
	t.cond.Broadcast()
	return nil
}
func (e *Engine) CloseTerminal(id string) error {
	e.mu.Lock()
	t := e.terminals[id]
	e.mu.Unlock()
	if t != nil {
		t.close()
	}
	return nil
}

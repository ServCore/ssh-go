package core

import (
	"context"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
)

type forward struct {
	info     ForwardInfo
	listener net.Listener
	ctx      context.Context
	cancel   context.CancelFunc
	once     sync.Once
}

func (f *forward) close() { f.once.Do(func() { f.cancel(); _ = f.listener.Close() }) }
func (e *Engine) ListForwards(sessionID string) ([]ForwardInfo, error) {
	if _, err := e.session(sessionID); err != nil {
		return nil, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	out := []ForwardInfo{}
	for _, f := range e.forwards {
		if f.info.SessionID == sessionID {
			out = append(out, f.info)
		}
	}
	return out, nil
}
func (e *Engine) StartForward(sessionID, host string, port, local int) (ForwardInfo, error) {
	if port < 1 || port > 65535 || local < 0 || local > 65535 || host == "" || len(host) > 512 || strings.ContainsAny(host, " /\\\t\r\n") || hasControls(host) {
		return ForwardInfo{}, fail("invalid_forward", "端口转发地址或端口无效")
	}
	s, err := e.session(sessionID)
	if err != nil {
		return ForwardInfo{}, err
	}
	l, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(local)))
	if err != nil {
		return ForwardInfo{}, err
	}
	ctx, cancel := context.WithCancel(s.ctx)
	f := &forward{info: ForwardInfo{ID: newID(), SessionID: sessionID, LocalPort: l.Addr().(*net.TCPAddr).Port, RemoteHost: host, RemotePort: port}, listener: l, ctx: ctx, cancel: cancel}
	e.mu.Lock()
	if ctx.Err() != nil {
		e.mu.Unlock()
		f.close()
		return ForwardInfo{}, fail("session_closed", "SSH 连接已断开")
	}
	if len(e.forwards) >= 128 {
		e.mu.Unlock()
		f.close()
		return ForwardInfo{}, fail("forward_limit", "端口转发数量已达上限")
	}
	e.forwards[f.info.ID] = f
	e.wg.Add(1)
	e.mu.Unlock()
	go func() {
		defer e.wg.Done()
		stop := context.AfterFunc(ctx, func() { _ = l.Close() })
		defer stop()
		defer f.close()
		defer func() { e.mu.Lock(); delete(e.forwards, f.info.ID); e.mu.Unlock() }()
		for {
			client, err := l.Accept()
			if err != nil {
				return
			}
			e.wg.Add(1)
			go func() {
				defer e.wg.Done()
				defer client.Close()
				stop := context.AfterFunc(ctx, func() { _ = client.Close() })
				defer stop()
				remote, err := s.client.DialContext(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(port)))
				if err != nil {
					return
				}
				defer remote.Close()
				stopRemote := context.AfterFunc(ctx, func() { _ = remote.Close() })
				defer stopRemote()
				done := make(chan struct{})
				go func() {
					_, _ = io.Copy(remote, client)
					if c, ok := remote.(interface{ CloseWrite() error }); ok {
						_ = c.CloseWrite()
					}
					close(done)
				}()
				_, _ = io.Copy(client, remote)
				_ = client.Close()
				_ = remote.Close()
				<-done
			}()
		}
	}()
	return f.info, nil
}
func (e *Engine) StopForward(id string) error {
	e.mu.Lock()
	f := e.forwards[id]
	delete(e.forwards, id)
	e.mu.Unlock()
	if f != nil {
		f.close()
	}
	return nil
}

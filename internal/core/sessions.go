package core

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"strconv"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

type connection struct {
	info            SessionInfo
	host            Host
	client          *ssh.Client
	chain           []*ssh.Client
	ctx             context.Context
	cancel          context.CancelFunc
	once            sync.Once
	monitorMu       sync.Mutex
	monitorPrevious *monitorCounters
}

func (s *connection) close() {
	s.once.Do(func() {
		s.cancel()
		for i := len(s.chain) - 1; i >= 0; i-- {
			_ = s.chain[i].Close()
		}
	})
}
func (e *Engine) session(id string) (*connection, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	s := e.sessions[id]
	if s == nil || s.ctx.Err() != nil {
		return nil, fail("session_closed", "SSH 连接已断开")
	}
	return s, nil
}

func (e *Engine) CancelConnection(id string) {
	if id == "" {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if cancel := e.requests[id]; cancel != nil {
		cancel()
	}
	for key, t := range e.cancelled {
		if time.Since(t) > time.Minute {
			delete(e.cancelled, key)
		}
	}
	if len(e.cancelled) < 4096 {
		e.cancelled[id] = time.Now()
	}
}

func (e *Engine) Connect(a Arguments) (SessionInfo, error) {
	ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second)
	defer cancel()
	if a.RequestID == "" {
		a.RequestID = newID()
	}
	e.mu.Lock()
	if ctx.Err() != nil {
		e.mu.Unlock()
		return SessionInfo{}, fail("connection_cancelled", "连接已取消")
	}
	if _, ok := e.cancelled[a.RequestID]; ok {
		e.mu.Unlock()
		return SessionInfo{}, fail("connection_cancelled", "连接已取消")
	}
	if _, ok := e.requests[a.RequestID]; ok {
		e.mu.Unlock()
		return SessionInfo{}, fail("invalid_request", "连接请求标识重复")
	}
	e.requests[a.RequestID] = cancel
	e.wg.Add(1)
	e.mu.Unlock()
	defer func() { e.mu.Lock(); delete(e.requests, a.RequestID); e.mu.Unlock(); e.wg.Done() }()
	info, err := e.connectChain(ctx, a)
	if ctx.Err() != nil {
		if info.ID != "" {
			_ = e.Disconnect(info.ID)
		}
		if errors.Is(ctx.Err(), context.Canceled) {
			return SessionInfo{}, fail("connection_cancelled", "连接已取消")
		}
		return SessionInfo{}, fail("connection_timeout", "SSH 连接超时")
	}
	return info, err
}

func (e *Engine) connectChain(ctx context.Context, a Arguments) (SessionInfo, error) {
	// Snapshot the graph so an edit during a handshake cannot change its route.
	hosts := e.Store.Hosts()
	if err := validateGraph(hosts); err != nil {
		return SessionInfo{}, err
	}
	byID := map[string]Host{}
	for _, h := range hosts {
		byID[h.ID] = h
	}
	target, ok := byID[a.HostID]
	if !ok {
		return SessionInfo{}, fail("host_not_found", "服务器配置不存在")
	}
	hops := []Host{}
	for h := target; ; {
		hops = append(hops, h)
		if h.JumpHostID == nil || *h.JumpHostID == "" {
			break
		}
		h = byID[*h.JumpHostID]
	}
	clients := []*ssh.Client{}
	published := false
	defer func() {
		if !published {
			for i := len(clients) - 1; i >= 0; i-- {
				_ = clients[i].Close()
			}
		}
	}()
	var fingerprint string
	for i := len(hops) - 1; i >= 0; i-- {
		h := hops[i]
		secret := ""
		var err error
		if h.ID == a.HostID && a.Password != nil {
			secret = *a.Password
		} else {
			secret, err = e.Store.Password(h)
		}
		if err != nil {
			return SessionInfo{}, err
		}
		auth, cleanup, err := authMethods(ctx, h, secret)
		if err != nil {
			return SessionInfo{}, err
		}
		address := net.JoinHostPort(h.Address, strconv.Itoa(h.Port))
		var raw net.Conn
		if len(clients) == 0 {
			raw, err = (&net.Dialer{}).DialContext(ctx, "tcp", address)
		} else {
			raw, err = clients[len(clients)-1].DialContext(ctx, "tcp", address)
		}
		if err != nil {
			cleanup()
			return SessionInfo{}, fail("ssh_connect_failed", "无法连接 "+address+"："+err.Error())
		}
		stop := context.AfterFunc(ctx, func() { _ = raw.Close() })
		if deadline, ok := ctx.Deadline(); ok {
			_ = raw.SetDeadline(deadline)
		}
		var trustErr error
		config := &ssh.ClientConfig{User: h.Username, Auth: auth, HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			fingerprint = ssh.FingerprintSHA256(key)
			expected := e.Store.Fingerprint(h)
			if expected != "" && expected != fingerprint {
				trustErr = &AppError{Code: "host_key_changed", Message: "服务器指纹已变更，请先核对并在设置中移除旧指纹", Details: map[string]any{"hostId": h.ID, "address": h.Address, "port": h.Port, "fingerprint": fingerprint, "expectedFingerprint": expected}}
			} else if expected == "" {
				acceptedID := a.AcceptedHostID
				if acceptedID == "" {
					acceptedID = a.HostID
				}
				if acceptedID == h.ID && a.AcceptedFingerprint == fingerprint {
					trustErr = e.Store.Trust(h, fingerprint)
				} else {
					trustErr = &AppError{Code: "host_key_unknown", Message: "请核对服务器指纹", Details: map[string]any{"hostId": h.ID, "address": h.Address, "port": h.Port, "fingerprint": fingerprint}}
				}
			}
			return trustErr
		}}
		cc, chans, reqs, err := ssh.NewClientConn(raw, address, config)
		stop()
		cleanup()
		if err != nil {
			_ = raw.Close()
			if trustErr != nil {
				return SessionInfo{}, trustErr
			}
			return SessionInfo{}, &AppError{Code: "ssh_auth_failed", Message: "SSH 握手或认证失败：" + err.Error(), Details: map[string]any{"hostId": h.ID}}
		}
		_ = raw.SetDeadline(time.Time{})
		client := ssh.NewClient(cc, chans, reqs)
		clients = append(clients, client)
		if ctx.Err() != nil {
			return SessionInfo{}, ctx.Err()
		}
		current, lookupErr := e.Store.Host(h.ID)
		if lookupErr != nil {
			return SessionInfo{}, lookupErr
		}
		if !identity(current, h) {
			return SessionInfo{}, fail("host_changed", "连接配置已变更，请重新连接")
		}
		// Persist supplied credentials only after this hop authenticates, and only
		// while its identity still matches the configuration snapshot.
		if h.ID == a.HostID && a.Password != nil && *a.Password != "" {
			if err = e.Store.saveAuthenticatedSecret(h, *a.Password); err != nil {
				return SessionInfo{}, err
			}
		}
	}
	sctx, scancel := context.WithCancel(e.ctx)
	info := SessionInfo{ID: newID(), HostID: target.ID, HostName: target.Name, Fingerprint: fingerprint}
	s := &connection{info: info, host: target, client: clients[len(clients)-1], chain: clients, ctx: sctx, cancel: scancel}
	e.mu.Lock()
	if ctx.Err() != nil || e.ctx.Err() != nil {
		e.mu.Unlock()
		scancel()
		return SessionInfo{}, context.Canceled
	}
	e.sessions[info.ID] = s
	published = true
	e.wg.Add(1)
	e.mu.Unlock()
	go func() { defer e.wg.Done(); _ = s.client.Wait(); e.removeSession(s, "SSH 连接已断开") }()
	return info, nil
}

func authMethods(ctx context.Context, h Host, secret string) ([]ssh.AuthMethod, func(), error) {
	noop := func() {}
	switch h.AuthMethod {
	case "", "password":
		return []ssh.AuthMethod{ssh.Password(secret), ssh.KeyboardInteractive(func(_, _ string, q []string, _ []bool) ([]string, error) {
			if len(q) > 1 {
				return nil, fmt.Errorf("需要交互式多因素认证")
			}
			out := make([]string, len(q))
			for i := range out {
				out[i] = secret
			}
			return out, nil
		})}, noop, nil
	case "privateKey":
		if h.PrivateKeyPath == nil {
			return nil, noop, fail("invalid_host", "缺少私钥路径")
		}
		b, err := readLimited(*h.PrivateKeyPath, 4<<20)
		if err != nil {
			return nil, noop, fail("private_key_error", "读取私钥失败："+err.Error())
		}
		defer clear(b)
		var signer ssh.Signer
		if secret == "" {
			signer, err = ssh.ParsePrivateKey(b)
		} else {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(b, []byte(secret))
			if err != nil {
				signer, err = ssh.ParsePrivateKey(b)
			}
		}
		if err != nil {
			var missing *ssh.PassphraseMissingError
			if errors.As(err, &missing) || secret != "" {
				return nil, noop, &AppError{Code: "key_passphrase_required", Message: "请输入正确的私钥口令", Details: map[string]any{"hostId": h.ID}}
			}
			return nil, noop, fail("private_key_error", "私钥格式不支持或已损坏")
		}
		return []ssh.AuthMethod{ssh.PublicKeys(signer)}, noop, nil
	case "agent":
		socket := os.Getenv("SSH_AUTH_SOCK")
		if socket == "" {
			return nil, noop, fail("ssh_agent_unavailable", "未找到 SSH Agent，请检查 SSH_AUTH_SOCK")
		}
		conn, err := (&net.Dialer{}).DialContext(ctx, "unix", socket)
		if err != nil {
			return nil, noop, fail("ssh_agent_unavailable", "无法连接 SSH Agent")
		}
		if deadline, ok := ctx.Deadline(); ok {
			_ = conn.SetDeadline(deadline)
		}
		stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
		return []ssh.AuthMethod{ssh.PublicKeysCallback(agent.NewClient(conn).Signers)}, func() { stop(); _ = conn.Close() }, nil
	default:
		return nil, noop, fail("invalid_host", "不支持的认证方式")
	}
}

func (e *Engine) removeSession(s *connection, reason string) {
	s.close()
	e.mu.Lock()
	if e.sessions[s.info.ID] != s {
		e.mu.Unlock()
		return
	}
	delete(e.sessions, s.info.ID)
	ts := []*terminal{}
	for _, t := range e.terminals {
		if t.info.SessionID == s.info.ID {
			ts = append(ts, t)
		}
	}
	fs := []*forward{}
	for id, f := range e.forwards {
		if f.info.SessionID == s.info.ID {
			fs = append(fs, f)
			delete(e.forwards, id)
		}
	}
	e.mu.Unlock()
	for _, t := range ts {
		t.close()
	}
	for _, f := range fs {
		f.close()
	}
	e.emit("session-closed", map[string]any{"sessionId": s.info.ID, "reason": reason})
}
func (e *Engine) Disconnect(id string) error {
	e.mu.Lock()
	s := e.sessions[id]
	e.mu.Unlock()
	if s != nil {
		e.removeSession(s, "连接已关闭")
	}
	return nil
}

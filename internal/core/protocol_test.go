package core

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

// The test server speaks real SSH and SFTP on loopback. Its shell echoes bytes;
// no subprocess, production server, user credential or existing data is used.
type testSSH struct {
	listener    net.Listener
	signer      ssh.Signer
	userKey     ssh.Signer
	userPrivate ed25519.PrivateKey
	root        string
	mu          sync.Mutex
	connections map[net.Conn]bool
	wg          sync.WaitGroup
	windows     chan [2]uint32
	noSFTP      bool
	noKeepalive bool
	keepalives  chan struct{}
	monitorMode string
}

func newTestSSH(t *testing.T, modes ...string) *testSSH {
	t.Helper()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(key)
	if err != nil {
		t.Fatal(err)
	}
	_, userKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	userSigner, err := ssh.NewSignerFromKey(userKey)
	if err != nil {
		t.Fatal(err)
	}
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s := &testSSH{listener: l, signer: signer, userKey: userSigner, userPrivate: userKey, root: t.TempDir(), connections: map[net.Conn]bool{}, windows: make(chan [2]uint32, 16), keepalives: make(chan struct{}, 16)}
	for _, mode := range modes {
		if mode == "no-keepalive" {
			s.noKeepalive = true
		}
		if mode == "no-sftp" {
			s.noSFTP = true
		}
		if strings.HasPrefix(mode, "monitor-") {
			s.monitorMode = mode
		}
	}
	config := &ssh.ServerConfig{PasswordCallback: func(_ ssh.ConnMetadata, p []byte) (*ssh.Permissions, error) {
		if string(p) != "test-secret" {
			return nil, fmt.Errorf("bad password")
		}
		return nil, nil
	}, PublicKeyCallback: func(_ ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
		if !bytes.Equal(key.Marshal(), userSigner.PublicKey().Marshal()) {
			return nil, fmt.Errorf("bad key")
		}
		return nil, nil
	}}
	config.AddHostKey(signer)
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		for {
			raw, err := l.Accept()
			if err != nil {
				return
			}
			s.mu.Lock()
			s.connections[raw] = true
			s.mu.Unlock()
			s.wg.Add(1)
			go func() {
				defer s.wg.Done()
				defer raw.Close()
				defer func() { s.mu.Lock(); delete(s.connections, raw); s.mu.Unlock() }()
				conn, channels, requests, err := ssh.NewServerConn(raw, config)
				if err != nil {
					return
				}
				defer conn.Close()
				s.wg.Add(1)
				go func() {
					defer s.wg.Done()
					for request := range requests {
						if request.Type == "keepalive@openssh.com" {
							select {
							case s.keepalives <- struct{}{}:
							default:
							}
							if s.noKeepalive {
								continue
							}
						}
						if request.WantReply {
							_ = request.Reply(false, nil)
						}
					}
				}()
				for ch := range channels {
					s.wg.Add(1)
					go func() { defer s.wg.Done(); s.handleChannel(ch) }()
				}
			}()
		}
	}()
	t.Cleanup(func() {
		_ = l.Close()
		s.mu.Lock()
		for conn := range s.connections {
			_ = conn.Close()
		}
		s.mu.Unlock()
		done := make(chan struct{})
		go func() { s.wg.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("SSH test server did not stop")
		}
	})
	return s
}
func (s *testSSH) handleChannel(newChannel ssh.NewChannel) {
	if newChannel.ChannelType() == "direct-tcpip" {
		var target struct {
			Host       string
			Port       uint32
			Origin     string
			OriginPort uint32
		}
		if err := ssh.Unmarshal(newChannel.ExtraData(), &target); err != nil || target.Host != "127.0.0.1" {
			_ = newChannel.Reject(ssh.Prohibited, "loopback only")
			return
		}
		remote, err := net.DialTimeout("tcp", net.JoinHostPort(target.Host, strconv.Itoa(int(target.Port))), time.Second)
		if err != nil {
			_ = newChannel.Reject(ssh.ConnectionFailed, err.Error())
			return
		}
		defer remote.Close()
		channel, requests, err := newChannel.Accept()
		if err != nil {
			return
		}
		defer channel.Close()
		go ssh.DiscardRequests(requests)
		done := make(chan struct{})
		go func() { _, _ = io.Copy(remote, channel); _ = remote.Close(); close(done) }()
		_, _ = io.Copy(channel, remote)
		_ = channel.Close()
		<-done
		return
	}
	if newChannel.ChannelType() != "session" {
		_ = newChannel.Reject(ssh.UnknownChannelType, "unsupported")
		return
	}
	if s.monitorMode == "monitor-slow-open" {
		time.Sleep(150 * time.Millisecond)
	}
	channel, requests, err := newChannel.Accept()
	if err != nil {
		return
	}
	defer channel.Close()
	for req := range requests {
		switch req.Type {
		case "pty-req":
			var p struct {
				Term                      string
				Cols, Rows, Width, Height uint32
				Modes                     string
			}
			_ = ssh.Unmarshal(req.Payload, &p)
			select {
			case s.windows <- [2]uint32{p.Cols, p.Rows}:
			default:
			}
			_ = req.Reply(true, nil)
		case "window-change":
			var p struct{ Cols, Rows, Width, Height uint32 }
			_ = ssh.Unmarshal(req.Payload, &p)
			select {
			case s.windows <- [2]uint32{p.Cols, p.Rows}:
			default:
			}
		case "shell":
			_ = req.Reply(true, nil)
			_, _ = io.WriteString(channel, "test shell ready\r\n")
			done := make(chan struct{})
			go func() { _, _ = io.Copy(channel, channel); close(done) }()
			for request := range requests {
				if request.Type == "window-change" {
					var size struct{ Cols, Rows, Width, Height uint32 }
					_ = ssh.Unmarshal(request.Payload, &size)
					select {
					case s.windows <- [2]uint32{size.Cols, size.Rows}:
					default:
					}
				}
			}
			_ = channel.Close()
			<-done
			return
		case "subsystem":
			if s.noSFTP {
				continue
			}
			var p struct{ Name string }
			_ = ssh.Unmarshal(req.Payload, &p)
			if p.Name != "sftp" {
				_ = req.Reply(false, nil)
				continue
			}
			_ = req.Reply(true, nil)
			server, err := sftp.NewServer(channel, sftp.WithServerWorkingDirectory(s.root))
			if err == nil {
				_ = server.Serve()
				_ = server.Close()
			}
			return
		case "exec":
			_ = req.Reply(true, nil)
			var command struct{ Command string }
			_ = ssh.Unmarshal(req.Payload, &command)
			if strings.Contains(command.Command, "WORKLANE_MONITOR_V1") && s.monitorMode != "" {
				if s.monitorMode == "monitor-hang" {
					for range requests {
					}
					return
				}
				status := uint32(0)
				output := monitorTestOutput
				if s.monitorMode == "monitor-unsupported" {
					output = "WORKLANE_UNSUPPORTED\n"
					status = 42
				}
				_, _ = io.WriteString(channel, output)
				_, _ = channel.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{status}))
				return
			}
			_, _ = io.WriteString(channel, "ID=ubuntu\nNAME=\"Ubuntu\"\nVERSION_ID=\"24.04\"\n")
			_, _ = channel.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{0}))
			return
		default:
			_ = req.Reply(false, nil)
		}
	}
}

func TestSFTPHandshakeDeadline(t *testing.T) {
	s := newTestSSH(t, "no-sftp")
	e := newTestEngine(t, nil)
	h := saveTestHost(t, e, s.host(), ptr("test-secret"))
	info := connectTestHost(t, e, s, h)
	ctx, cancel := context.WithTimeout(e.ctx, 100*time.Millisecond)
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := e.fileSystem(ctx, Endpoint{Kind: "remote", SessionID: info.ID}); done <- err }()
	select {
	case err := <-done:
		if err != context.DeadlineExceeded {
			t.Fatalf("want deadline, got %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("SFTP subsystem handshake ignored deadline")
	}
}
func (s *testSSH) host() Host {
	return Host{Name: "test", Address: "127.0.0.1", Port: s.listener.Addr().(*net.TCPAddr).Port, Username: "tester", AuthMethod: "password"}
}
func newTestEngine(t *testing.T, emit func(string, any)) *Engine {
	t.Helper()
	e, err := NewEngine(t.TempDir(), emit)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Close)
	return e
}
func saveTestHost(t *testing.T, e *Engine, h Host, secret *string) Host {
	t.Helper()
	h, err := e.Store.SaveHost(h, secret)
	if err != nil {
		t.Fatal(err)
	}
	return h
}
func connectTestHost(t *testing.T, e *Engine, s *testSSH, h Host) SessionInfo {
	t.Helper()
	if err := e.Store.Trust(h, ssh.FingerprintSHA256(s.signer.PublicKey())); err != nil {
		t.Fatal(err)
	}
	info, err := e.Connect(Arguments{HostID: h.ID, RequestID: newID()})
	if err != nil {
		t.Fatal(err)
	}
	return info
}
func requireCode(t *testing.T, err error, code string) {
	t.Helper()
	if err == nil || safeError(err).Code != code {
		t.Fatalf("want %s, got %v", code, err)
	}
}

func TestPasswordFingerprintAndSystem(t *testing.T) {
	s := newTestSSH(t)
	e := newTestEngine(t, nil)
	h := saveTestHost(t, e, s.host(), nil)
	_, err := e.Connect(Arguments{HostID: h.ID})
	requireCode(t, err, "password_required")
	_, err = e.Connect(Arguments{HostID: h.ID, Password: ptr("test-secret")})
	requireCode(t, err, "host_key_unknown")
	unknown := safeError(err)
	if unknown.Details["hostId"] != h.ID || unknown.Details["fingerprint"] != ssh.FingerprintSHA256(s.signer.PublicKey()) {
		t.Fatal("fingerprint details missing")
	}
	if e.Store.Fingerprint(h) != "" {
		t.Fatal("unknown host was auto-trusted")
	}
	_, err = e.Connect(Arguments{HostID: h.ID, Password: ptr("test-secret"), AcceptedFingerprint: "SHA256:wrong", AcceptedHostID: h.ID})
	requireCode(t, err, "host_key_unknown")
	info, err := e.Connect(Arguments{HostID: h.ID, Password: ptr("test-secret"), AcceptedFingerprint: unknown.Details["fingerprint"].(string), AcceptedHostID: h.ID})
	if err != nil {
		t.Fatal(err)
	}
	stored, _ := e.Store.Host(h.ID)
	if !stored.RememberPassword {
		t.Fatal("authenticated password was not persisted")
	}
	system, err := e.DetectSystem(info.ID)
	if err != nil || system == nil || system.ID != "ubuntu" {
		t.Fatalf("system: %v %v", system, err)
	}
	stored, _ = e.Store.Host(h.ID)
	if stored.RemoteSystem == nil {
		t.Fatal("system not cached")
	}
	if err = e.Disconnect(info.ID); err != nil {
		t.Fatal(err)
	}
	_, err = e.session(info.ID)
	requireCode(t, err, "session_closed")
}
func TestWrongPasswordNeverPersists(t *testing.T) {
	s := newTestSSH(t)
	e := newTestEngine(t, nil)
	h := saveTestHost(t, e, s.host(), nil)
	if err := e.Store.Trust(h, ssh.FingerprintSHA256(s.signer.PublicKey())); err != nil {
		t.Fatal(err)
	}
	_, err := e.Connect(Arguments{HostID: h.ID, Password: ptr("wrong")})
	requireCode(t, err, "ssh_auth_failed")
	_, err = e.Store.Password(h)
	requireCode(t, err, "password_required")
}
func TestChangedFingerprintRejected(t *testing.T) {
	s := newTestSSH(t)
	e := newTestEngine(t, nil)
	h := saveTestHost(t, e, s.host(), ptr("test-secret"))
	_ = e.Store.Trust(h, "SHA256:old")
	_, err := e.Connect(Arguments{HostID: h.ID, AcceptedFingerprint: ssh.FingerprintSHA256(s.signer.PublicKey()), AcceptedHostID: h.ID})
	requireCode(t, err, "host_key_changed")
	if e.Store.Fingerprint(h) != "SHA256:old" {
		t.Fatal("changed fingerprint overwrote trust")
	}
}
func TestConnectionCancellation(t *testing.T) {
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	accepted := make(chan net.Conn, 1)
	go func() {
		c, err := l.Accept()
		if err == nil {
			accepted <- c
		}
	}()
	e := newTestEngine(t, nil)
	h := saveTestHost(t, e, Host{Name: "blocked", Address: "127.0.0.1", Port: l.Addr().(*net.TCPAddr).Port, Username: "test"}, ptr("test-secret"))
	id := newID()
	done := make(chan error, 1)
	go func() { _, err := e.Connect(Arguments{HostID: h.ID, RequestID: id}); done <- err }()
	select {
	case c := <-accepted:
		defer c.Close()
	case <-time.After(3 * time.Second):
		t.Fatal("connection not attempted")
	}
	e.CancelConnection(id)
	select {
	case err := <-done:
		requireCode(t, err, "connection_cancelled")
	case <-time.After(3 * time.Second):
		t.Fatal("cancel did not interrupt handshake")
	}
	e.CancelConnection("before-start")
	_, err = e.Connect(Arguments{HostID: h.ID, RequestID: "before-start"})
	requireCode(t, err, "connection_cancelled")
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.sessions) != 0 || len(e.requests) != 0 {
		t.Fatal("cancelled connection retained resources")
	}
}
func TestJumpHostsConfirmIndependently(t *testing.T) {
	jump, target := newTestSSH(t), newTestSSH(t)
	e := newTestEngine(t, nil)
	j := saveTestHost(t, e, jump.host(), ptr("test-secret"))
	h := target.host()
	h.JumpHostID = ptr(j.ID)
	h = saveTestHost(t, e, h, ptr("test-secret"))
	_, err := e.Connect(Arguments{HostID: h.ID})
	requireCode(t, err, "host_key_unknown")
	if safeError(err).Details["hostId"] != j.ID {
		t.Fatal("jump host not confirmed first")
	}
	_, err = e.Connect(Arguments{HostID: h.ID, AcceptedHostID: j.ID, AcceptedFingerprint: ssh.FingerprintSHA256(jump.signer.PublicKey())})
	requireCode(t, err, "host_key_unknown")
	if safeError(err).Details["hostId"] != h.ID {
		t.Fatal("target identity skipped")
	}
	info, err := e.Connect(Arguments{HostID: h.ID, AcceptedHostID: h.ID, AcceptedFingerprint: ssh.FingerprintSHA256(target.signer.PublicKey())})
	if err != nil {
		t.Fatal(err)
	}
	if info.Fingerprint != ssh.FingerprintSHA256(target.signer.PublicKey()) {
		t.Fatal("wrong target fingerprint")
	}
}
func TestPrivateKeyAndAgentAuthentication(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(fmt.Sprint("private-key-", encrypted), func(t *testing.T) {
			s := newTestSSH(t)
			e := newTestEngine(t, nil)
			var block *pem.Block
			var err error
			if encrypted {
				block, err = ssh.MarshalPrivateKeyWithPassphrase(s.userPrivate, "test", []byte("key-passphrase"))
			} else {
				block, err = ssh.MarshalPrivateKey(s.userPrivate, "test")
			}
			if err != nil {
				t.Fatal(err)
			}
			name := filepath.Join(t.TempDir(), "id_ed25519")
			if err = os.WriteFile(name, pem.EncodeToMemory(block), 0600); err != nil {
				t.Fatal(err)
			}
			h := s.host()
			h.AuthMethod = "privateKey"
			h.PrivateKeyPath = ptr(name)
			h = saveTestHost(t, e, h, nil)
			if err = e.Store.Trust(h, ssh.FingerprintSHA256(s.signer.PublicKey())); err != nil {
				t.Fatal(err)
			}
			if encrypted {
				_, err = e.Connect(Arguments{HostID: h.ID})
				requireCode(t, err, "key_passphrase_required")
				_, err = e.Connect(Arguments{HostID: h.ID, Password: ptr("wrong")})
				requireCode(t, err, "key_passphrase_required")
				if _, err = e.Connect(Arguments{HostID: h.ID, Password: ptr("key-passphrase")}); err != nil {
					t.Fatal(err)
				}
			} else if _, err = e.Connect(Arguments{HostID: h.ID}); err != nil {
				t.Fatal(err)
			}
		})
	}
	t.Run("agent", func(t *testing.T) {
		s := newTestSSH(t)
		dir, err := os.MkdirTemp("/tmp", "worklane-agent-")
		if err != nil {
			t.Fatal(err)
		}
		defer os.RemoveAll(dir)
		socket := filepath.Join(dir, "sock")
		listener, err := net.Listen("unix", socket)
		if err != nil {
			t.Fatal(err)
		}
		defer listener.Close()
		keyring := agent.NewKeyring()
		if err = keyring.Add(agent.AddedKey{PrivateKey: s.userPrivate}); err != nil {
			t.Fatal(err)
		}
		done := make(chan struct{})
		go func() {
			defer close(done)
			for {
				conn, err := listener.Accept()
				if err != nil {
					return
				}
				_ = agent.ServeAgent(keyring, conn)
				_ = conn.Close()
			}
		}()
		defer func() {
			_ = listener.Close()
			select {
			case <-done:
			case <-time.After(3 * time.Second):
				t.Error("agent did not stop")
			}
		}()
		t.Setenv("SSH_AUTH_SOCK", socket)
		e := newTestEngine(t, nil)
		h := s.host()
		h.AuthMethod = "agent"
		h = saveTestHost(t, e, h, nil)
		connectTestHost(t, e, s, h)
		if stored, _ := e.Store.Host(h.ID); stored.RememberPassword {
			t.Fatal("agent credential was persisted")
		}
	})
}

func waitTransfer(t *testing.T, e *Engine, id string) TransferInfo {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		for _, info := range e.ListTransfers() {
			if info.ID == id && !activeTransfer(info.Status) {
				return info
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("transfer did not finish")
	return TransferInfo{}
}
func TestTerminalFlowControlResizeAndClose(t *testing.T) {
	s := newTestSSH(t)
	events := make(chan map[string]any, 256)
	e := newTestEngine(t, func(name string, payload any) {
		if strings.HasPrefix(name, "terminal:") {
			events <- payload.(map[string]any)
		}
	})
	h := saveTestHost(t, e, s.host(), ptr("test-secret"))
	info := connectTestHost(t, e, s, h)
	terminal, err := e.OpenTerminal(info.ID, 80, 24, "terminal:test")
	if err != nil {
		t.Fatal(err)
	}
	select {
	case size := <-s.windows:
		if size != [2]uint32{80, 24} {
			t.Fatal(size)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no PTY request")
	}
	if err = e.ResizeTerminal(terminal.ID, 120, 40); err != nil {
		t.Fatal(err)
	}
	select {
	case size := <-s.windows:
		if size != [2]uint32{120, 40} {
			t.Fatal(size)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no resize")
	}
	requireCode(t, e.WriteTerminal(terminal.ID, []int{256}), "invalid_terminal_data")
	requireCode(t, e.AckTerminal(terminal.ID, terminalWindow+1), "invalid_terminal_ack")
	payload := bytes.Repeat([]byte("输出\x00x"), 100000)
	writeDone := make(chan error, 1)
	go func() {
		for offset := 0; offset < len(payload); offset += 65536 {
			chunk := payload[offset:min(len(payload), offset+65536)]
			data := make([]int, len(chunk))
			for i, b := range chunk {
				data[i] = int(b)
			}
			if err := e.WriteTerminal(terminal.ID, data); err != nil {
				writeDone <- err
				return
			}
		}
		writeDone <- nil
	}()
	var received bytes.Buffer
	deadline := time.After(8 * time.Second)
	for received.Len() < len(payload)+len("test shell ready\r\n") {
		select {
		case event := <-events:
			if event["kind"] != "output" {
				t.Fatal(event)
			}
			data := event["data"].([]int)
			for _, b := range data {
				received.WriteByte(byte(b))
			}
			if err = e.AckTerminal(terminal.ID, len(data)); err != nil {
				t.Fatal(err)
			}
		case <-deadline:
			t.Fatal("terminal output stalled")
		}
	}
	if !bytes.Equal(received.Bytes(), append([]byte("test shell ready\r\n"), payload...)) {
		t.Fatal("terminal byte stream changed")
	}
	if err = <-writeDone; err != nil {
		t.Fatal(err)
	}
	if err = e.CloseTerminal(terminal.ID); err != nil {
		t.Fatal(err)
	}
}

func TestSFTPTransferFilesDirectoriesAndForward(t *testing.T) {
	s := newTestSSH(t)
	e := newTestEngine(t, nil)
	h := saveTestHost(t, e, s.host(), ptr("test-secret"))
	info := connectTestHost(t, e, s, h)
	remote := Endpoint{Kind: "remote", SessionID: info.ID}
	local := Endpoint{Kind: "local"}
	root := t.TempDir()
	data := bytes.Repeat([]byte("test-data\x00中文"), 20000)
	source := filepath.Join(root, "source")
	if err := os.WriteFile(source, data, 0600); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(s.root, "uploaded")
	task, err := e.StartTransfer(TransferRequest{Source: local, Destination: remote, SourcePath: source, DestinationPath: destination})
	if err != nil {
		t.Fatal(err)
	}
	finished := waitTransfer(t, e, task.ID)
	if task.Destination != remote || finished.Destination != remote {
		t.Fatal("upload destination metadata lost", task, finished)
	}
	if finished.Status != "completed" || finished.BytesDone != int64(len(data)) {
		t.Fatalf("upload: %+v", finished)
	}
	got, err := os.ReadFile(destination)
	if err != nil || !bytes.Equal(got, data) {
		t.Fatal("uploaded data mismatch", err)
	}
	download := filepath.Join(root, "downloaded")
	task, err = e.StartTransfer(TransferRequest{Source: remote, Destination: local, SourcePath: destination, DestinationPath: download})
	if err != nil {
		t.Fatal(err)
	}
	if finished = waitTransfer(t, e, task.ID); finished.Status != "completed" {
		t.Fatal(finished)
	}
	if task.Destination != local || finished.Destination != local {
		t.Fatal("download destination metadata lost", task, finished)
	}
	got, err = os.ReadFile(download)
	if err != nil || !bytes.Equal(got, data) {
		t.Fatal("download mismatch", err)
	}
	entries, err := e.ListFiles(remote, s.root)
	if err != nil || len(entries) != 1 || entries[0].Name != "uploaded" {
		t.Fatalf("list: %v %v", entries, err)
	}
	if err = e.FileAction("mkdir_file", Arguments{Endpoint: remote, Path: filepath.Join(s.root, "empty")}); err != nil {
		t.Fatal(err)
	}
	if err = e.FileAction("rename_file", Arguments{Endpoint: remote, Source: destination, Destination: filepath.Join(s.root, "renamed")}); err != nil {
		t.Fatal(err)
	}
	if err = e.FileAction("delete_file", Arguments{Endpoint: remote, Path: filepath.Join(s.root, "empty"), IsDirectory: true}); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(root, "folder")
	_ = os.MkdirAll(filepath.Join(dir, "empty"), 0700)
	_ = os.WriteFile(filepath.Join(dir, "child"), []byte("child"), 0600)
	task, err = e.StartTransfer(TransferRequest{Source: local, Destination: remote, SourcePath: dir, DestinationPath: filepath.Join(s.root, "tree")})
	if err != nil {
		t.Fatal(err)
	}
	if finished = waitTransfer(t, e, task.ID); finished.Status != "completed" {
		t.Fatal(finished)
	}
	if _, err = os.Stat(filepath.Join(s.root, "tree", "empty")); err != nil {
		t.Fatal(err)
	}
	// Forward the SSH greeting through direct-tcpip, then stop the listener.
	fwd, err := e.StartForward(info.ID, "127.0.0.1", h.Port, 0)
	if err != nil {
		t.Fatal(err)
	}
	conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(fwd.LocalPort)), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	b := make([]byte, 64)
	n, err := conn.Read(b)
	_ = conn.Close()
	if err != nil || !strings.HasPrefix(string(b[:n]), "SSH-2.0-") {
		t.Fatal("forward did not relay SSH greeting", err)
	}
	if err = e.StopForward(fwd.ID); err != nil {
		t.Fatal(err)
	}
	if forwards, err := e.ListForwards(info.ID); err != nil || len(forwards) != 0 {
		t.Fatal("forward not removed", err)
	}
	if records := e.ListRecoveries(); len(records) != 0 {
		t.Fatal("completed transfers left recovery records")
	}
}

package core

import (
	"context"
	"encoding/json"
	"sync"
	"time"
)

// Engine owns all resources for one desktop application. Closing it cancels
// pending handshakes, terminals, forwards and transfers before closing SSH.
type Engine struct {
	Store      *Store
	ctx        context.Context
	cancel     context.CancelFunc
	mu         sync.Mutex
	sessions   map[string]*connection
	requests   map[string]context.CancelFunc
	cancelled  map[string]time.Time
	terminals  map[string]*terminal
	forwards   map[string]*forward
	transfers  map[string]*transfer
	slots      chan struct{}
	journalMu  sync.Mutex
	recoveries map[string]Recovery
	emit       func(string, any)
	wg         sync.WaitGroup
	metricsMu  sync.Mutex
	metricTime time.Time
	metricCPU  float64
}

func NewEngine(dir string, emit func(string, any)) (*Engine, error) {
	s, err := OpenStore(dir)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	if emit == nil {
		emit = func(string, any) {}
	}
	e := &Engine{Store: s, ctx: ctx, cancel: cancel, sessions: map[string]*connection{}, requests: map[string]context.CancelFunc{}, cancelled: map[string]time.Time{}, terminals: map[string]*terminal{}, forwards: map[string]*forward{}, transfers: map[string]*transfer{}, slots: make(chan struct{}, 4), recoveries: map[string]Recovery{}, emit: emit}
	if err = e.loadJournal(); err != nil {
		cancel()
		return nil, err
	}
	e.metricTime = time.Now()
	e.metricCPU, _, _, _ = processUsage()
	return e, nil
}

func (e *Engine) Close() {
	e.cancel()
	e.mu.Lock()
	clients := make([]*connection, 0, len(e.sessions))
	for _, s := range e.sessions {
		clients = append(clients, s)
	}
	e.mu.Unlock()
	for _, s := range clients {
		s.close()
	}
	e.wg.Wait()
}

type Arguments struct {
	ID                  string          `json:"id"`
	Host                Host            `json:"host"`
	HostID              string          `json:"hostId"`
	Password            *string         `json:"password"`
	AcceptedFingerprint string          `json:"acceptedFingerprint"`
	AcceptedHostID      string          `json:"acceptedHostId"`
	RequestID           string          `json:"requestId"`
	SessionID           string          `json:"sessionId"`
	Address             string          `json:"address"`
	Port                int             `json:"port"`
	ExpectedFingerprint string          `json:"expectedFingerprint"`
	Hosts               []Host          `json:"hosts"`
	Path                string          `json:"path"`
	Format              string          `json:"format"`
	Endpoint            Endpoint        `json:"endpoint"`
	Source              string          `json:"source"`
	Destination         string          `json:"destination"`
	IsDirectory         bool            `json:"isDirectory"`
	Request             TransferRequest `json:"request"`
	Action              string          `json:"action"`
	Key                 string          `json:"key"`
	Value               json.RawMessage `json:"value"`
	Cols                int             `json:"cols"`
	Rows                int             `json:"rows"`
	Data                []int           `json:"data"`
	Bytes               int             `json:"bytes"`
	EventName           string          `json:"eventName"`
	LocalPort           int             `json:"localPort"`
	RemoteHost          string          `json:"remoteHost"`
	RemotePort          int             `json:"remotePort"`
}

func (e *Engine) Call(command string, a Arguments) (any, error) {
	if e.ctx.Err() != nil {
		return nil, fail("app_closed", "应用正在关闭")
	}
	switch command {
	case "list_hosts":
		return e.Store.Hosts(), nil
	case "get_host_password":
		host, err := e.Store.Host(a.ID)
		if err != nil {
			return nil, err
		}
		if !host.RememberPassword {
			return "", nil
		}
		return e.Store.Password(host)
	case "save_host":
		return e.Store.SaveHost(a.Host, a.Password)
	case "delete_host":
		return nil, e.Store.DeleteHost(a.ID)
	case "duplicate_host":
		return e.Store.Duplicate(a.ID)
	case "list_known_hosts":
		return e.Store.Known(), nil
	case "forget_known_host":
		return nil, e.Store.Forget(a.Address, a.Port, a.ExpectedFingerprint)
	case "preview_host_import":
		return PreviewImport(a.Path, a.Format)
	case "import_hosts":
		return e.Store.Import(a.Hosts)
	case "export_hosts":
		return nil, e.Store.Export(a.Path)
	case "get_preferences":
		return e.Store.Preferences(), nil
	case "list_system_fonts":
		return ListSystemFonts(e.ctx)
	case "set_preference":
		return nil, e.Store.SetPreference(a.Key, a.Value)
	case "get_data_directory":
		return e.Store.dir, nil
	case "get_home_directory":
		return homeDirectory()
	case "get_resource_snapshot":
		return e.resourceSnapshot(), nil
	case "connect_host":
		return e.Connect(a)
	case "cancel_host_connection":
		e.CancelConnection(a.RequestID)
		return nil, nil
	case "disconnect_session":
		return nil, e.Disconnect(a.ID)
	case "detect_host_system":
		return e.DetectSystem(a.SessionID)
	case "get_server_metrics":
		return e.ServerMetrics(a.SessionID)
	case "open_terminal":
		return e.OpenTerminal(a.SessionID, a.Cols, a.Rows, a.EventName)
	case "write_terminal":
		return nil, e.WriteTerminal(a.ID, a.Data)
	case "resize_terminal":
		return nil, e.ResizeTerminal(a.ID, a.Cols, a.Rows)
	case "close_terminal":
		return nil, e.CloseTerminal(a.ID)
	case "ack_terminal":
		return nil, e.AckTerminal(a.ID, a.Bytes)
	case "list_local_forwards":
		return e.ListForwards(a.SessionID)
	case "start_local_forward":
		return e.StartForward(a.SessionID, a.RemoteHost, a.RemotePort, a.LocalPort)
	case "stop_local_forward":
		return nil, e.StopForward(a.ID)
	case "list_files":
		return e.ListFiles(a.Endpoint, a.Path)
	case "resolve_file_path":
		return e.ResolvePath(a.Endpoint, a.Path)
	case "mkdir_file", "create_file", "rename_file", "delete_file":
		return nil, e.FileAction(command, a)
	case "start_transfer":
		return e.StartTransfer(a.Request)
	case "list_transfers":
		return e.ListTransfers(), nil
	case "cancel_transfer":
		return nil, e.CancelTransfer(a.ID)
	case "retry_transfer":
		return e.RetryTransfer(a.ID)
	case "list_transfer_recoveries":
		return e.ListRecoveries(), nil
	case "recover_transfer":
		return nil, e.Recover(a.ID, a.Action, a.SessionID)
	default:
		return nil, fail("unknown_command", "未知桌面命令："+command)
	}
}

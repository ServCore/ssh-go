package core

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
)

type AppError struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

func (e *AppError) Error() string     { return e.Message }
func fail(code, message string) error { return &AppError{Code: code, Message: message} }
func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func safeError(err error) *AppError {
	if e, ok := err.(*AppError); ok {
		return e
	}
	return &AppError{Code: "operation_failed", Message: "操作失败：" + err.Error()}
}
func ErrorValue(err error) any { return safeError(err) }

type RemoteSystem struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Version *string `json:"version"`
}
type Host struct {
	ID               string        `json:"id"`
	Name             string        `json:"name"`
	Address          string        `json:"address"`
	Port             int           `json:"port"`
	Username         string        `json:"username"`
	Group            string        `json:"group"`
	RememberPassword bool          `json:"rememberPassword"`
	RemoteSystem     *RemoteSystem `json:"remoteSystem,omitempty"`
	AuthMethod       string        `json:"authMethod"`
	PrivateKeyPath   *string       `json:"privateKeyPath"`
	JumpHostID       *string       `json:"jumpHostId"`
}
type KnownHost struct {
	Address     string `json:"address"`
	Port        int    `json:"port"`
	Fingerprint string `json:"fingerprint"`
}
type SessionInfo struct {
	ID          string `json:"id"`
	HostID      string `json:"hostId"`
	HostName    string `json:"hostName"`
	Fingerprint string `json:"fingerprint"`
}
type TerminalInfo struct {
	ID        string `json:"id"`
	SessionID string `json:"sessionId"`
}
type Endpoint struct {
	Kind      string `json:"kind"`
	SessionID string `json:"sessionId,omitempty"`
}

func (e Endpoint) valid() bool {
	return e.Kind == "local" && e.SessionID == "" || e.Kind == "remote" && e.SessionID != ""
}
func (e Endpoint) key() string { return e.Kind + ":" + e.SessionID }

type FileEntry struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Kind     string `json:"kind"`
	Size     int64  `json:"size"`
	Modified *int64 `json:"modified"`
}
type TransferRequest struct {
	Source          Endpoint `json:"source"`
	Destination     Endpoint `json:"destination"`
	SourcePath      string   `json:"sourcePath"`
	DestinationPath string   `json:"destinationPath"`
	Overwrite       bool     `json:"overwrite"`
}
type TransferInfo struct {
	Destination     Endpoint `json:"destination"`
	ID              string   `json:"id"`
	SessionIDs      []string `json:"sessionIds"`
	Name            string   `json:"name"`
	Direction       string   `json:"direction"`
	Status          string   `json:"status"`
	BytesDone       int64    `json:"bytesDone"`
	BytesTotal      int64    `json:"bytesTotal"`
	Error           *string  `json:"error"`
	SourcePath      string   `json:"sourcePath"`
	DestinationPath string   `json:"destinationPath"`
}
type ForwardInfo struct {
	ID         string `json:"id"`
	SessionID  string `json:"sessionId"`
	LocalPort  int    `json:"localPort"`
	RemoteHost string `json:"remoteHost"`
	RemotePort int    `json:"remotePort"`
}
type ImportPreview struct {
	Hosts    []Host   `json:"hosts"`
	Warnings []string `json:"warnings"`
}
type ImportResult struct {
	Imported int `json:"imported"`
	Skipped  int `json:"skipped"`
}

func hostKey(h Host) string { return fmt.Sprintf("%s:%d", h.Address, h.Port) }
func ptr[T any](v T) *T     { return &v }

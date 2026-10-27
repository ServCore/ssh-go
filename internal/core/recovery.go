package core

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"os"
	"path"
	"path/filepath"
	"sort"
	"time"
)

type Recovery struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	HostID      *string `json:"hostId"`
	FinalPath   string  `json:"finalPath"`
	StagingPath string  `json:"stagingPath"`
	BackupPath  *string `json:"backupPath"`
	Phase       string  `json:"phase"`
	Host        *Host   `json:"host,omitempty"`
}

func validRecovery(r Recovery) bool {
	id, err := hex.DecodeString(r.ID)
	if err != nil || len(id) != 16 || !path.IsAbs(r.FinalPath) || path.Clean(r.FinalPath) != r.FinalPath || r.FinalPath == "/" {
		return false
	}
	parent := path.Dir(r.FinalPath)
	if r.FinalPath == r.StagingPath || r.BackupPath != nil && r.FinalPath == *r.BackupPath {
		return false
	}
	if r.StagingPath != path.Join(parent, ".worklane-"+r.ID+".part") || r.BackupPath != nil && *r.BackupPath != path.Join(parent, ".worklane-"+r.ID+".bak") {
		return false
	}
	if r.HostID != nil && (r.Host == nil || r.Host.ID != *r.HostID) {
		return false
	}
	switch r.Phase {
	case "prepared", "copying", "staged", "backupPending", "backupCreated", "commitPending", "committed":
		return true
	}
	return false
}
func (e *Engine) loadJournal() error {
	name := filepath.Join(e.Store.dir, "recoveries.json")
	if info, err := os.Lstat(name); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return fail("recovery_journal_invalid", "恢复记录不能是符号链接")
	}
	b, err := readLimited(name, 4<<20)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var records []Recovery
	if err = strictJSON(b, &records); err != nil {
		return fail("recovery_journal_invalid", "恢复记录损坏，原文件已保留")
	}
	if len(records) > 1000 {
		return fail("recovery_journal_invalid", "恢复记录过多")
	}
	for _, record := range records {
		if !validRecovery(record) {
			return fail("recovery_journal_invalid", "恢复记录路径无效，原文件已保留")
		}
		if _, exists := e.recoveries[record.ID]; exists {
			return fail("recovery_journal_invalid", "恢复记录重复")
		}
		e.recoveries[record.ID] = record
	}
	return nil
}
func (e *Engine) writeJournalLocked(next map[string]Recovery) error {
	out := make([]Recovery, 0, len(next))
	for _, r := range next {
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	b, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return err
	}
	if len(out) > 1000 || len(b) > 4<<20 {
		return fail("recovery_journal_full", "中断恢复记录已满，请先处理")
	}
	if err = atomicWrite(filepath.Join(e.Store.dir, "recoveries.json"), b); err != nil {
		return err
	}
	e.recoveries = next
	return nil
}
func (e *Engine) putRecovery(r Recovery) error {
	if !validRecovery(r) {
		return fail("recovery_journal_invalid", "恢复记录无效")
	}
	e.journalMu.Lock()
	defer e.journalMu.Unlock()
	next := map[string]Recovery{}
	for k, v := range e.recoveries {
		next[k] = v
	}
	next[r.ID] = r
	return e.writeJournalLocked(next)
}
func (e *Engine) deleteRecovery(id string) error {
	e.journalMu.Lock()
	defer e.journalMu.Unlock()
	next := map[string]Recovery{}
	for k, v := range e.recoveries {
		if k != id {
			next[k] = v
		}
	}
	return e.writeJournalLocked(next)
}
func (e *Engine) ListRecoveries() []Recovery {
	e.mu.Lock()
	active := map[string]bool{}
	for id, t := range e.transfers {
		if activeTransfer(t.info.Status) {
			active[id] = true
		}
	}
	e.mu.Unlock()
	e.journalMu.Lock()
	defer e.journalMu.Unlock()
	out := []Recovery{}
	for id, r := range e.recoveries {
		if !active[id] {
			copy := r
			copy.Host = nil
			out = append(out, copy)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}
func (e *Engine) Recover(id, action, sessionID string) error {
	if action != "restore" && action != "discard" {
		return fail("invalid_recovery_action", "恢复操作无效")
	}
	e.mu.Lock()
	t := e.transfers[id]
	if t != nil && activeTransfer(t.info.Status) {
		e.mu.Unlock()
		return fail("transfer_active", "此传输仍在运行")
	}
	e.mu.Unlock()
	// Serialize recovery actions and journal mutations, including against another
	// recovery RPC for the same record. No live transfer can own this record.
	e.journalMu.Lock()
	defer e.journalMu.Unlock()
	r, ok := e.recoveries[id]
	if !ok {
		return fail("recovery_not_found", "中断记录不存在")
	}
	ep := Endpoint{Kind: "local"}
	if r.HostID != nil {
		s, err := e.session(sessionID)
		if err != nil {
			return err
		}
		if s.host.ID != *r.HostID || r.Host == nil || !identity(s.host, *r.Host) {
			return fail("recovery_host_mismatch", "连接与记录中的服务器不匹配")
		}
		ep = Endpoint{Kind: "remote", SessionID: sessionID}
	}
	ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second)
	defer cancel()
	f, err := e.fileSystem(ctx, ep)
	if err != nil {
		return err
	}
	defer f.close()
	parent, err := f.resolve(path.Dir(r.FinalPath))
	if err != nil {
		return err
	}
	if parent != path.Dir(r.FinalPath) {
		return fail("recovery_ambiguous", "恢复目录已变更，请手工检查文件")
	}
	if action == "restore" {
		if r.BackupPath == nil {
			return fail("recovery_ambiguous", "此记录没有原文件备份")
		}
		backup, err := f.lstat(*r.BackupPath)
		if err != nil {
			return err
		}
		if !backup.Mode().IsRegular() {
			return fail("recovery_ambiguous", "原文件备份类型异常")
		}
		if err = f.rename(*r.BackupPath, r.FinalPath); err != nil {
			return fail("recovery_ambiguous", "目标已存在或无法恢复备份，文件已保留："+err.Error())
		}
	}
	if err = f.removeTree(r.StagingPath, 0); err != nil {
		return err
	}
	next := map[string]Recovery{}
	for k, v := range e.recoveries {
		if k != id {
			next[k] = v
		}
	}
	return e.writeJournalLocked(next)
}

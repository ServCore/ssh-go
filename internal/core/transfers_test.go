package core

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func canonicalTemp(t *testing.T) string {
	t.Helper()
	p, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return p
}
func localTransfer(t *testing.T, e *Engine, source, destination string, overwrite bool) TransferInfo {
	t.Helper()
	task, err := e.StartTransfer(TransferRequest{Source: Endpoint{Kind: "local"}, Destination: Endpoint{Kind: "local"}, SourcePath: source, DestinationPath: destination, Overwrite: overwrite})
	if err != nil {
		t.Fatal(err)
	}
	return waitTransfer(t, e, task.ID)
}
func TestTransferConflictOverwriteAndSymlinks(t *testing.T) {
	e := newTestEngine(t, nil)
	dir := canonicalTemp(t)
	src, dst := filepath.Join(dir, "source"), filepath.Join(dir, "destination")
	_ = os.WriteFile(src, []byte("new content"), 0600)
	_ = os.WriteFile(dst, []byte("original"), 0600)
	result := localTransfer(t, e, src, dst, false)
	if result.Status != "failed" {
		t.Fatal("conflict was overwritten", result)
	}
	raw, _ := os.ReadFile(dst)
	if string(raw) != "original" {
		t.Fatal("original lost")
	}
	result = localTransfer(t, e, src, dst, true)
	if result.Status != "completed" {
		t.Fatal(result)
	}
	raw, _ = os.ReadFile(dst)
	if string(raw) != "new content" {
		t.Fatal("overwrite did not commit")
	}
	if records := e.ListRecoveries(); len(records) != 0 {
		t.Fatal(records)
	}
	link := filepath.Join(dir, "link")
	_ = os.Symlink(src, link)
	result = localTransfer(t, e, link, filepath.Join(dir, "link-copy"), false)
	if result.Status != "failed" || result.Error == nil || !strings.Contains(*result.Error, "符号链接") {
		t.Fatal("source symlink transferred", result)
	}
	result = localTransfer(t, e, src, link, true)
	if result.Status != "failed" {
		t.Fatal("destination symlink replaced", result)
	}
	folder := filepath.Join(dir, "folder")
	_ = os.Mkdir(folder, 0700)
	_ = os.Symlink(src, filepath.Join(folder, "nested-link"))
	result = localTransfer(t, e, folder, filepath.Join(dir, "tree"), false)
	if result.Status != "failed" {
		t.Fatal("nested symlink followed")
	}
	result = localTransfer(t, e, src, src, true)
	if result.Status != "failed" {
		t.Fatal("source overwritten by itself")
	}
}
func TestTransferCancellationAndRetry(t *testing.T) {
	dir := canonicalTemp(t)
	src, dst := filepath.Join(dir, "source"), filepath.Join(dir, "destination")
	_ = os.WriteFile(src, bytes.Repeat([]byte("payload"), 10000), 0600)
	var e *Engine
	cancelOnce := true
	e = newTestEngine(t, func(name string, value any) {
		if name == "transfer-update" {
			info := value.(TransferInfo)
			if info.Status == "running" && cancelOnce {
				cancelOnce = false
				if err := e.CancelTransfer(info.ID); err != nil {
					t.Error(err)
				}
			}
		}
	})
	result := localTransfer(t, e, src, dst, false)
	if result.Status != "cancelled" {
		t.Fatal(result)
	}
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Fatal("cancel committed final file")
	}
	if records := e.ListRecoveries(); len(records) != 0 {
		t.Fatal("cancellation left staging records", records)
	}
	task, err := e.RetryTransfer(result.ID)
	if err != nil {
		t.Fatal(err)
	}
	result = waitTransfer(t, e, task.ID)
	if result.Status != "completed" {
		t.Fatal(result)
	}
	if result.Destination != (Endpoint{Kind: "local"}) {
		t.Fatal("retry destination metadata lost", result)
	}
}
func TestTargetChangesDuringTransferArePreserved(t *testing.T) {
	for _, exists := range []bool{false, true} {
		t.Run(map[bool]string{true: "changed-existing", false: "new-conflict"}[exists], func(t *testing.T) {
			dir := canonicalTemp(t)
			src, dst := filepath.Join(dir, "source"), filepath.Join(dir, "destination")
			_ = os.WriteFile(src, []byte("new"), 0600)
			if exists {
				_ = os.WriteFile(dst, []byte("original"), 0600)
			}
			e := newTestEngine(t, func(name string, value any) {
				if name == "transfer-update" && value.(TransferInfo).Status == "committing" {
					if err := os.WriteFile(dst, []byte("external change"), 0600); err != nil {
						t.Error(err)
					}
				}
			})
			result := localTransfer(t, e, src, dst, true)
			if result.Status != "failed" {
				t.Fatal(result)
			}
			raw, _ := os.ReadFile(dst)
			if string(raw) != "external change" {
				t.Fatal("concurrent change lost")
			}
		})
	}
}
func TestRecoverySurvivesRestartAndNeverOverwritesTarget(t *testing.T) {
	dir := canonicalTemp(t)
	store := canonicalTemp(t)
	e, err := NewEngine(store, nil)
	if err != nil {
		t.Fatal(err)
	}
	id := newID()
	r := Recovery{ID: id, Name: "final", FinalPath: filepath.Join(dir, "final"), StagingPath: filepath.Join(dir, ".worklane-"+id+".part"), BackupPath: ptr(filepath.Join(dir, ".worklane-"+id+".bak")), Phase: "backupCreated"}
	_ = os.WriteFile(r.StagingPath, []byte("partial"), 0600)
	_ = os.WriteFile(*r.BackupPath, []byte("original"), 0600)
	if err = e.putRecovery(r); err != nil {
		t.Fatal(err)
	}
	e.Close()
	restarted, err := NewEngine(store, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	if len(restarted.ListRecoveries()) != 1 {
		t.Fatal("recovery missing after restart")
	}
	_ = os.WriteFile(r.FinalPath, []byte("other"), 0600)
	err = restarted.Recover(id, "restore", "")
	requireCode(t, err, "recovery_ambiguous")
	raw, _ := os.ReadFile(*r.BackupPath)
	if string(raw) != "original" {
		t.Fatal("backup modified on ambiguous restore")
	}
	_ = os.Remove(r.FinalPath)
	if err = restarted.Recover(id, "restore", ""); err != nil {
		t.Fatal(err)
	}
	raw, _ = os.ReadFile(r.FinalPath)
	if string(raw) != "original" {
		t.Fatal("original not restored")
	}
	if _, err = os.Stat(r.StagingPath); !os.IsNotExist(err) {
		t.Fatal("staging not cleared")
	}
}
func TestRecoveryDiscardPreservesOriginalAndBackup(t *testing.T) {
	e := newTestEngine(t, nil)
	dir := canonicalTemp(t)
	id := newID()
	r := Recovery{ID: id, Name: "file", FinalPath: filepath.Join(dir, "file"), StagingPath: filepath.Join(dir, ".worklane-"+id+".part"), BackupPath: ptr(filepath.Join(dir, ".worklane-"+id+".bak")), Phase: "commitPending"}
	for _, p := range []string{r.FinalPath, r.StagingPath, *r.BackupPath} {
		_ = os.WriteFile(p, []byte("keep"), 0600)
	}
	if err := e.putRecovery(r); err != nil {
		t.Fatal(err)
	}
	if err := e.Recover(id, "discard", ""); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{r.FinalPath, *r.BackupPath} {
		raw, err := os.ReadFile(p)
		if err != nil || string(raw) != "keep" {
			t.Fatal("discard changed original/backup", err)
		}
	}
}
func TestCorruptAndUnsafeRecoveryJournalIsRetained(t *testing.T) {
	for _, unsafe := range []bool{false, true} {
		t.Run(map[bool]string{true: "path-traversal", false: "invalid-json"}[unsafe], func(t *testing.T) {
			dir := canonicalTemp(t)
			if _, err := OpenStore(dir); err != nil {
				t.Fatal(err)
			}
			raw := []byte("{broken")
			if unsafe {
				raw, _ = json.Marshal([]Recovery{{ID: newID(), Name: "bad", FinalPath: "/tmp/target", StagingPath: "/tmp/not-a-staging-file", Phase: "copying"}})
			}
			name := filepath.Join(dir, "recoveries.json")
			_ = os.WriteFile(name, raw, 0600)
			_, err := NewEngine(dir, nil)
			requireCode(t, err, "recovery_journal_invalid")
			after, _ := os.ReadFile(name)
			if !bytes.Equal(after, raw) {
				t.Fatal("bad journal overwritten")
			}
		})
	}
}
func TestRemoteRecoveryRequiresMatchingIdentity(t *testing.T) {
	s := newTestSSH(t)
	e := newTestEngine(t, nil)
	h := saveTestHost(t, e, s.host(), ptr("test-secret"))
	session := connectTestHost(t, e, s, h)
	id := newID()
	dir, err := filepath.EvalSymlinks(s.root)
	if err != nil {
		t.Fatal(err)
	}
	r := Recovery{ID: id, Name: "remote", HostID: ptr(h.ID), Host: &h, FinalPath: filepath.Join(dir, "remote"), StagingPath: filepath.Join(dir, ".worklane-"+id+".part"), BackupPath: ptr(filepath.Join(dir, ".worklane-"+id+".bak")), Phase: "backupCreated"}
	_ = os.WriteFile(*r.BackupPath, []byte("original"), 0600)
	_ = os.WriteFile(r.StagingPath, []byte("partial"), 0600)
	if err = e.putRecovery(r); err != nil {
		t.Fatal(err)
	}
	other := h
	other.ID = "other-host"
	other = saveTestHost(t, e, other, ptr("test-secret"))
	wrong := connectTestHost(t, e, s, other)
	err = e.Recover(id, "restore", wrong.ID)
	requireCode(t, err, "recovery_host_mismatch")
	if err = e.Recover(id, "restore", session.ID); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(r.FinalPath)
	if string(raw) != "original" {
		t.Fatal("remote recovery failed")
	}
}

func TestRemoteCancellationPreservesSSH(t *testing.T) {
	s := newTestSSH(t)
	var e *Engine
	e = newTestEngine(t, func(name string, value any) {
		if name == "transfer-update" {
			info := value.(TransferInfo)
			if info.Status == "running" {
				if err := e.CancelTransfer(info.ID); err != nil {
					t.Error(err)
				}
			}
		}
	})
	h := saveTestHost(t, e, s.host(), ptr("test-secret"))
	session := connectTestHost(t, e, s, h)
	source := filepath.Join(canonicalTemp(t), "source")
	_ = os.WriteFile(source, bytes.Repeat([]byte("data"), 20000), 0600)
	task, err := e.StartTransfer(TransferRequest{Source: Endpoint{Kind: "local"}, Destination: Endpoint{Kind: "remote", SessionID: session.ID}, SourcePath: source, DestinationPath: filepath.Join(s.root, "destination")})
	if err != nil {
		t.Fatal(err)
	}
	result := waitTransfer(t, e, task.ID)
	if result.Status != "cancelled" {
		t.Fatal(result)
	}
	if _, err = e.DetectSystem(session.ID); err != nil {
		t.Fatal("transfer cancellation disconnected SSH", err)
	}
}

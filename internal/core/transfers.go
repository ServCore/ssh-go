package core

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"sort"
	"strings"
	"time"
)

type transfer struct {
	info    TransferInfo
	request TransferRequest
	ctx     context.Context
	cancel  context.CancelFunc
	created time.Time
}
type copyEntry struct {
	relative string
	info     os.FileInfo
}

func activeTransfer(status string) bool {
	return status == "queued" || status == "preparing" || status == "running" || status == "committing" || status == "cancelling"
}
func (e *Engine) StartTransfer(request TransferRequest) (TransferInfo, error) {
	if !request.Source.valid() || !request.Destination.valid() || request.SourcePath == "" || request.DestinationPath == "" {
		return TransferInfo{}, fail("invalid_transfer", "传输参数无效")
	}
	ids := []string{}
	for _, ep := range []Endpoint{request.Source, request.Destination} {
		if ep.Kind == "remote" {
			if _, err := e.session(ep.SessionID); err != nil {
				return TransferInfo{}, err
			}
			if len(ids) == 0 || ids[0] != ep.SessionID {
				ids = append(ids, ep.SessionID)
			}
		}
	}
	ctx, cancel := context.WithCancel(e.ctx)
	direction := "copy"
	if request.Source.Kind == "local" && request.Destination.Kind == "remote" {
		direction = "upload"
	} else if request.Source.Kind == "remote" && request.Destination.Kind == "local" {
		direction = "download"
	}
	t := &transfer{info: TransferInfo{ID: newID(), Name: path.Base(request.SourcePath), SessionIDs: ids, Destination: request.Destination, Direction: direction, Status: "queued", SourcePath: request.SourcePath, DestinationPath: request.DestinationPath}, request: request, ctx: ctx, cancel: cancel, created: time.Now()}
	e.mu.Lock()
	active := 0
	for _, task := range e.transfers {
		if activeTransfer(task.info.Status) {
			active++
		}
	}
	if e.ctx.Err() != nil || active >= 128 {
		e.mu.Unlock()
		cancel()
		return TransferInfo{}, fail("transfer_queue_full", "传输队列已满或应用正在关闭")
	}
	if len(e.transfers) >= 1000 {
		var oldest *transfer
		for _, task := range e.transfers {
			if !activeTransfer(task.info.Status) && (oldest == nil || task.created.Before(oldest.created)) {
				oldest = task
			}
		}
		if oldest != nil {
			delete(e.transfers, oldest.info.ID)
		}
	}
	e.transfers[t.info.ID] = t
	e.wg.Add(1)
	info := t.info
	e.mu.Unlock()
	e.emit("transfer-update", info)
	go func() {
		defer e.wg.Done()
		defer cancel()
		var err error
		select {
		case e.slots <- struct{}{}:
			err = e.runTransfer(t)
			<-e.slots
		case <-ctx.Done():
			err = ctx.Err()
		}
		e.mu.Lock()
		if err == nil {
			t.info.Status = "completed"
		} else if errors.Is(err, context.Canceled) || t.ctx.Err() != nil && t.info.Status != "committing" {
			t.info.Status = "cancelled"
		} else {
			t.info.Status = "failed"
			t.info.Error = ptr(err.Error())
		}
		info := t.info
		e.mu.Unlock()
		e.emit("transfer-update", info)
	}()
	return info, nil
}
func (e *Engine) updateTransfer(t *transfer, status string, done, total int64) {
	e.mu.Lock()
	if status != "" {
		t.info.Status = status
	}
	t.info.BytesDone = done
	t.info.BytesTotal = total
	info := t.info
	e.mu.Unlock()
	e.emit("transfer-update", info)
}
func (e *Engine) ListTransfers() []TransferInfo {
	e.mu.Lock()
	defer e.mu.Unlock()
	tasks := make([]*transfer, 0, len(e.transfers))
	for _, t := range e.transfers {
		tasks = append(tasks, t)
	}
	sort.Slice(tasks, func(i, j int) bool { return tasks[i].created.Before(tasks[j].created) })
	out := make([]TransferInfo, 0, len(tasks))
	for _, t := range tasks {
		out = append(out, t.info)
	}
	return out
}
func (e *Engine) CancelTransfer(id string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	t := e.transfers[id]
	if t == nil {
		return fail("transfer_not_found", "传输任务不存在")
	}
	if t.info.Status == "committing" {
		return fail("transfer_committing", "正在提交文件，请等待完成")
	}
	if activeTransfer(t.info.Status) {
		t.info.Status = "cancelling"
		t.cancel()
	}
	return nil
}
func (e *Engine) RetryTransfer(id string) (TransferInfo, error) {
	e.mu.Lock()
	t := e.transfers[id]
	if t == nil {
		e.mu.Unlock()
		return TransferInfo{}, fail("transfer_not_found", "传输任务不存在")
	}
	request := t.request
	status := t.info.Status
	e.mu.Unlock()
	if status != "failed" && status != "cancelled" {
		return TransferInfo{}, fail("invalid_transfer_state", "只有失败或取消的传输可以重试")
	}
	return e.StartTransfer(request)
}

func scanFiles(f *fileSystem, p, relative string, depth int, entries *[]copyEntry, total *int64) error {
	if depth > 64 || len(*entries) >= 100000 {
		return fail("file_tree_too_large", "传输目录层级或文件数量超出限制")
	}
	info, err := f.lstat(p)
	if err != nil {
		return err
	}
	if !info.IsDir() && !info.Mode().IsRegular() {
		return fail("unsupported_file", "不传输符号链接或特殊文件")
	}
	*entries = append(*entries, copyEntry{relative, info})
	if info.Mode().IsRegular() {
		if info.Size() < 0 || *total > int64(^uint64(0)>>1)-info.Size() {
			return fmt.Errorf("传输大小超出限制")
		}
		*total += info.Size()
		return nil
	}
	children, err := f.readDir(p)
	if err != nil {
		return err
	}
	for _, child := range children {
		if !safeName(child.Name()) {
			return fail("invalid_path", "目录包含无效文件名")
		}
		if err = scanFiles(f, path.Join(p, child.Name()), path.Join(relative, child.Name()), depth+1, entries, total); err != nil {
			return err
		}
	}
	return nil
}

func (e *Engine) runTransfer(t *transfer) error {
	e.updateTransfer(t, "preparing", 0, 0)
	source, err := e.fileSystem(t.ctx, t.request.Source)
	if err != nil {
		return err
	}
	defer source.close()
	destination, err := e.fileSystem(t.ctx, t.request.Destination)
	if err != nil {
		return err
	}
	defer destination.close()
	// Check the original source before resolving its canonical parent. Resolving
	// the source itself would silently follow a symlink selected for transfer.
	src, err := source.destination(t.request.SourcePath)
	if err != nil {
		return err
	}
	dst, err := destination.destination(t.request.DestinationPath)
	if err != nil {
		return err
	}
	if t.request.Source.key() == t.request.Destination.key() && (dst == src || strings.HasPrefix(dst, strings.TrimRight(src, "/")+"/")) {
		return fail("invalid_transfer", "目标不能是源路径或其子目录")
	}
	entries := []copyEntry{}
	var total int64
	if err = scanFiles(source, src, "", 0, &entries, &total); err != nil {
		return err
	}
	initial, err := destination.lstat(dst)
	exists := err == nil
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if exists && (!t.request.Overwrite || !initial.Mode().IsRegular() || entries[0].info.IsDir()) {
		return fail("file_exists", "目标已存在，目录不能合并或覆盖")
	}
	record := Recovery{ID: t.info.ID, Name: t.info.Name, FinalPath: dst, StagingPath: path.Join(path.Dir(dst), ".worklane-"+t.info.ID+".part"), Phase: "prepared"}
	if t.request.Destination.Kind == "remote" {
		s, err := e.session(t.request.Destination.SessionID)
		if err != nil {
			return err
		}
		record.HostID = ptr(s.host.ID)
		snapshot := s.host
		snapshot.RemoteSystem = nil
		record.Host = &snapshot
	}
	if exists {
		record.BackupPath = ptr(path.Join(path.Dir(dst), ".worklane-"+t.info.ID+".bak"))
	}
	for _, p := range []string{record.StagingPath, str(record.BackupPath)} {
		if p == "" {
			continue
		}
		if _, err = destination.lstat(p); err == nil {
			return fail("file_exists", "传输临时路径已存在，未修改文件")
		} else if !os.IsNotExist(err) {
			return err
		}
	}
	if err = e.putRecovery(record); err != nil {
		return err
	}
	// Before backup/commit, failure can safely remove our staging tree. Once a
	// rename is possible, retain the journal and files for explicit recovery.
	mayHaveRenamed := false
	ownedStaging := false
	defer func() {
		if !mayHaveRenamed {
			if !ownedStaging {
				_ = e.deleteRecovery(record.ID)
				return
			}
			cleanupCtx, cancel := context.WithTimeout(e.ctx, 5*time.Second)
			defer cancel()
			cleanup, openErr := e.fileSystem(cleanupCtx, t.request.Destination)
			if openErr == nil {
				defer cleanup.close()
				if cleanup.removeTree(record.StagingPath, 0) == nil {
					_ = e.deleteRecovery(record.ID)
				}
			}
		}
	}()
	record.Phase = "copying"
	if err = e.putRecovery(record); err != nil {
		return err
	}
	var done int64
	last := time.Now()
	e.updateTransfer(t, "running", 0, total)
	buffer := make([]byte, 64*1024)
	for _, entry := range entries {
		if err = t.ctx.Err(); err != nil {
			return err
		}
		from, to := path.Join(src, entry.relative), path.Join(record.StagingPath, entry.relative)
		if entry.info.IsDir() {
			current, statErr := source.lstat(from)
			if statErr != nil {
				return statErr
			}
			if !current.IsDir() || source.remote == nil && !os.SameFile(current, entry.info) {
				return fail("file_changed", "源目录在传输期间发生变化")
			}
			if err = destination.mkdir(to); err != nil {
				return err
			}
			if entry.relative == "" {
				ownedStaging = true
			}
			continue
		}
		current, err := source.lstat(from)
		if err != nil {
			return err
		}
		if !current.Mode().IsRegular() || current.Size() != entry.info.Size() || !current.ModTime().Equal(entry.info.ModTime()) || source.remote == nil && !os.SameFile(current, entry.info) {
			return fail("file_changed", "源文件在传输准备后发生变化")
		}
		input, err := source.open(from, os.O_RDONLY)
		if err != nil {
			return err
		}
		opened, err := input.Stat()
		if err != nil || !opened.Mode().IsRegular() || opened.Size() != current.Size() || !opened.ModTime().Equal(current.ModTime()) || source.remote == nil && !os.SameFile(opened, current) {
			_ = input.Close()
			return fail("file_changed", "源文件在打开时发生变化")
		}
		output, err := destination.open(to, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
		if err != nil {
			_ = input.Close()
			return err
		}
		if entry.relative == "" {
			ownedStaging = true
		}
		copied := int64(0)
		copyErr := func() error {
			for {
				if err := t.ctx.Err(); err != nil {
					return err
				}
				n, readErr := input.Read(buffer)
				if n > 0 {
					if copied+int64(n) > entry.info.Size() {
						return fail("file_changed", "源文件大小已变化")
					}
					written, err := output.Write(buffer[:n])
					if err != nil {
						return err
					}
					if written != n {
						return io.ErrShortWrite
					}
					copied += int64(n)
					done += int64(n)
					if time.Since(last) > 100*time.Millisecond {
						e.updateTransfer(t, "", done, total)
						last = time.Now()
					}
				}
				if readErr == io.EOF {
					break
				}
				if readErr != nil {
					return readErr
				}
			}
			if copied != entry.info.Size() {
				return fail("file_changed", "源文件大小已变化")
			}
			after, err := input.Stat()
			if err != nil {
				return err
			}
			if !after.ModTime().Equal(opened.ModTime()) || after.Size() != opened.Size() {
				return fail("file_changed", "源文件在读取时发生变化")
			}
			if file, ok := output.(*os.File); ok {
				return file.Sync()
			}
			return nil
		}()
		closeInput := input.Close()
		closeOutput := output.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeInput != nil {
			return closeInput
		}
		if closeOutput != nil {
			return closeOutput
		}
	}
	record.Phase = "staged"
	if err = e.putRecovery(record); err != nil {
		return err
	}
	e.mu.Lock()
	if err = t.ctx.Err(); err != nil {
		e.mu.Unlock()
		return err
	}
	t.info.Status = "committing"
	t.info.BytesDone = done
	t.info.BytesTotal = total
	info := t.info
	e.mu.Unlock()
	e.emit("transfer-update", info)
	current, err := destination.lstat(dst)
	if exists {
		if err != nil {
			return err
		}
		if !current.Mode().IsRegular() || current.Size() != initial.Size() || !current.ModTime().Equal(initial.ModTime()) || destination.remote == nil && !os.SameFile(current, initial) {
			return fail("file_changed", "目标文件已变化，未覆盖")
		}
		record.Phase = "backupPending"
		if err = e.putRecovery(record); err != nil {
			return err
		}
		mayHaveRenamed = true
		if err = destination.rename(dst, *record.BackupPath); err != nil {
			return err
		}
		record.Phase = "backupCreated"
		if err = e.putRecovery(record); err != nil {
			return err
		}
	} else if err == nil {
		return fail("file_exists", "目标在传输期间已创建，未覆盖")
	} else if !os.IsNotExist(err) {
		return err
	}
	record.Phase = "commitPending"
	if err = e.putRecovery(record); err != nil {
		return err
	}
	mayHaveRenamed = true
	if err = destination.rename(record.StagingPath, dst); err != nil {
		return err
	}
	record.Phase = "committed"
	if err = e.putRecovery(record); err != nil {
		return err
	}
	if record.BackupPath != nil {
		if err = destination.remove(*record.BackupPath, false); err != nil {
			return fail("backup_cleanup_failed", "文件已传输，原文件备份清理失败，请处理恢复记录")
		}
	}
	return e.deleteRecovery(record.ID)
}

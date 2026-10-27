package core

import (
	"context"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

type openFile interface {
	io.Reader
	io.Writer
	io.Closer
	Stat() (os.FileInfo, error)
}
type fileSystem struct {
	remote *sftp.Client
	stop   func() bool
	ctx    context.Context
	abort  func()
}

func (e *Engine) fileSystem(ctx context.Context, ep Endpoint) (*fileSystem, error) {
	if !ep.valid() {
		return nil, fail("invalid_endpoint", "文件端点无效")
	}
	f := &fileSystem{ctx: ctx}
	if ep.Kind == "remote" {
		s, err := e.session(ep.SessionID)
		if err != nil {
			return nil, err
		}
		// The constructor also performs an SSH subsystem and SFTP handshake.
		// Keep that entire phase cancellable, including servers that never reply.
		stopOpening := context.AfterFunc(ctx, s.close)
		channel, err := s.client.NewSession()
		if err != nil {
			stopOpening()
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			return nil, err
		}
		channel.Stderr = io.Discard
		stdin, err := channel.StdinPipe()
		var stdout io.Reader
		if err == nil {
			stdout, err = channel.StdoutPipe()
		}
		if err == nil {
			err = channel.RequestSubsystem("sftp")
		}
		var client *sftp.Client
		if err == nil {
			client, err = sftp.NewClientPipe(stdout, &sftpTransport{stdin: stdin, channel: channel})
		}
		stopOpening()
		if ctx.Err() != nil {
			if client != nil {
				_ = client.Close()
			}
			_ = channel.Close()
			return nil, ctx.Err()
		}
		if err != nil {
			_ = channel.Close()
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			return nil, err
		}
		f.remote = client
		f.abort = s.close
		f.stop = context.AfterFunc(ctx, func() {
			// Closing a valid SFTP channel preserves the SSH connection. A broken
			// server gets one second to acknowledge close before we tear it down.
			timer := time.AfterFunc(time.Second, s.close)
			defer timer.Stop()
			_ = client.Close()
		})
	}
	return f, nil
}

type sftpTransport struct {
	stdin   io.WriteCloser
	channel *ssh.Session
}

func (t *sftpTransport) Write(p []byte) (int, error) { return t.stdin.Write(p) }
func (t *sftpTransport) Close() error                { return t.channel.Close() }
func (f *fileSystem) close() {
	if f.stop != nil {
		f.stop()
	}
	if f.remote != nil {
		timer := time.AfterFunc(time.Second, f.abort)
		defer timer.Stop()
		_ = f.remote.Close()
	}
}
func (f *fileSystem) lstat(p string) (os.FileInfo, error) {
	if err := f.ctx.Err(); err != nil {
		return nil, err
	}
	if f.remote != nil {
		return f.remote.Lstat(p)
	}
	return os.Lstat(p)
}
func (f *fileSystem) readDir(p string) ([]os.FileInfo, error) {
	if err := f.ctx.Err(); err != nil {
		return nil, err
	}
	if f.remote != nil {
		return f.remote.ReadDirContext(f.ctx, p)
	}
	entries, err := os.ReadDir(p)
	if err != nil {
		return nil, err
	}
	out := make([]os.FileInfo, 0, len(entries))
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			return nil, err
		}
		out = append(out, info)
	}
	return out, nil
}
func (f *fileSystem) open(p string, flags int) (openFile, error) {
	if err := f.ctx.Err(); err != nil {
		return nil, err
	}
	if f.remote != nil {
		file, err := f.remote.OpenFile(p, flags)
		if err != nil {
			return nil, err
		}
		if flags&os.O_EXCL != 0 && flags&os.O_CREATE != 0 {
			if err = file.Chmod(0600); err != nil {
				_ = file.Close()
				_ = f.remote.Remove(p)
				return nil, err
			}
		}
		return file, nil
	}
	return os.OpenFile(p, flags, 0600)
}
func (f *fileSystem) mkdir(p string) error {
	if f.remote != nil {
		if err := f.remote.Mkdir(p); err != nil {
			return err
		}
		if err := f.remote.Chmod(p, 0700); err != nil {
			_ = f.remote.RemoveDirectory(p)
			return err
		}
		return nil
	}
	return os.Mkdir(p, 0700)
}
func (f *fileSystem) remove(p string, directory bool) error {
	if f.remote != nil {
		if directory {
			return f.remote.RemoveDirectory(p)
		}
		return f.remote.Remove(p)
	}
	return os.Remove(p)
}
func (f *fileSystem) rename(source, destination string) error {
	if _, err := f.lstat(destination); err == nil {
		return fail("file_exists", "目标路径已存在")
	} else if !os.IsNotExist(err) {
		return err
	}
	if f.remote != nil {
		info, err := f.remote.Lstat(source)
		if err != nil {
			return err
		}
		if _, supported := f.remote.HasExtension("hardlink@openssh.com"); supported && info.Mode().IsRegular() {
			if err = f.remote.Link(source, destination); err != nil {
				return err
			}
			return f.remote.Remove(source)
		}
		return f.remote.Rename(source, destination)
	}
	return renameExclusive(source, destination)
}
func (f *fileSystem) resolve(p string) (string, error) {
	if p == "" || strings.IndexByte(p, 0) >= 0 {
		return "", fail("invalid_path", "文件路径无效")
	}
	if f.remote != nil {
		return f.remote.RealPath(p)
	}
	if p == "~" || strings.HasPrefix(p, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		if p == "~" {
			p = home
		} else {
			p = filepath.Join(home, strings.TrimPrefix(p, "~/"))
		}
	}
	p, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(p)
}
func (f *fileSystem) destination(p string) (string, error) {
	if p == "" || strings.IndexByte(p, 0) >= 0 {
		return "", fail("invalid_path", "文件路径无效")
	}
	parent, err := f.resolve(path.Dir(p))
	if err != nil {
		return "", err
	}
	base := path.Base(p)
	if base == "." || base == "/" || base == ".." {
		return "", fail("invalid_path", "不能修改根目录")
	}
	return path.Join(parent, base), nil
}
func (f *fileSystem) removeTree(p string, depth int) error {
	if depth > 64 {
		return fail("file_tree_too_deep", "目录层级过深")
	}
	info, err := f.lstat(p)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.IsDir() {
		entries, err := f.readDir(p)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if !safeName(entry.Name()) {
				return fail("invalid_path", "服务器返回了无效文件名")
			}
			if err = f.removeTree(path.Join(p, entry.Name()), depth+1); err != nil {
				return err
			}
		}
	}
	return f.remove(p, info.IsDir())
}
func safeName(name string) bool {
	return name != "" && name != "." && name != ".." && !strings.ContainsAny(name, "/\x00")
}
func fileKind(info os.FileInfo) string {
	if info.Mode()&os.ModeSymlink != 0 {
		return "symlink"
	}
	if info.IsDir() {
		return "directory"
	}
	if info.Mode().IsRegular() {
		return "file"
	}
	return "other"
}
func (e *Engine) ListFiles(ep Endpoint, p string) ([]FileEntry, error) {
	ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second)
	defer cancel()
	f, err := e.fileSystem(ctx, ep)
	if err != nil {
		return nil, err
	}
	defer f.close()
	p, err = f.resolve(p)
	if err != nil {
		return nil, err
	}
	entries, err := f.readDir(p)
	if err != nil {
		return nil, err
	}
	if len(entries) > 200000 {
		return nil, fail("directory_too_large", "目录条目超过 200000 项")
	}
	out := make([]FileEntry, 0, len(entries))
	for _, info := range entries {
		if !safeName(info.Name()) {
			return nil, fmt.Errorf("无效文件名")
		}
		out = append(out, FileEntry{Name: info.Name(), Path: path.Join(p, info.Name()), Kind: fileKind(info), Size: info.Size(), Modified: ptr(info.ModTime().Unix())})
	}
	sort.Slice(out, func(i, j int) bool {
		if (out[i].Kind == "directory") != (out[j].Kind == "directory") {
			return out[i].Kind == "directory"
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}
func (e *Engine) ResolvePath(ep Endpoint, p string) (string, error) {
	ctx, cancel := context.WithTimeout(e.ctx, 15*time.Second)
	defer cancel()
	f, err := e.fileSystem(ctx, ep)
	if err != nil {
		return "", err
	}
	defer f.close()
	return f.resolve(p)
}
func (e *Engine) FileAction(command string, a Arguments) error {
	ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second)
	defer cancel()
	f, err := e.fileSystem(ctx, a.Endpoint)
	if err != nil {
		return err
	}
	defer f.close()
	if command == "rename_file" {
		source, err := f.destination(a.Source)
		if err != nil {
			return err
		}
		destination, err := f.destination(a.Destination)
		if err != nil {
			return err
		}
		return f.rename(source, destination)
	}
	p, err := f.destination(a.Path)
	if err != nil {
		return err
	}
	if command == "mkdir_file" {
		return f.mkdir(p)
	}
	info, err := f.lstat(p)
	if err != nil {
		return err
	}
	if info.IsDir() != a.IsDirectory {
		return fail("file_changed", "文件类型已变更，请刷新后重试")
	}
	return f.remove(p, info.IsDir())
}

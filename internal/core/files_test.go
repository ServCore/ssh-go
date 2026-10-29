package core

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestCreateNestedDirectories(t *testing.T) {
	for _, kind := range []string{"local", "remote"} {
		t.Run(kind, func(t *testing.T) {
			e := newTestEngine(t, nil)
			root := canonicalTemp(t)
			ep := Endpoint{Kind: kind}
			if kind == "remote" {
				s := newTestSSH(t)
				h := saveTestHost(t, e, s.host(), ptr("test-secret"))
				ep.SessionID = connectTestHost(t, e, s, h).ID
				root = s.root
			}
			create := func(p string) error {
				return e.FileAction("mkdir_file", Arguments{Endpoint: ep, Path: p})
			}
			parent := filepath.Join(root, "existing")
			if err := os.Mkdir(parent, 0755); err != nil {
				t.Fatal(err)
			}
			before, err := os.Stat(parent)
			if err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(parent, "data", "yiqiban", "config", "builtin_models.yaml")
			for range 2 {
				if err := create(target); err != nil {
					t.Fatal(err)
				}
			}
			for p := target; p != parent; p = filepath.Dir(p) {
				info, err := os.Stat(p)
				if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
					t.Fatalf("directory %s: %v, %v", p, info, err)
				}
			}
			after, err := os.Stat(parent)
			if err != nil || before.Mode() != after.Mode() {
				t.Fatalf("existing parent permissions changed: %v", err)
			}
			file := filepath.Join(parent, "file")
			if err := os.WriteFile(file, []byte("keep"), 0600); err != nil {
				t.Fatal(err)
			}
			for _, p := range []string{file, filepath.Join(file, "child", "nested")} {
				if err := create(p); err == nil {
					t.Fatalf("accepted a file as a directory: %s", p)
				}
			}
			if data, err := os.ReadFile(file); err != nil || string(data) != "keep" {
				t.Fatalf("existing file changed: %q, %v", data, err)
			}
			for _, p := range []string{"", "/", ".", "..", filepath.Join(root, "invalid") + "\x00/child"} {
				if err := create(p); err == nil {
					t.Fatalf("accepted invalid directory path: %q", p)
				}
			}
		})
	}
}

func TestCreateNestedDirectoriesRespectsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	f := &fileSystem{ctx: ctx}
	target := filepath.Join(t.TempDir(), "new", "nested")
	if err := f.mkdirAll(target); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Dir(target)); !os.IsNotExist(err) {
		t.Fatalf("cancelled operation created a parent: %v", err)
	}
}

func TestCreateEmptyFileExclusive(t *testing.T) {
	for _, kind := range []string{"local", "remote"} {
		t.Run(kind, func(t *testing.T) {
			e := newTestEngine(t, nil)
			root := canonicalTemp(t)
			ep := Endpoint{Kind: kind}
			if kind == "remote" {
				s := newTestSSH(t)
				h := saveTestHost(t, e, s.host(), ptr("test-secret"))
				ep.SessionID = connectTestHost(t, e, s, h).ID
				root = s.root
			}
			create := func(p string) error {
				_, err := e.Call("create_file", Arguments{Endpoint: ep, Path: p})
				return err
			}
			target := filepath.Join(root, "config.yaml")
			if err := create(target); err != nil {
				t.Fatal(err)
			}
			info, err := os.Stat(target)
			if err != nil || !info.Mode().IsRegular() || info.Size() != 0 || info.Mode().Perm() != 0600 {
				t.Fatalf("new file: %v, %v", info, err)
			}
			if err := os.WriteFile(target, []byte("preserve"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := create(target); err == nil {
				t.Fatal("overwrote an existing file")
			}
			if data, err := os.ReadFile(target); err != nil || string(data) != "preserve" {
				t.Fatalf("original changed: %q, %v", data, err)
			}
			folder := filepath.Join(root, "folder")
			if err := os.Mkdir(folder, 0700); err != nil {
				t.Fatal(err)
			}
			link := filepath.Join(root, "link")
			if err := os.Symlink(target, link); err != nil {
				t.Fatal(err)
			}
			for _, p := range []string{folder, link, "", "/", filepath.Join(root, "missing", "file"), target + "\x00"} {
				if err := create(p); err == nil {
					t.Fatalf("accepted invalid or occupied path: %q", p)
				}
			}
			if info, err := os.Lstat(link); err != nil || info.Mode()&os.ModeSymlink == 0 {
				t.Fatalf("symlink replaced: %v", err)
			}
		})
	}
}

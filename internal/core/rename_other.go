//go:build !darwin && !linux

package core

import "os"

// A hard link provides no-replace semantics for files on other platforms.
// Directory transfer commits require a platform implementation and fail safely.
func renameExclusive(source, destination string) error {
	if err := os.Link(source, destination); err != nil {
		return err
	}
	return os.Remove(source)
}

package storage

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Store holds the ciphertext of uploads. A blob is written and read one
// encrypted chunk at a time, so neither side ever needs the whole file.
type Store interface {
	// Put stores chunk n of a blob; off is the chunk's byte offset in the blob.
	Put(ctx context.Context, id string, n, off int64, data []byte) error
	// Get opens chunk n of a blob: size bytes starting at off.
	Get(ctx context.Context, id string, n, off, size int64) (io.ReadCloser, error)
	Remove(ctx context.Context, id string) error
	// Sweep removes blobs older than orphanAge for which keep reports false.
	Sweep(ctx context.Context, keep func(id string) bool) error
	// Backup stores a database snapshot under name and prunes all but the newest keepN.
	Backup(ctx context.Context, name, path string, keepN int) error
}

const (
	orphanAge    = time.Hour
	BackupPrefix = "coffer-" // database snapshots: coffer-<date>.db
)

// localStore keeps one file per blob under dir, chunks appended in order.
type localStore struct{ dir, backups string }

// NewLocal returns a Store that keeps blobs on disk under dataDir.
func NewLocal(dataDir string) (Store, error) {
	s := &localStore{dir: filepath.Join(dataDir, "blobs"), backups: filepath.Join(dataDir, "backups")}
	return s, os.MkdirAll(s.dir, 0o700)
}

func (s *localStore) path(id string) string { return filepath.Join(s.dir, id[:2], id) }

func (s *localStore) Put(_ context.Context, id string, _, off int64, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(s.path(id)), 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(s.path(id), os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	// Drop any bytes from a previously interrupted attempt at this chunk.
	if err := f.Truncate(off); err != nil {
		return err
	}
	if _, err := f.WriteAt(data, off); err != nil {
		return err
	}
	return f.Sync()
}

type sectionFile struct {
	*io.SectionReader
	f *os.File
}

func (s sectionFile) Close() error { return s.f.Close() }

func (s *localStore) Get(_ context.Context, id string, _, off, size int64) (io.ReadCloser, error) {
	f, err := os.Open(s.path(id))
	if err != nil {
		return nil, err
	}
	return sectionFile{io.NewSectionReader(f, off, size), f}, nil
}

func (s *localStore) Remove(_ context.Context, id string) error {
	err := os.Remove(s.path(id))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func (s *localStore) Sweep(_ context.Context, keep func(id string) bool) error {
	dirs, err := os.ReadDir(s.dir)
	if err != nil {
		return err
	}
	for _, d := range dirs {
		if !d.IsDir() {
			continue
		}
		files, _ := os.ReadDir(filepath.Join(s.dir, d.Name()))
		for _, f := range files {
			info, err := f.Info()
			if err != nil || time.Since(info.ModTime()) < orphanAge || keep(f.Name()) {
				continue
			}
			_ = os.Remove(filepath.Join(s.dir, d.Name(), f.Name()))
		}
	}
	return nil
}

func (s *localStore) Backup(_ context.Context, name, path string, keepN int) error {
	if err := os.MkdirAll(s.backups, 0o700); err != nil {
		return err
	}
	if err := os.Rename(path, filepath.Join(s.backups, name)); err != nil {
		return err
	}
	files, err := os.ReadDir(s.backups)
	if err != nil {
		return err
	}
	var names []string
	for _, f := range files {
		if strings.HasPrefix(f.Name(), BackupPrefix) {
			names = append(names, f.Name())
		}
	}
	for _, old := range stale(names, keepN) {
		_ = os.Remove(filepath.Join(s.backups, old))
	}
	return nil
}

// IsNotExist reports whether err means the blob is not in the store.
func IsNotExist(err error) bool {
	var se *s3Error
	return os.IsNotExist(err) || (errors.As(err, &se) && se.Status == http.StatusNotFound)
}

// stale returns all but the newest keepN names; snapshot names sort by date.
func stale(names []string, keepN int) []string {
	sort.Strings(names)
	if len(names) <= keepN {
		return nil
	}
	return names[:len(names)-keepN]
}

// Package store is Coffer's database: every query the server runs lives here,
// behind methods named for what they are for.
//
// The database only ever holds ciphertext metadata, wrapped keys and hashes of
// high-entropy tokens. Timestamps are unix seconds.
package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"
	"time"

	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

var (
	// ErrNotFound is returned when the row asked for does not exist.
	ErrNotFound = errors.New("store: not found")
	// ErrExists is returned when a row with the same unique key is already there.
	ErrExists = errors.New("store: already exists")
)

// Store is a handle on the database. It is safe for concurrent use.
type Store struct {
	db *sql.DB
}

// Open opens (creating it if need be) coffer.db in dataDir and brings its
// schema up to date.
func Open(dataDir string) (*Store, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)",
		filepath.Join(dataDir, "coffer.db"))
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite allows a single writer; one connection avoids SQLITE_BUSY churn.
	db.SetMaxOpenConns(1)
	if err := migrate(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return &Store{db: db}, nil
}

func migrate(db *sql.DB) error {
	if err := adoptLegacy(db); err != nil {
		return err
	}
	files, err := fs.Sub(migrations, "migrations")
	if err != nil {
		return err
	}
	p, err := goose.NewProvider(goose.DialectSQLite3, db, files)
	if err != nil {
		return err
	}
	_, err = p.Up(context.Background())
	return err
}

// Close releases the database.
func (s *Store) Close() error { return s.db.Close() }

// Snapshot writes a consistent copy of the database to path, which must not exist.
func (s *Store) Snapshot(ctx context.Context, path string) error {
	_, err := s.db.ExecContext(ctx, `VACUUM INTO ?`, path)
	return err
}

func now() int64 { return time.Now().Unix() }

// notFound turns the driver's "no rows" into ErrNotFound.
func notFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// ids runs a query that selects one text column.
func (s *Store) ids(query string, args ...any) ([]string, error) {
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (s *Store) exec(query string, args ...any) error {
	_, err := s.db.Exec(query, args...)
	return err
}

// count runs a query that selects a single number.
func (s *Store) count(query string, args ...any) (int64, error) {
	var n int64
	err := s.db.QueryRow(query, args...).Scan(&n)
	return n, err
}

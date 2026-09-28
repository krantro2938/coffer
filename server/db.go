package main

import (
	"database/sql"
	"fmt"
	"path/filepath"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS users (
	id                    TEXT PRIMARY KEY,
	email                 TEXT NOT NULL UNIQUE COLLATE NOCASE,
	kdf_salt              BLOB NOT NULL,
	kdf_params            TEXT NOT NULL,
	auth_hash             BLOB NOT NULL,
	wrapped_mk            BLOB NOT NULL,
	recovery_auth_hash    BLOB NOT NULL,
	recovery_wrapped_mk   BLOB NOT NULL,
	quota                 INTEGER NOT NULL,
	created_at            INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
	token_hash  BLOB PRIMARY KEY,
	user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at  INTEGER NOT NULL,
	expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS folders (
	id          TEXT PRIMARY KEY,
	user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	parent_id   TEXT REFERENCES folders(id) ON DELETE CASCADE,
	enc_name    BLOB NOT NULL,
	created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS folders_user ON folders(user_id);

CREATE TABLE IF NOT EXISTS items (
	id              TEXT PRIMARY KEY,
	user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
	folder_id       TEXT REFERENCES folders(id) ON DELETE CASCADE,
	kind            TEXT NOT NULL,
	enc_meta        BLOB NOT NULL,
	wrapped_key     BLOB,
	size            INTEGER NOT NULL,
	chunk_size      INTEGER NOT NULL,
	chunk_count     INTEGER NOT NULL,
	recv_chunks     INTEGER NOT NULL DEFAULT 0,
	recv_bytes      INTEGER NOT NULL DEFAULT 0,
	ready           INTEGER NOT NULL DEFAULT 0,
	manage_hash     BLOB,
	expires_at      INTEGER,
	created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS items_user ON items(user_id);
CREATE INDEX IF NOT EXISTS items_folder ON items(folder_id);

CREATE TABLE IF NOT EXISTS shares (
	id           TEXT PRIMARY KEY,
	item_id      TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
	user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
	wrapped_key  BLOB NOT NULL,
	access_hash  BLOB NOT NULL,
	enc_secret   BLOB,
	pw_salt      BLOB,
	pw_params    TEXT,
	max_views    INTEGER,
	views        INTEGER NOT NULL DEFAULT 0,
	burned_at    INTEGER,
	expires_at   INTEGER,
	created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shares_item ON shares(item_id);
CREATE INDEX IF NOT EXISTS shares_user ON shares(user_id);
`

func openDB(dataDir string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)",
		filepath.Join(dataDir, "coffer.db"))
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite allows a single writer; one connection avoids SQLITE_BUSY churn.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return db, nil
}

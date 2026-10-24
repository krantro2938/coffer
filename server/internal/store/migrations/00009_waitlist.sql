-- +goose Up

-- People who asked on the home page to hear when the paid plans open. They are
-- emailed once, when that happens; nothing here creates an account.
CREATE TABLE waitlist (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
	lang        TEXT,
	created_at  INTEGER NOT NULL
);

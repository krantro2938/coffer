-- +goose Up

-- People who asked on the home page to try a drive before paying. An admin
-- answers each with an invitation; nothing here creates an account.
CREATE TABLE trial_requests (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
	lang        TEXT,
	created_at  INTEGER NOT NULL,
	invited_at  INTEGER
);

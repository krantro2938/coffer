-- +goose Up

-- Whether an account is emailed when files come in through its links, and up
-- to when it has been told. Files that arrived before this existed are old
-- news: nobody is emailed about them.
ALTER TABLE users ADD COLUMN notify_uploads INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN uploads_notified_at INTEGER NOT NULL DEFAULT 0;
UPDATE users SET uploads_notified_at = CAST(strftime('%s', 'now') AS INTEGER);

-- Whether a request's page names the account that made it. Links made before
-- this existed never did, and keep not doing so.
ALTER TABLE requests ADD COLUMN show_owner INTEGER NOT NULL DEFAULT 0;

-- +goose Up

-- What the admin console cannot work out from the rows that remain: how often
-- links were opened, and how many were made before they expired or were
-- revoked. One number per UTC day and kind of event. Nothing here says whose
-- link it was, who opened it, or from where.
CREATE TABLE daily_counts (
	day     TEXT NOT NULL, -- 2026-10-11
	metric  TEXT NOT NULL, -- share_created, share_opened
	n       INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (day, metric)
);

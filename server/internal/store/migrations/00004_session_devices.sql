-- +goose Up

-- Lets an account see where it is signed in and sign a browser out: each
-- session gets an id that is safe to show (the token's hash is not), the
-- browser's own description of itself, and when it was last used. No IP
-- address is kept.
ALTER TABLE sessions ADD COLUMN id TEXT;
ALTER TABLE sessions ADD COLUMN user_agent TEXT;
ALTER TABLE sessions ADD COLUMN last_seen INTEGER;
UPDATE sessions SET id = lower(hex(randomblob(8))), last_seen = created_at;
CREATE UNIQUE INDEX sessions_id ON sessions(id);

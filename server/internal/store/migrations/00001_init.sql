-- +goose Up

-- Every statement is IF NOT EXISTS: databases from before migrations were
-- versioned already hold these tables (see legacy.go) and must pass through.

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
	created_at            INTEGER NOT NULL,
	lang                  TEXT,

	-- Email verification; accounts from before it existed count as verified.
	email_verified        INTEGER NOT NULL DEFAULT 1,
	otp_hash              BLOB,
	otp_expires           INTEGER,
	otp_tries             INTEGER NOT NULL DEFAULT 0,
	otp_sent              INTEGER,
	google_sub            TEXT,

	-- Paddle subscription state; all empty while billing is off.
	plan                  TEXT,
	sub_status            TEXT,
	sub_id                TEXT,
	customer_id           TEXT,
	period_end            INTEGER,
	cancel_at             INTEGER,
	pending_txn           TEXT,
	sub_updated           INTEGER NOT NULL DEFAULT 0,
	lapsed_at             INTEGER,                    -- when the plan stopped covering the drive
	lapse_notice          INTEGER NOT NULL DEFAULT 0, -- 1: told it lapsed, 2: final warning sent

	-- Set by an admin: a complimentary allowance, a personal price, a suspension.
	comp_quota            INTEGER,
	comp_until            INTEGER, -- NULL with comp_quota set: no end date
	offer                 TEXT,    -- JSON
	suspended_at          INTEGER,
	suspend_reason        TEXT,
	note                  TEXT
);
CREATE INDEX IF NOT EXISTS users_sub ON users(sub_id) WHERE sub_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_google ON users(google_sub) WHERE google_sub IS NOT NULL;

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
CREATE INDEX IF NOT EXISTS items_manage ON items(manage_hash) WHERE manage_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS shares (
	id           TEXT PRIMARY KEY,
	item_id      TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
	user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
	wrapped_key  BLOB NOT NULL,
	access_hash  BLOB NOT NULL,
	enc_secret   BLOB,
	open_secret  TEXT, -- short links only: the link secret, handed to anyone with the id
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

-- Files a folder link may serve, next to its encrypted manifest ("bundle" item).
CREATE TABLE IF NOT EXISTS share_items (
	share_id  TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
	item_id   TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
	PRIMARY KEY (share_id, item_id)
);
CREATE INDEX IF NOT EXISTS share_items_item ON share_items(item_id);

-- An admin's invitation to open an account on agreed terms.
CREATE TABLE IF NOT EXISTS invites (
	token_hash  BLOB PRIMARY KEY,
	email       TEXT NOT NULL COLLATE NOCASE,
	comp_quota  INTEGER,
	comp_until  INTEGER,
	offer       TEXT,
	note        TEXT,
	created_at  INTEGER NOT NULL,
	used_at     INTEGER
);
CREATE INDEX IF NOT EXISTS invites_email ON invites(email);

-- Abuse reports filed against share links.
CREATE TABLE IF NOT EXISTS reports (
	id          TEXT PRIMARY KEY,
	share_id    TEXT NOT NULL,
	item_id     TEXT,
	user_id     TEXT,          -- owner of the reported content, if it has one
	reason      TEXT NOT NULL,
	details     TEXT NOT NULL,
	contact     TEXT,
	secret      TEXT,          -- the link's key, if the reporter chose to hand it over
	status      TEXT NOT NULL DEFAULT 'open',
	resolution  TEXT,
	created_at  INTEGER NOT NULL,
	resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS reports_status ON reports(status, created_at);

CREATE TABLE IF NOT EXISTS admin_log (
	id      INTEGER PRIMARY KEY AUTOINCREMENT,
	at      INTEGER NOT NULL,
	action  TEXT NOT NULL,
	target  TEXT,
	detail  TEXT
);

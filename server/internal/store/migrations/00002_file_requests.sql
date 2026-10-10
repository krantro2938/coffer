-- +goose Up

-- A file request: a link through which anyone can upload into its owner's
-- drive, without an account. Uploaders encrypt each file's key to the
-- request's public key; only the owner holds the private half.
CREATE TABLE requests (
	id             TEXT PRIMARY KEY,
	user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	folder_id      TEXT REFERENCES folders(id) ON DELETE SET NULL, -- where uploads land; NULL: the drive's root
	access_hash    BLOB NOT NULL, -- hash of the upload token derived from the link secret
	enc_info       BLOB NOT NULL, -- title, note and public key, sealed under the link secret
	enc_secret     BLOB NOT NULL, -- the link secret, sealed to its owner
	enc_private    BLOB NOT NULL, -- the private key, sealed to its owner
	max_files      INTEGER,       -- uploads it accepts in all
	max_bytes      INTEGER,       -- ciphertext bytes it accepts in all
	max_file_size  INTEGER,       -- plaintext bytes per file
	expires_at     INTEGER,
	revoked_at     INTEGER,
	created_at     INTEGER NOT NULL
);
CREATE INDEX requests_user ON requests(user_id);

-- An item that came in through a request carries its key sealed to the
-- request's public key until its owner's browser re-wraps it (wrapped_key).
ALTER TABLE items ADD COLUMN request_id TEXT REFERENCES requests(id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN sealed_key BLOB;
CREATE INDEX items_request ON items(request_id) WHERE request_id IS NOT NULL;

-- The key a link wraps its item's key with, sealed to the link's owner, so a
-- folder link can be pointed at a fresh manifest when the folder changes.
ALTER TABLE shares ADD COLUMN enc_wrap BLOB;

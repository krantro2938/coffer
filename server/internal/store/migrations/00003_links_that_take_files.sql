-- +goose Up

-- A folder link whose holders may add files has a file request of its own
-- behind it: uploads through the link are admitted and encrypted the way
-- uploads through a request are. share_id names that link; it is not a
-- foreign key, because the request must outlive the link for as long as a
-- file's key is still sealed to it.
ALTER TABLE requests ADD COLUMN share_id TEXT;
CREATE INDEX requests_share ON requests(share_id) WHERE share_id IS NOT NULL;

-- The file key wrapped for the link an item was added through, so that
-- everyone holding the link can open the item at once, before its owner's
-- browser has listed it in the folder's manifest.
ALTER TABLE items ADD COLUMN link_key BLOB;

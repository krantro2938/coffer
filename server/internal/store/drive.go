package store

import "database/sql"

// Folder is a folder in a drive, as it is listed to its owner.
type Folder struct {
	ID        string  `json:"id"`
	ParentID  *string `json:"parentId"`
	EncName   []byte  `json:"encName"`
	CreatedAt int64   `json:"createdAt"`
}

// Folders lists a drive's folders, oldest first.
func (s *Store) Folders(userID string) ([]Folder, error) {
	rows, err := s.db.Query(`SELECT id, parent_id, enc_name, created_at FROM folders WHERE user_id = ? ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Folder{}
	for rows.Next() {
		var f Folder
		if err := rows.Scan(&f.ID, &f.ParentID, &f.EncName, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// OwnsFolder reports whether the folder is in the account's drive.
func (s *Store) OwnsFolder(userID, id string) (bool, error) {
	n, err := s.count(`SELECT COUNT(*) FROM folders WHERE id = ? AND user_id = ?`, id, userID)
	return n == 1, err
}

// CreateFolder adds a folder; a nil parent puts it at the root.
func (s *Store) CreateFolder(id, userID string, parentID *string, encName []byte) error {
	return s.exec(`INSERT INTO folders (id, user_id, parent_id, enc_name, created_at) VALUES (?, ?, ?, ?, ?)`,
		id, userID, parentID, encName, now())
}

// RenameFolder replaces a folder's encrypted name.
func (s *Store) RenameFolder(id string, encName []byte) error {
	return s.exec(`UPDATE folders SET enc_name = ? WHERE id = ?`, encName, id)
}

// FolderParent returns the folder a folder sits in ("" at the root), or
// ErrNotFound if the folder is not in the account's drive.
func (s *Store) FolderParent(userID, id string) (string, error) {
	var p sql.NullString
	err := s.db.QueryRow(`SELECT parent_id FROM folders WHERE id = ? AND user_id = ?`, id, userID).Scan(&p)
	return p.String, notFound(err)
}

// MoveFolder puts a folder inside another; a nil parent moves it to the root.
func (s *Store) MoveFolder(id string, parentID *string) error {
	return s.exec(`UPDATE folders SET parent_id = ? WHERE id = ?`, parentID, id)
}

// FolderItemIDs lists every item in a folder and the folders beneath it.
func (s *Store) FolderItemIDs(id string) ([]string, error) {
	return s.ids(`WITH RECURSIVE sub(id) AS (
			SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)
		SELECT id FROM items WHERE folder_id IN (SELECT id FROM sub)`, id)
}

// DeleteFolder removes a folder. Its subfolders, items and their share links
// cascade; the caller removes the stored ciphertext.
func (s *Store) DeleteFolder(id string) error {
	return s.exec(`DELETE FROM folders WHERE id = ?`, id)
}

// ----------------------------------------------------------------------- items

// DriveItem is a finished upload in a drive, as it is listed to its owner.
type DriveItem struct {
	ID         string  `json:"id"`
	FolderID   *string `json:"folderId"`
	Kind       string  `json:"kind"`
	EncMeta    []byte  `json:"encMeta"`
	WrappedKey []byte  `json:"wrappedKey"`
	Size       int64   `json:"size"`
	ChunkSize  int64   `json:"chunkSize"`
	ChunkCount int64   `json:"chunkCount"`
	CreatedAt  int64   `json:"createdAt"`
	// Set on a file that came in through a request and has not been adopted
	// yet: its key sealed to the request's public key, and which request.
	SealedKey []byte  `json:"sealedKey,omitempty"`
	RequestID *string `json:"requestId,omitempty"`
}

// DriveItems lists the finished uploads in a drive, newest first.
func (s *Store) DriveItems(userID string) ([]DriveItem, error) {
	rows, err := s.db.Query(`SELECT id, folder_id, kind, enc_meta, wrapped_key, size, chunk_size, chunk_count, created_at,
		sealed_key, request_id FROM items WHERE user_id = ? AND ready = 1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DriveItem{}
	for rows.Next() {
		var it DriveItem
		if err := rows.Scan(&it.ID, &it.FolderID, &it.Kind, &it.EncMeta, &it.WrappedKey, &it.Size, &it.ChunkSize, &it.ChunkCount, &it.CreatedAt,
			&it.SealedKey, &it.RequestID); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// Item is an upload, finished or not: a file, a note ("text") or the
// encrypted manifest of a folder link ("bundle").
type Item struct {
	ID         string
	UserID     sql.NullString // NULL: part of a quick share, owned by nobody
	Kind       string
	Size       int64 // bytes of ciphertext
	ChunkSize  int64
	ChunkCount int64
	RecvChunks int64
	RecvBytes  int64
	Ready      bool
	ManageHash []byte // quick shares: hash of the token that manages them
	ExpiresAt  sql.NullInt64
}

// Item returns an upload, or ErrNotFound.
func (s *Store) Item(id string) (*Item, error) {
	var it Item
	err := s.db.QueryRow(`SELECT id, user_id, kind, size, chunk_size, chunk_count, recv_chunks, recv_bytes, ready, manage_hash, expires_at
		FROM items WHERE id = ?`, id).Scan(&it.ID, &it.UserID, &it.Kind, &it.Size, &it.ChunkSize, &it.ChunkCount,
		&it.RecvChunks, &it.RecvBytes, &it.Ready, &it.ManageHash, &it.ExpiresAt)
	return &it, notFound(err)
}

// ItemExists reports whether an upload with this id is known.
func (s *Store) ItemExists(id string) (bool, error) {
	n, err := s.count(`SELECT COUNT(*) FROM items WHERE id = ?`, id)
	return n > 0, err
}

// NewItem starts an upload. A drive item has a UserID and a WrappedKey; a
// quick share's has a ManageHash and an ExpiresAt instead. One that comes in
// through a file request has its owner's UserID, the RequestID, the key
// sealed to the request (SealedKey) and a ManageHash for the upload itself.
type NewItem struct {
	ID         string
	UserID     *string
	FolderID   *string
	Kind       string
	EncMeta    []byte
	WrappedKey []byte
	Size       int64
	ChunkSize  int64
	ChunkCount int64
	ManageHash []byte
	ExpiresAt  *int64
	RequestID  *string
	SealedKey  []byte
	LinkKey    []byte // the key wrapped for the folder link it is being added through
}

// CreateItem records the start of an upload, or returns ErrExists.
func (s *Store) CreateItem(it NewItem) error {
	_, err := s.db.Exec(`INSERT INTO items (id, user_id, folder_id, kind, enc_meta, wrapped_key, size, chunk_size, chunk_count,
		manage_hash, expires_at, request_id, sealed_key, link_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		it.ID, it.UserID, it.FolderID, it.Kind, it.EncMeta, it.WrappedKey, it.Size, it.ChunkSize, it.ChunkCount,
		it.ManageHash, it.ExpiresAt, it.RequestID, it.SealedKey, it.LinkKey, now())
	if err != nil {
		return ErrExists
	}
	return nil
}

// AddChunk records that the next chunk of an upload, size bytes long, is stored.
func (s *Store) AddChunk(id string, size int64) error {
	return s.exec(`UPDATE items SET recv_chunks = recv_chunks + 1, recv_bytes = recv_bytes + ? WHERE id = ?`, size, id)
}

// SetItemMeta replaces an item's encrypted name and type.
func (s *Store) SetItemMeta(id string, encMeta []byte) error {
	return s.exec(`UPDATE items SET enc_meta = ? WHERE id = ?`, encMeta, id)
}

// MoveItem puts an item in a folder; a nil folder moves it to the root.
func (s *Store) MoveItem(id string, folderID *string) error {
	return s.exec(`UPDATE items SET folder_id = ? WHERE id = ?`, folderID, id)
}

// DeleteItem removes an item and the links to it. The caller removes the
// stored ciphertext.
func (s *Store) DeleteItem(id string) error {
	return s.exec(`DELETE FROM items WHERE id = ?`, id)
}

// UserItemIDs lists everything an account has uploaded.
func (s *Store) UserItemIDs(userID string) ([]string, error) {
	return s.ids(`SELECT id FROM items WHERE user_id = ?`, userID)
}

// ExpiredItemIDs lists what the janitor should delete: items past their
// expiry, uploads abandoned for a day, and quick-share files and folder
// manifests that no link has pointed to for an hour.
func (s *Store) ExpiredItemIDs() ([]string, error) {
	n := now()
	return s.ids(`SELECT id FROM items WHERE
		(expires_at IS NOT NULL AND expires_at <= ?)
		OR (ready = 0 AND created_at <= ?)
		OR ((user_id IS NULL OR kind = 'bundle') AND created_at <= ?
			AND NOT EXISTS (SELECT 1 FROM shares WHERE shares.item_id = items.id)
			AND NOT EXISTS (SELECT 1 FROM share_items WHERE share_items.item_id = items.id))`,
		n, n-24*3600, n-3600)
}

// --------------------------------------------------------------- quick shares

// A quick share is made without an account: its files belong to nobody,
// expire on their own and are managed with a token whose hash they all carry.

// QuickShare sums up the files uploaded under one manage token.
type QuickShare struct {
	Files     int64 // not counting the manifest
	Bundles   int64 // manifests: at most one
	Bytes     int64 // plaintext bytes of the files
	ExpiresAt int64
}

// QuickShare returns the totals for a manage token, or ErrNotFound if nothing
// was uploaded under it. overhead is the ciphertext overhead of one chunk.
func (s *Store) QuickShare(manageHash []byte, overhead int64) (*QuickShare, error) {
	var files, bundles, bytes, exp sql.NullInt64
	err := s.db.QueryRow(`SELECT SUM(kind != 'bundle'), SUM(kind = 'bundle'),
		SUM(CASE WHEN kind != 'bundle' THEN size - chunk_count * ? ELSE 0 END), MIN(expires_at)
		FROM items WHERE manage_hash = ? AND user_id IS NULL`, overhead, manageHash).Scan(&files, &bundles, &bytes, &exp)
	if err != nil {
		return nil, err
	}
	if !exp.Valid {
		return nil, ErrNotFound
	}
	return &QuickShare{Files: files.Int64, Bundles: bundles.Int64, Bytes: bytes.Int64, ExpiresAt: exp.Int64}, nil
}

// QuickShareItemIDs lists every file uploaded under a manage token.
func (s *Store) QuickShareItemIDs(manageHash []byte) ([]string, error) {
	return s.ids(`SELECT id FROM items WHERE manage_hash = ? AND user_id IS NULL`, manageHash)
}

// QuickShareSiblingIDs lists every file of the quick share an item is part of.
func (s *Store) QuickShareSiblingIDs(itemID string) ([]string, error) {
	return s.ids(`SELECT id FROM items WHERE user_id IS NULL AND manage_hash =
		(SELECT manage_hash FROM items WHERE id = ?)`, itemID)
}

// DeleteQuickShare removes every file uploaded under a manage token.
func (s *Store) DeleteQuickShare(manageHash []byte) error {
	return s.exec(`DELETE FROM items WHERE manage_hash = ? AND user_id IS NULL`, manageHash)
}

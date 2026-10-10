package store

// NewRequest is a file request as its owner's browser set it up. Everything
// in it that could be read is sealed: the server holds a public description
// it cannot open and a private key it cannot use.
type NewRequest struct {
	ID          string
	UserID      string
	FolderID    *string
	AccessHash  []byte
	EncInfo     []byte
	EncSecret   []byte
	EncPrivate  []byte
	MaxFiles    *int64
	MaxBytes    *int64
	MaxFileSize *int64
	ExpiresAt   *int64
	ShareID     *string // set on the request behind a folder link that takes files
}

// CreateRequest adds a file request, or returns ErrExists if the id is taken.
func (s *Store) CreateRequest(r NewRequest) error {
	_, err := s.db.Exec(`INSERT INTO requests (id, user_id, folder_id, access_hash, enc_info, enc_secret, enc_private,
		max_files, max_bytes, max_file_size, expires_at, share_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.UserID, r.FolderID, r.AccessHash, r.EncInfo, r.EncSecret, r.EncPrivate,
		r.MaxFiles, r.MaxBytes, r.MaxFileSize, r.ExpiresAt, r.ShareID, now())
	if err != nil {
		return ErrExists
	}
	return nil
}

// Request is a file request with what has come in through it so far.
type Request struct {
	ID          string  `json:"id"`
	UserID      string  `json:"-"`
	FolderID    *string `json:"folderId"`
	AccessHash  []byte  `json:"-"`
	EncInfo     []byte  `json:"encInfo"`
	EncSecret   []byte  `json:"encSecret"`
	EncPrivate  []byte  `json:"encPrivate"`
	MaxFiles    *int64  `json:"maxFiles"`
	MaxBytes    *int64  `json:"maxBytes"`
	MaxFileSize *int64  `json:"maxFileSize"`
	ExpiresAt   *int64  `json:"expiresAt"`
	RevokedAt   *int64  `json:"revokedAt"`
	CreatedAt   int64   `json:"createdAt"`
	// The folder link this request stands behind, if it is not one of its own.
	ShareID *string `json:"shareId,omitempty"`
	// Uploads and Bytes count what has arrived and what is on its way: an
	// upload holds its place from the moment it starts.
	Uploads int64 `json:"uploads"`
	Bytes   int64 `json:"bytes"`
	// Received counts finished uploads only.
	Received int64 `json:"received"`
}

// Open reports whether the request still takes uploads.
func (r *Request) Open() bool {
	return r.RevokedAt == nil && (r.ExpiresAt == nil || *r.ExpiresAt > now())
}

const requestSQL = `SELECT r.id, r.user_id, r.folder_id, r.access_hash, r.enc_info, r.enc_secret, r.enc_private,
	r.max_files, r.max_bytes, r.max_file_size, r.expires_at, r.revoked_at, r.created_at, r.share_id,
	(SELECT COUNT(*) FROM items i WHERE i.request_id = r.id),
	(SELECT COALESCE(SUM(size), 0) FROM items i WHERE i.request_id = r.id),
	(SELECT COUNT(*) FROM items i WHERE i.request_id = r.id AND i.ready = 1)
	FROM requests r`

func scanRequest(row interface{ Scan(...any) error }) (*Request, error) {
	var r Request
	err := row.Scan(&r.ID, &r.UserID, &r.FolderID, &r.AccessHash, &r.EncInfo, &r.EncSecret, &r.EncPrivate,
		&r.MaxFiles, &r.MaxBytes, &r.MaxFileSize, &r.ExpiresAt, &r.RevokedAt, &r.CreatedAt, &r.ShareID, &r.Uploads, &r.Bytes, &r.Received)
	return &r, err
}

// Request returns a file request, or ErrNotFound.
func (s *Store) Request(id string) (*Request, error) {
	r, err := scanRequest(s.db.QueryRow(requestSQL+` WHERE r.id = ?`, id))
	return r, notFound(err)
}

// Requests lists an account's file requests, newest first.
func (s *Store) Requests(userID string) ([]*Request, error) {
	rows, err := s.db.Query(requestSQL+` WHERE r.user_id = ? ORDER BY r.created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Request{}
	for rows.Next() {
		r, err := scanRequest(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// RevokeRequest stops an account's request from taking uploads, or returns
// ErrNotFound. What already came in stays.
func (s *Store) RevokeRequest(userID, id string) error {
	res, err := s.db.Exec(`UPDATE requests SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND user_id = ?`, now(), id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteRequest forgets an account's request, or returns ErrNotFound. It
// refuses with ErrExists while a file that came in through it still has its
// key sealed to the request: without the request that file could not be read.
func (s *Store) DeleteRequest(userID, id string) error {
	var pending bool
	err := s.db.QueryRow(`SELECT EXISTS (SELECT 1 FROM items WHERE request_id = ? AND sealed_key IS NOT NULL)
		FROM requests WHERE id = ? AND user_id = ?`, id, id, userID).Scan(&pending)
	if err != nil {
		return notFound(err)
	}
	if pending {
		return ErrExists
	}
	return s.exec(`DELETE FROM requests WHERE id = ? AND user_id = ?`, id, userID)
}

// AdoptItem replaces the key an uploader sealed to a request with one wrapped
// under its owner's master key, making the file an ordinary drive item. It
// returns ErrNotFound unless the item is the account's and still sealed.
func (s *Store) AdoptItem(userID, id string, wrappedKey []byte) error {
	res, err := s.db.Exec(`UPDATE items SET wrapped_key = ?, sealed_key = NULL
		WHERE id = ? AND user_id = ? AND ready = 1 AND sealed_key IS NOT NULL`, wrappedKey, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// FinishUpload marks an upload complete. An upload that came in through a
// request loses its upload token with it: the uploader's access ends there.
func (s *Store) FinishUpload(id string) error {
	return s.exec(`UPDATE items SET ready = 1, manage_hash = CASE WHEN user_id IS NULL THEN manage_hash ELSE NULL END WHERE id = ?`, id)
}

// AddedItem is a file someone added through a folder link, as the link's
// other holders are shown it.
type AddedItem struct {
	ID         string `json:"id"`
	EncMeta    []byte `json:"encMeta"`
	LinkKey    []byte `json:"linkKey"`
	Size       int64  `json:"size"`
	ChunkSize  int64  `json:"chunkSize"`
	ChunkCount int64  `json:"chunkCount"`
	CreatedAt  int64  `json:"createdAt"`
}

// addedSQL selects what was added through a folder link and is still where it
// landed: finished, in the shared folder itself, and not yet in the link's
// manifest (which then serves it like any other file).
const addedSQL = `FROM items i JOIN requests r ON r.id = i.request_id
	WHERE r.share_id = ? AND i.ready = 1 AND i.link_key IS NOT NULL AND i.folder_id IS r.folder_id
	AND NOT EXISTS (SELECT 1 FROM share_items s WHERE s.share_id = r.share_id AND s.item_id = i.id)`

// AddedItems lists the files added through a folder link, oldest first.
func (s *Store) AddedItems(shareID string) ([]AddedItem, error) {
	rows, err := s.db.Query(`SELECT i.id, i.enc_meta, i.link_key, i.size, i.chunk_size, i.chunk_count, i.created_at `+addedSQL+`
		ORDER BY i.created_at LIMIT 1000`, shareID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AddedItem{}
	for rows.Next() {
		var a AddedItem
		if err := rows.Scan(&a.ID, &a.EncMeta, &a.LinkKey, &a.Size, &a.ChunkSize, &a.ChunkCount, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ShareAdded reports whether a file was added through this folder link.
func (s *Store) ShareAdded(shareID, itemID string) (bool, error) {
	n, err := s.count(`SELECT COUNT(*) `+addedSQL+` AND i.id = ?`, shareID, itemID)
	return n == 1, err
}

// DeleteOrphanedLinkRequests forgets the requests behind folder links that
// are gone, once no file's key is sealed to them any more.
func (s *Store) DeleteOrphanedLinkRequests() error {
	return s.exec(`DELETE FROM requests WHERE share_id IS NOT NULL
		AND NOT EXISTS (SELECT 1 FROM shares WHERE shares.id = requests.share_id)
		AND NOT EXISTS (SELECT 1 FROM items WHERE items.request_id = requests.id AND items.sealed_key IS NOT NULL)`)
}

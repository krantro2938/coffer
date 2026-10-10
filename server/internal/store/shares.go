package store

import "database/sql"

// Share is a share link, as it is listed to whoever made it.
type Share struct {
	ID          string `json:"id"`
	ItemID      string `json:"itemId"`
	HasPassword bool   `json:"hasPassword"`
	EncSecret   []byte `json:"encSecret"`
	Short       bool   `json:"short"`
	MaxViews    *int64 `json:"maxViews"`
	Views       int64  `json:"views"`
	ExpiresAt   *int64 `json:"expiresAt"`
	CreatedAt   int64  `json:"createdAt"`
	// The key the link wraps its item's key with, sealed to the link's owner.
	// Links made before folder links could follow their folder have none.
	EncWrap []byte `json:"encWrap"`
}

// activeShare is the condition for a share that can still be opened.
const activeShare = `burned_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`

// openShare is activeShare as recipients see it: links from a drive are paused
// while its owner is suspended or, with billing on, while its plan is lapsed.
func openShare(billing bool) string {
	owner := `u.suspended_at IS NULL`
	if billing {
		owner = coveredSQL
	}
	return activeShare + ` AND (user_id IS NULL OR EXISTS (SELECT 1 FROM users u WHERE u.id = shares.user_id AND ` + owner + `))`
}

// Shares lists an account's live links, newest first.
func (s *Store) Shares(userID string) ([]Share, error) {
	rows, err := s.db.Query(`SELECT id, item_id, pw_salt IS NOT NULL, enc_secret, open_secret IS NOT NULL, max_views, views, expires_at, created_at, enc_wrap
		FROM shares WHERE user_id = ? AND `+activeShare+` ORDER BY created_at DESC`, userID, now())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Share{}
	for rows.Next() {
		var sh Share
		if err := rows.Scan(&sh.ID, &sh.ItemID, &sh.HasPassword, &sh.EncSecret, &sh.Short, &sh.MaxViews, &sh.Views, &sh.ExpiresAt, &sh.CreatedAt, &sh.EncWrap); err != nil {
			return nil, err
		}
		out = append(out, sh)
	}
	return out, rows.Err()
}

// ShareUse is how far a link has been used.
type ShareUse struct {
	Views               int64
	MaxViews, ExpiresAt sql.NullInt64
}

// LiveShareOf returns the newest live link to an item, or ErrNotFound.
func (s *Store) LiveShareOf(itemID string) (*ShareUse, error) {
	var u ShareUse
	err := s.db.QueryRow(`SELECT views, max_views, expires_at FROM shares WHERE item_id = ? AND `+activeShare+`
		ORDER BY created_at DESC LIMIT 1`, itemID, now()).Scan(&u.Views, &u.MaxViews, &u.ExpiresAt)
	return &u, notFound(err)
}

// Shareable reports whether a finished file may be listed in a folder link
// made from item: it must be in the same drive, or in the same quick share.
func (s *Store) Shareable(id string, item *Item) (bool, error) {
	n, err := s.count(`SELECT COUNT(*) FROM items WHERE id = ? AND ready = 1 AND kind != 'bundle'
		AND ((user_id IS NOT NULL AND user_id = ?) OR (user_id IS NULL AND manage_hash = ?))`,
		id, item.UserID, item.ManageHash)
	return n == 1, err
}

// NewShare is a link to an item. The server is given the item's key wrapped
// under the link secret and a hash of the access token derived from it.
type NewShare struct {
	ID         string
	ItemID     string
	UserID     *string
	WrappedKey []byte
	AccessHash []byte
	EncSecret  []byte  // the link secret, encrypted to its owner, so they can copy the link again
	EncWrap    []byte  // the key WrappedKey is wrapped with, encrypted to its owner
	OpenSecret *string // short links only: the link secret, handed to anyone with the id
	PwSalt     []byte
	PwParams   *string // JSON
	MaxViews   *int64
	ExpiresAt  *int64
	// Folder links: the files the manifest lists, which the link may also serve.
	ItemIDs []string
}

// CreateShare adds a link, or returns ErrExists if the id is taken.
func (s *Store) CreateShare(sh NewShare) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO shares (id, item_id, user_id, wrapped_key, access_hash, enc_secret, enc_wrap, open_secret, pw_salt, pw_params,
		max_views, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		sh.ID, sh.ItemID, sh.UserID, sh.WrappedKey, sh.AccessHash, sh.EncSecret, sh.EncWrap, sh.OpenSecret, sh.PwSalt, sh.PwParams,
		sh.MaxViews, sh.ExpiresAt, now()); err != nil {
		return ErrExists
	}
	for _, item := range sh.ItemIDs {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO share_items (share_id, item_id) VALUES (?, ?)`, sh.ID, item); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// RetargetShare points an account's folder link at a fresh manifest: a new
// bundle item, its key wrapped for the link, and the files it lists. It
// returns the manifest the link pointed at before, or ErrNotFound if the link
// is not the account's.
func (s *Store) RetargetShare(userID, id, itemID string, wrappedKey []byte, itemIDs []string) (previous string, err error) {
	tx, err := s.db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if err := tx.QueryRow(`SELECT item_id FROM shares WHERE id = ? AND user_id = ?`, id, userID).Scan(&previous); err != nil {
		return "", notFound(err)
	}
	if _, err := tx.Exec(`UPDATE shares SET item_id = ?, wrapped_key = ? WHERE id = ?`, itemID, wrappedKey, id); err != nil {
		return "", err
	}
	if _, err := tx.Exec(`DELETE FROM share_items WHERE share_id = ?`, id); err != nil {
		return "", err
	}
	for _, item := range itemIDs {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO share_items (share_id, item_id) VALUES (?, ?)`, id, item); err != nil {
			return "", err
		}
	}
	return previous, tx.Commit()
}

// ShareTarget returns the item a link points to and the account that made the
// link, if one did. It returns ErrNotFound for a link that is gone.
func (s *Store) ShareTarget(id string) (itemID string, owner sql.NullString, err error) {
	err = s.db.QueryRow(`SELECT item_id, user_id FROM shares WHERE id = ?`, id).Scan(&itemID, &owner)
	return itemID, owner, notFound(err)
}

// DeleteShare removes a link.
func (s *Store) DeleteShare(id string) error {
	return s.exec(`DELETE FROM shares WHERE id = ?`, id)
}

// DeleteUnsharedBundle removes a folder link's manifest once no link points to
// it, and reports whether it did.
func (s *Store) DeleteUnsharedBundle(itemID string) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM items WHERE id = ? AND kind = 'bundle' AND NOT EXISTS (SELECT 1 FROM shares WHERE item_id = ?)`, itemID, itemID)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// ShareItemIDs lists the files a folder link may serve.
func (s *Store) ShareItemIDs(shareID string) ([]string, error) {
	return s.ids(`SELECT item_id FROM share_items WHERE share_id = ?`, shareID)
}

// ShareServes reports whether a folder link may serve this finished file.
func (s *Store) ShareServes(shareID, itemID string) (bool, error) {
	n, err := s.count(`SELECT COUNT(*) FROM share_items s JOIN items i ON i.id = s.item_id
		WHERE s.share_id = ? AND s.item_id = ? AND i.ready = 1`, shareID, itemID)
	return n == 1, err
}

// DeleteExpiredShares removes links past their expiry and links used up
// before burnedBefore, and reports how many went.
func (s *Store) DeleteExpiredShares(burnedBefore int64) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM shares WHERE (expires_at IS NOT NULL AND expires_at <= ?) OR burned_at <= ?`, now(), burnedBefore)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// ------------------------------------------------------------ recipient side

// SharePreview is what anyone holding a link's id may learn before opening it.
type SharePreview struct {
	PwSalt     []byte         // nil when the link has no password
	PwParams   sql.NullString // JSON
	OpenSecret sql.NullString // short links only
	Limited    bool           // opening it uses up one of a set number of views
}

// SharePreview returns a link that can still be opened, or ErrNotFound. With
// billing, links from a drive whose plan has lapsed do not open.
func (s *Store) SharePreview(id string, billing bool) (*SharePreview, error) {
	var p SharePreview
	err := s.db.QueryRow(`SELECT pw_salt, pw_params, open_secret, max_views IS NOT NULL FROM shares WHERE id = ? AND `+openShare(billing), id, now()).
		Scan(&p.PwSalt, &p.PwParams, &p.OpenSecret, &p.Limited)
	return &p, notFound(err)
}

// OpenedShare is what a recipient gets for presenting the right access token.
type OpenedShare struct {
	ItemID     string
	Kind       string
	EncMeta    []byte
	WrappedKey []byte
	Size       int64
	ChunkSize  int64
	ChunkCount int64
	Views      int64 // counting this one
	MaxViews   sql.NullInt64
	ExpiresAt  sql.NullInt64
	Burned     bool // this was the last view the link allowed
}

// OpenShare consumes one view of a link that can still be opened and returns
// what it leads to. authorize is shown the stored hash of the access token; if
// it returns an error the link is left untouched and that error is returned,
// so wrong tokens never consume a view. It returns ErrNotFound for a link that
// is gone, used up or paused, or whose item is not there.
func (s *Store) OpenShare(id string, billing bool, authorize func(accessHash []byte) error) (*OpenedShare, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var o OpenedShare
	var accessHash []byte
	err = tx.QueryRow(`SELECT item_id, access_hash, wrapped_key, max_views, views, expires_at FROM shares
		WHERE id = ? AND `+openShare(billing), id, now()).Scan(&o.ItemID, &accessHash, &o.WrappedKey, &o.MaxViews, &o.Views, &o.ExpiresAt)
	if err != nil {
		return nil, notFound(err)
	}
	if err := authorize(accessHash); err != nil {
		return nil, err
	}

	o.Views++
	var burnedAt *int64
	if o.MaxViews.Valid && o.Views >= o.MaxViews.Int64 {
		n := now()
		burnedAt, o.Burned = &n, true
	}
	if _, err := tx.Exec(`UPDATE shares SET views = ?, burned_at = ? WHERE id = ?`, o.Views, burnedAt, id); err != nil {
		return nil, err
	}
	if err := tx.QueryRow(`SELECT kind, enc_meta, size, chunk_size, chunk_count FROM items WHERE id = ? AND ready = 1`, o.ItemID).
		Scan(&o.Kind, &o.EncMeta, &o.Size, &o.ChunkSize, &o.ChunkCount); err != nil {
		return nil, notFound(err)
	}
	return &o, tx.Commit()
}

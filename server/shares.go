package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

type shareJSON struct {
	ID          string `json:"id"`
	ItemID      string `json:"itemId"`
	HasPassword bool   `json:"hasPassword"`
	EncSecret   []byte `json:"encSecret"`
	MaxViews    *int64 `json:"maxViews"`
	Views       int64  `json:"views"`
	ExpiresAt   *int64 `json:"expiresAt"`
	CreatedAt   int64  `json:"createdAt"`
}

// activeShare is the SQL condition for a share that can still be opened.
const activeShare = `burned_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`

func (a *App) listShares(uid string) ([]shareJSON, error) {
	rows, err := a.db.Query(`SELECT id, item_id, pw_salt IS NOT NULL, enc_secret, max_views, views, expires_at, created_at
		FROM shares WHERE user_id = ? AND `+activeShare+` ORDER BY created_at DESC`, uid, now())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []shareJSON{}
	for rows.Next() {
		var s shareJSON
		if err := rows.Scan(&s.ID, &s.ItemID, &s.HasPassword, &s.EncSecret, &s.MaxViews, &s.Views, &s.ExpiresAt, &s.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (a *App) handleListShares(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	shares, err := a.listShares(uid)
	if err != nil {
		return err
	}
	writeJSON(w, 200, shares)
	return nil
}

func (a *App) handleCreateShare(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		ItemID     string     `json:"itemId"`
		WrappedKey []byte     `json:"wrappedKey"`
		AccessHash []byte     `json:"accessHash"`
		EncSecret  []byte     `json:"encSecret"`
		PwSalt     []byte     `json:"pwSalt"`
		PwKDF      *KDFParams `json:"pwKdf"`
		MaxViews   *int64     `json:"maxViews"`
		ExpiresIn  *int64     `json:"expiresIn"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	it, uid, err := a.authorizeItem(r, req.ItemID)
	if err != nil {
		return err
	}
	if !it.Ready {
		return errf(http.StatusConflict, "upload is not finished")
	}
	if len(req.WrappedKey) < 60 || len(req.WrappedKey) > 256 || len(req.AccessHash) != 32 {
		return errf(http.StatusBadRequest, "invalid key material")
	}
	if len(req.EncSecret) > 256 || (req.EncSecret != nil && uid == "") {
		return errf(http.StatusBadRequest, "invalid key material")
	}
	var pwParams any
	if req.PwSalt != nil || req.PwKDF != nil {
		if len(req.PwSalt) != 16 || req.PwKDF == nil || !req.PwKDF.valid() {
			return errf(http.StatusBadRequest, "invalid password parameters")
		}
		pwParams = req.PwKDF.json()
	}
	if req.MaxViews != nil && (*req.MaxViews < 1 || *req.MaxViews > 1000) {
		return errf(http.StatusBadRequest, "views must be between 1 and 1000")
	}
	var expires *int64
	if req.ExpiresIn != nil {
		if *req.ExpiresIn < 60 || *req.ExpiresIn > 365*24*3600 {
			return errf(http.StatusBadRequest, "invalid expiry")
		}
		e := time.Now().Unix() + *req.ExpiresIn
		expires = &e
	}
	// A link can never outlive an expiring (anonymous) item.
	if it.ExpiresAt.Valid && (expires == nil || *expires > it.ExpiresAt.Int64) {
		e := it.ExpiresAt.Int64
		expires = &e
	}
	var owner any
	if uid != "" {
		owner = uid
	}
	for range 5 {
		id := randomID(7)
		_, err = a.db.Exec(`INSERT INTO shares (id, item_id, user_id, wrapped_key, access_hash, enc_secret, pw_salt, pw_params,
			max_views, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, it.ID, owner, req.WrappedKey, req.AccessHash, req.EncSecret, req.PwSalt, pwParams, nullInt(req.MaxViews), nullInt(expires), now())
		if err == nil {
			writeJSON(w, 201, shareJSON{ID: id, ItemID: it.ID, HasPassword: req.PwSalt != nil, EncSecret: req.EncSecret,
				MaxViews: req.MaxViews, ExpiresAt: expires, CreatedAt: now()})
			return nil
		}
	}
	return err
}

func (a *App) handleDeleteShare(w http.ResponseWriter, r *http.Request) error {
	id := normalizeShareID(r.PathValue("id"))
	var itemID string
	err := a.db.QueryRow(`SELECT item_id FROM shares WHERE id = ?`, id).Scan(&itemID)
	if errors.Is(err, sql.ErrNoRows) {
		return errNotFound
	} else if err != nil {
		return err
	}
	if _, _, err := a.authorizeItem(r, itemID); err != nil {
		return err
	}
	if _, err := a.db.Exec(`DELETE FROM shares WHERE id = ?`, id); err != nil {
		return err
	}
	a.tickets.revokeShare(id)
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

// ------------------------------------------------------------ recipient side

func (a *App) handleShareInfo(w http.ResponseWriter, r *http.Request) error {
	id := normalizeShareID(r.PathValue("id"))
	if !shareIDRe.MatchString(id) {
		return errNotFound
	}
	var salt []byte
	var params sql.NullString
	err := a.db.QueryRow(`SELECT pw_salt, pw_params FROM shares WHERE id = ? AND `+activeShare, id, now()).Scan(&salt, &params)
	if errors.Is(err, sql.ErrNoRows) {
		return errf(http.StatusNotFound, "this link does not exist, has expired or has been used up")
	} else if err != nil {
		return err
	}
	resp := map[string]any{"id": id, "hasPassword": salt != nil}
	if salt != nil {
		var kdf KDFParams
		_ = json.Unmarshal([]byte(params.String), &kdf)
		resp["pwSalt"] = salt
		resp["pwKdf"] = kdf
	}
	writeJSON(w, 200, resp)
	return nil
}

// handleShareOpen checks the access token derived from the link secret (and
// password), consumes one view and hands back the wrapped key plus a
// short-lived download ticket. Wrong tokens never consume views.
func (a *App) handleShareOpen(w http.ResponseWriter, r *http.Request) error {
	id := normalizeShareID(r.PathValue("id"))
	if !shareIDRe.MatchString(id) {
		return errNotFound
	}
	if !a.shareOpenLimit.allow(clientIP(r, a.cfg.TrustProxy)) || a.shareFailLimit.blocked(id) {
		return errf(http.StatusTooManyRequests, "too many attempts, try again later")
	}
	var req struct {
		Access []byte `json:"access"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}

	tx, err := a.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var itemID string
	var accessHash, wrapped []byte
	var maxViews, expiresAt sql.NullInt64
	var views int64
	err = tx.QueryRow(`SELECT item_id, access_hash, wrapped_key, max_views, views, expires_at FROM shares
		WHERE id = ? AND `+activeShare, id, now()).Scan(&itemID, &accessHash, &wrapped, &maxViews, &views, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return errf(http.StatusNotFound, "this link does not exist, has expired or has been used up")
	} else if err != nil {
		return err
	}
	if !equal(sha(req.Access), accessHash) {
		a.shareFailLimit.allow(id)
		return errf(http.StatusUnauthorized, "wrong password or damaged link")
	}

	views++
	var burned any
	if maxViews.Valid && views >= maxViews.Int64 {
		burned = now()
	}
	if _, err := tx.Exec(`UPDATE shares SET views = ?, burned_at = ? WHERE id = ?`, views, burned, id); err != nil {
		return err
	}

	var kind string
	var meta []byte
	var size, chunkSize, chunkCount int64
	if err := tx.QueryRow(`SELECT kind, enc_meta, size, chunk_size, chunk_count FROM items WHERE id = ? AND ready = 1`, itemID).
		Scan(&kind, &meta, &size, &chunkSize, &chunkCount); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errNotFound
		}
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}

	resp := map[string]any{
		"itemId":     itemID,
		"kind":       kind,
		"encMeta":    meta,
		"wrappedKey": wrapped,
		"size":       size,
		"chunkSize":  chunkSize,
		"chunkCount": chunkCount,
		"ticket":     a.tickets.issue(id, itemID),
		"burned":     burned != nil,
	}
	if maxViews.Valid {
		resp["viewsLeft"] = max(maxViews.Int64-views, 0)
	}
	if expiresAt.Valid {
		resp["expiresAt"] = expiresAt.Int64
	}
	writeJSON(w, 200, resp)
	return nil
}

func (a *App) handleShareBlob(w http.ResponseWriter, r *http.Request) error {
	id := normalizeShareID(r.PathValue("id"))
	t, ok := a.tickets.get(r.Header.Get("X-Ticket"))
	if !ok || t.shareID != id {
		return errf(http.StatusForbidden, "download ticket expired, reopen the link")
	}
	return a.serveBlob(w, r, t.itemID)
}

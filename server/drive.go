package main

import (
	"database/sql"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

const (
	gcmOverhead  = 16
	minChunkSize = 64 << 10
	maxChunkSize = 16 << 20
	maxMetaSize  = 8 << 10
)

func (a *App) blobPath(id string) string { return filepath.Join(a.blobs, id[:2], id) }

func (a *App) itemIDs(query string, args ...any) ([]string, error) {
	rows, err := a.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (a *App) removeBlobs(ids []string) {
	for _, id := range ids {
		a.tickets.revokeItem(id)
		_ = os.Remove(a.blobPath(id))
	}
}

// ---------------------------------------------------------------- drive listing

type folderJSON struct {
	ID        string  `json:"id"`
	ParentID  *string `json:"parentId"`
	EncName   []byte  `json:"encName"`
	CreatedAt int64   `json:"createdAt"`
}

type itemJSON struct {
	ID         string  `json:"id"`
	FolderID   *string `json:"folderId"`
	Kind       string  `json:"kind"`
	EncMeta    []byte  `json:"encMeta"`
	WrappedKey []byte  `json:"wrappedKey"`
	Size       int64   `json:"size"`
	ChunkSize  int64   `json:"chunkSize"`
	ChunkCount int64   `json:"chunkCount"`
	CreatedAt  int64   `json:"createdAt"`
}

func (a *App) handleDrive(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	folders := []folderJSON{}
	rows, err := a.db.Query(`SELECT id, parent_id, enc_name, created_at FROM folders WHERE user_id = ? ORDER BY created_at`, uid)
	if err != nil {
		return err
	}
	for rows.Next() {
		var f folderJSON
		if err := rows.Scan(&f.ID, &f.ParentID, &f.EncName, &f.CreatedAt); err != nil {
			rows.Close()
			return err
		}
		folders = append(folders, f)
	}
	rows.Close()

	items := []itemJSON{}
	rows, err = a.db.Query(`SELECT id, folder_id, kind, enc_meta, wrapped_key, size, chunk_size, chunk_count, created_at
		FROM items WHERE user_id = ? AND ready = 1 ORDER BY created_at DESC`, uid)
	if err != nil {
		return err
	}
	for rows.Next() {
		var it itemJSON
		if err := rows.Scan(&it.ID, &it.FolderID, &it.Kind, &it.EncMeta, &it.WrappedKey, &it.Size, &it.ChunkSize, &it.ChunkCount, &it.CreatedAt); err != nil {
			rows.Close()
			return err
		}
		items = append(items, it)
	}
	rows.Close()

	shares, err := a.listShares(uid)
	if err != nil {
		return err
	}
	var quota int64
	if err := a.db.QueryRow(`SELECT quota FROM users WHERE id = ?`, uid).Scan(&quota); err != nil {
		return err
	}
	used, err := a.usage(uid)
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{
		"folders": folders, "items": items, "shares": shares,
		"usage": map[string]int64{"used": used, "quota": quota},
	})
	return nil
}

// --------------------------------------------------------------------- folders

func (a *App) ownsFolder(uid, id string) (bool, error) {
	var n int
	err := a.db.QueryRow(`SELECT COUNT(*) FROM folders WHERE id = ? AND user_id = ?`, id, uid).Scan(&n)
	return n == 1, err
}

func (a *App) handleCreateFolder(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	var req struct {
		ParentID *string `json:"parentId"`
		EncName  []byte  `json:"encName"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	if len(req.EncName) < 29 || len(req.EncName) > 2048 {
		return errf(http.StatusBadRequest, "invalid folder name")
	}
	if req.ParentID != nil {
		if ok, err := a.ownsFolder(uid, *req.ParentID); err != nil {
			return err
		} else if !ok {
			return errNotFound
		}
	}
	id := randomID(26)
	if _, err := a.db.Exec(`INSERT INTO folders (id, user_id, parent_id, enc_name, created_at) VALUES (?, ?, ?, ?, ?)`,
		id, uid, req.ParentID, req.EncName, now()); err != nil {
		return err
	}
	writeJSON(w, 201, map[string]string{"id": id})
	return nil
}

func (a *App) handleUpdateFolder(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	var req struct {
		EncName  []byte  `json:"encName"`
		ParentID *string `json:"parentId"` // "" moves to the root
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	if ok, err := a.ownsFolder(uid, id); err != nil {
		return err
	} else if !ok {
		return errNotFound
	}
	if req.EncName != nil {
		if len(req.EncName) < 29 || len(req.EncName) > 2048 {
			return errf(http.StatusBadRequest, "invalid folder name")
		}
		if _, err := a.db.Exec(`UPDATE folders SET enc_name = ? WHERE id = ?`, req.EncName, id); err != nil {
			return err
		}
	}
	if req.ParentID != nil {
		var parent any
		if *req.ParentID != "" {
			// Walk up from the new parent; reaching ourselves would create a cycle.
			cur := *req.ParentID
			for cur != "" {
				if cur == id {
					return errf(http.StatusBadRequest, "cannot move a folder into itself")
				}
				var p sql.NullString
				err := a.db.QueryRow(`SELECT parent_id FROM folders WHERE id = ? AND user_id = ?`, cur, uid).Scan(&p)
				if errors.Is(err, sql.ErrNoRows) {
					return errNotFound
				} else if err != nil {
					return err
				}
				cur = p.String
			}
			parent = *req.ParentID
		}
		if _, err := a.db.Exec(`UPDATE folders SET parent_id = ? WHERE id = ?`, parent, id); err != nil {
			return err
		}
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

func (a *App) handleDeleteFolder(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	if ok, err := a.ownsFolder(uid, id); err != nil {
		return err
	} else if !ok {
		return errNotFound
	}
	ids, err := a.itemIDs(`WITH RECURSIVE sub(id) AS (
			SELECT ? UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)
		SELECT id FROM items WHERE folder_id IN (SELECT id FROM sub)`, id)
	if err != nil {
		return err
	}
	// Subfolders, items and their share links cascade.
	if _, err := a.db.Exec(`DELETE FROM folders WHERE id = ?`, id); err != nil {
		return err
	}
	a.removeBlobs(ids)
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

// ----------------------------------------------------------------------- items

type itemRow struct {
	ID         string
	UserID     sql.NullString
	Kind       string
	Size       int64
	ChunkSize  int64
	ChunkCount int64
	RecvChunks int64
	RecvBytes  int64
	Ready      bool
	ManageHash []byte
	ExpiresAt  sql.NullInt64
}

func (a *App) loadItem(id string) (*itemRow, error) {
	var it itemRow
	err := a.db.QueryRow(`SELECT id, user_id, kind, size, chunk_size, chunk_count, recv_chunks, recv_bytes, ready, manage_hash, expires_at
		FROM items WHERE id = ?`, id).Scan(&it.ID, &it.UserID, &it.Kind, &it.Size, &it.ChunkSize, &it.ChunkCount,
		&it.RecvChunks, &it.RecvBytes, &it.Ready, &it.ManageHash, &it.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNotFound
	}
	return &it, err
}

// authorizeItem allows the signed-in owner, or the holder of the manage token
// handed out when an anonymous drop was created.
func (a *App) authorizeItem(r *http.Request, id string) (*itemRow, string, error) {
	if !itemIDRe.MatchString(id) {
		return nil, "", errNotFound
	}
	it, err := a.loadItem(id)
	if err != nil {
		return nil, "", err
	}
	if it.UserID.Valid {
		uid, err := a.currentUser(r)
		if err != nil {
			return nil, "", err
		}
		if uid != it.UserID.String {
			return nil, "", errNotFound
		}
		return it, uid, nil
	}
	tok := r.Header.Get("X-Manage-Token")
	if tok == "" || it.ManageHash == nil || !equal(sha([]byte(tok)), it.ManageHash) {
		return nil, "", errNotFound
	}
	return it, "", nil
}

func (a *App) handleCreateItem(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.currentUser(r)
	if err != nil {
		return err
	}
	var req struct {
		ID         string  `json:"id"`
		Kind       string  `json:"kind"`
		EncMeta    []byte  `json:"encMeta"`
		WrappedKey []byte  `json:"wrappedKey"`
		FolderID   *string `json:"folderId"`
		Size       int64   `json:"size"`
		ChunkSize  int64   `json:"chunkSize"`
		ChunkCount int64   `json:"chunkCount"`
		ExpiresIn  int64   `json:"expiresIn"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	if !itemIDRe.MatchString(req.ID) || (req.Kind != "file" && req.Kind != "text" && req.Kind != "bundle") ||
		len(req.EncMeta) < 29 || len(req.EncMeta) > maxMetaSize ||
		req.ChunkSize < minChunkSize || req.ChunkSize > maxChunkSize || req.ChunkCount < 1 ||
		req.ChunkCount > 1<<20 ||
		req.Size < (req.ChunkCount-1)*(req.ChunkSize+gcmOverhead)+gcmOverhead ||
		req.Size > req.ChunkCount*(req.ChunkSize+gcmOverhead) {
		return errf(http.StatusBadRequest, "invalid upload parameters")
	}
	plain := req.Size - req.ChunkCount*gcmOverhead

	var manageToken string
	var manageHash []byte
	var expires *int64
	if uid != "" {
		if len(req.WrappedKey) < 60 || len(req.WrappedKey) > 256 {
			return errf(http.StatusBadRequest, "invalid key material")
		}
		if plain > a.cfg.MaxFileSize {
			return errf(http.StatusRequestEntityTooLarge, "file exceeds the maximum size")
		}
		if req.FolderID != nil {
			if ok, err := a.ownsFolder(uid, *req.FolderID); err != nil {
				return err
			} else if !ok {
				return errNotFound
			}
		}
		var quota int64
		if err := a.db.QueryRow(`SELECT quota FROM users WHERE id = ?`, uid).Scan(&quota); err != nil {
			return err
		}
		used, err := a.usage(uid)
		if err != nil {
			return err
		}
		if used+req.Size > quota {
			return errf(http.StatusInsufficientStorage, "not enough storage left in your drive")
		}
	} else {
		if !a.cfg.AllowAnonymous {
			return errf(http.StatusUnauthorized, "sign in to upload")
		}
		if !a.anonLimit.allow(clientIP(r, a.cfg.TrustProxy)) {
			return errf(http.StatusTooManyRequests, "upload limit reached, try again later")
		}
		if req.WrappedKey != nil || req.FolderID != nil || req.Kind == "bundle" {
			return errf(http.StatusBadRequest, "anonymous drops cannot be stored in a drive")
		}
		if plain > a.cfg.AnonMaxFileSize {
			return errf(http.StatusRequestEntityTooLarge, "file exceeds the maximum size for anonymous drops, sign in for more")
		}
		ttl := time.Duration(req.ExpiresIn) * time.Second
		if ttl < time.Minute || ttl > a.cfg.AnonMaxExpiry {
			return errf(http.StatusBadRequest, "invalid expiry")
		}
		exp := time.Now().Add(ttl).Unix()
		expires = &exp
		manageToken = randomToken()
		manageHash = sha([]byte(manageToken))
	}

	var owner any
	if uid != "" {
		owner = uid
	}
	_, err = a.db.Exec(`INSERT INTO items (id, user_id, folder_id, kind, enc_meta, wrapped_key, size, chunk_size, chunk_count,
		manage_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		req.ID, owner, req.FolderID, req.Kind, req.EncMeta, req.WrappedKey, req.Size, req.ChunkSize, req.ChunkCount,
		manageHash, nullInt(expires), now())
	if err != nil {
		return errf(http.StatusConflict, "item already exists")
	}
	if err := os.MkdirAll(filepath.Dir(a.blobPath(req.ID)), 0o700); err != nil {
		return err
	}
	resp := map[string]any{"id": req.ID}
	if manageToken != "" {
		resp["manageToken"] = manageToken
		resp["expiresAt"] = *expires
	}
	writeJSON(w, 201, resp)
	return nil
}

func (a *App) handleUploadChunk(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("id")
	n, err := strconv.ParseInt(r.PathValue("n"), 10, 64)
	if err != nil {
		return errNotFound
	}
	unlock := a.locks.lock(id)
	defer unlock()

	it, _, err := a.authorizeItem(r, id)
	if err != nil {
		return err
	}
	if it.Ready {
		return errf(http.StatusConflict, "upload already completed")
	}
	if n != it.RecvChunks {
		return errf(http.StatusConflict, "unexpected chunk "+strconv.FormatInt(n, 10)+", expected "+strconv.FormatInt(it.RecvChunks, 10))
	}
	want := it.ChunkSize + gcmOverhead
	if n == it.ChunkCount-1 {
		want = it.Size - it.RecvBytes
	}
	if n >= it.ChunkCount || want < gcmOverhead {
		return errf(http.StatusBadRequest, "invalid chunk")
	}

	f, err := os.OpenFile(a.blobPath(id), os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	// Drop any bytes from a previously interrupted attempt at this chunk.
	if err := f.Truncate(it.RecvBytes); err != nil {
		return err
	}
	if _, err := f.Seek(it.RecvBytes, io.SeekStart); err != nil {
		return err
	}
	body := http.MaxBytesReader(w, r.Body, want)
	written, err := io.Copy(f, body)
	if err != nil {
		return err
	}
	if written != want {
		return errf(http.StatusBadRequest, "chunk has the wrong size")
	}
	if _, err := a.db.Exec(`UPDATE items SET recv_chunks = recv_chunks + 1, recv_bytes = recv_bytes + ? WHERE id = ?`, written, id); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]int64{"received": n + 1})
	return nil
}

func (a *App) handleCompleteItem(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("id")
	unlock := a.locks.lock(id)
	defer unlock()
	it, _, err := a.authorizeItem(r, id)
	if err != nil {
		return err
	}
	if it.RecvChunks != it.ChunkCount || it.RecvBytes != it.Size {
		return errf(http.StatusConflict, "upload is incomplete")
	}
	f, err := os.OpenFile(a.blobPath(id), os.O_WRONLY, 0)
	if err != nil {
		return err
	}
	syncErr := f.Sync()
	f.Close()
	if syncErr != nil {
		return syncErr
	}
	if _, err := a.db.Exec(`UPDATE items SET ready = 1 WHERE id = ?`, id); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

func (a *App) handleUpdateItem(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	it, _, err := a.authorizeItem(r, r.PathValue("id"))
	if err != nil {
		return err
	}
	var req struct {
		EncMeta  []byte  `json:"encMeta"`
		FolderID *string `json:"folderId"` // "" moves to the root
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	if req.EncMeta != nil {
		if len(req.EncMeta) < 29 || len(req.EncMeta) > maxMetaSize {
			return errf(http.StatusBadRequest, "invalid metadata")
		}
		if _, err := a.db.Exec(`UPDATE items SET enc_meta = ? WHERE id = ?`, req.EncMeta, it.ID); err != nil {
			return err
		}
	}
	if req.FolderID != nil {
		var folder any
		if *req.FolderID != "" {
			if ok, err := a.ownsFolder(uid, *req.FolderID); err != nil {
				return err
			} else if !ok {
				return errNotFound
			}
			folder = *req.FolderID
		}
		if _, err := a.db.Exec(`UPDATE items SET folder_id = ? WHERE id = ?`, folder, it.ID); err != nil {
			return err
		}
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

func (a *App) handleDeleteItem(w http.ResponseWriter, r *http.Request) error {
	it, _, err := a.authorizeItem(r, r.PathValue("id"))
	if err != nil {
		return err
	}
	if _, err := a.db.Exec(`DELETE FROM items WHERE id = ?`, it.ID); err != nil {
		return err
	}
	a.removeBlobs([]string{it.ID})
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

func (a *App) handleItemBlob(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	it, owner, err := a.authorizeItem(r, r.PathValue("id"))
	if err != nil {
		return err
	}
	if owner != uid || !it.Ready {
		return errNotFound
	}
	return a.serveBlob(w, r, it.ID)
}

func (a *App) serveBlob(w http.ResponseWriter, r *http.Request, id string) error {
	f, err := os.Open(a.blobPath(id))
	if err != nil {
		if os.IsNotExist(err) {
			return errNotFound
		}
		return err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return err
	}
	h := w.Header()
	h.Set("Content-Type", "application/octet-stream")
	h.Set("Content-Disposition", "attachment")
	h.Set("Cache-Control", "no-store")
	http.ServeContent(w, r, "", st.ModTime(), f)
	return nil
}

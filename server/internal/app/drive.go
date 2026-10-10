package app

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"coffer/internal/storage"
	"coffer/internal/store"
)

const (
	gcmOverhead  = 16
	minChunkSize = 64 << 10
	maxChunkSize = 16 << 20
	maxMetaSize  = 8 << 10
	// Each chunk being uploaded is held in memory until the store has it. This
	// caps how much memory all uploads together may hold; further chunks wait
	// their turn. It keeps a burst of large chunks from exhausting the server.
	chunkMemory = 192 << 20
	// A quick share of several files carries a small encrypted manifest.
	maxAnonManifest = 256 << 10
)

// removeBlobs deletes stored ciphertext in the background. Anything that
// fails here is picked up later by the janitor's orphan sweep.
func (a *App) removeBlobs(ids []string) {
	for _, id := range ids {
		a.tickets.revokeItem(id)
		go func() {
			a.removing <- struct{}{}
			defer func() { <-a.removing }()
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
			defer cancel()
			if err := a.blobs.Remove(ctx, id); err != nil {
				log.Printf("storage: remove %s: %v", id, err)
			}
		}()
	}
}

// ---------------------------------------------------------------- drive listing

func (a *App) handleDrive(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	folders, err := a.db.Folders(uid)
	if err != nil {
		return err
	}
	items, err := a.db.DriveItems(uid)
	if err != nil {
		return err
	}
	shares, err := a.db.Shares(uid)
	if err != nil {
		return err
	}
	requests, err := a.db.Requests(uid)
	if err != nil {
		return err
	}
	sub, err := a.subState(uid)
	if err != nil {
		return err
	}
	quota := sub.allowance()
	used, err := a.db.Usage(uid)
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{
		"folders": folders, "items": items, "shares": shares, "requests": requests,
		"usage": map[string]int64{"used": used, "quota": quota},
	})
	return nil
}

// --------------------------------------------------------------------- folders

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
	if _, err := a.writeQuota(uid); err != nil {
		return err
	}
	if req.ParentID != nil {
		if ok, err := a.db.OwnsFolder(uid, *req.ParentID); err != nil {
			return err
		} else if !ok {
			return errNotFound
		}
	}
	id := randomID(26)
	if err := a.db.CreateFolder(id, uid, req.ParentID, req.EncName); err != nil {
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
	if ok, err := a.db.OwnsFolder(uid, id); err != nil {
		return err
	} else if !ok {
		return errNotFound
	}
	if req.EncName != nil {
		if len(req.EncName) < 29 || len(req.EncName) > 2048 {
			return errf(http.StatusBadRequest, "invalid folder name")
		}
		if err := a.db.RenameFolder(id, req.EncName); err != nil {
			return err
		}
	}
	if req.ParentID != nil {
		var parent *string
		if *req.ParentID != "" {
			// Walk up from the new parent; reaching ourselves would create a cycle.
			cur := *req.ParentID
			for cur != "" {
				if cur == id {
					return errf(http.StatusBadRequest, "cannot move a folder into itself")
				}
				up, err := a.db.FolderParent(uid, cur)
				if errors.Is(err, store.ErrNotFound) {
					return errNotFound
				} else if err != nil {
					return err
				}
				cur = up
			}
			parent = req.ParentID
		}
		if err := a.db.MoveFolder(id, parent); err != nil {
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
	if ok, err := a.db.OwnsFolder(uid, id); err != nil {
		return err
	} else if !ok {
		return errNotFound
	}
	ids, err := a.db.FolderItemIDs(id)
	if err != nil {
		return err
	}
	// Subfolders, items and their share links cascade.
	if err := a.db.DeleteFolder(id); err != nil {
		return err
	}
	a.removeBlobs(ids)
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

// ----------------------------------------------------------------------- items

func (a *App) loadItem(id string) (*store.Item, error) {
	it, err := a.db.Item(id)
	if errors.Is(err, store.ErrNotFound) {
		return nil, errNotFound
	}
	return it, err
}

// authorizeItem allows the signed-in owner, or the holder of the manage token
// handed out when a quick share was created.
func (a *App) authorizeItem(r *http.Request, id string) (*store.Item, string, error) {
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

// authorizeUpload allows whoever may add to an unfinished upload: the item's
// owner, the holder of a quick share's manage token or, for a file coming in
// through a request, the holder of the token handed out when it started.
// That last token is good for nothing else, and dies when the upload is done.
func (a *App) authorizeUpload(r *http.Request, id string) (*store.Item, error) {
	if !itemIDRe.MatchString(id) {
		return nil, errNotFound
	}
	it, err := a.loadItem(id)
	if err != nil {
		return nil, err
	}
	if tok := r.Header.Get("X-Manage-Token"); tok != "" && it.ManageHash != nil && (!it.UserID.Valid || !it.Ready) {
		if equal(sha([]byte(tok)), it.ManageHash) {
			return it, nil
		}
		return nil, errNotFound
	}
	if it.UserID.Valid {
		if uid, err := a.currentUser(r); err != nil {
			return nil, err
		} else if uid == it.UserID.String {
			return it, nil
		}
	}
	return nil, errNotFound
}

// handleCreateItem starts an upload. With a wrapped key the item belongs to
// the signed-in user's drive. With a request id it goes into the drive of
// whoever made that file request (see requests.go). Otherwise it is part of a
// quick share: owned by nobody, expiring on its own and managed with a token.
// Sending that token again adds further files to the same quick share.
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
		RequestID  string  `json:"requestId"`
		SealedKey  []byte  `json:"sealedKey"`
		LinkKey    []byte  `json:"linkKey"` // adding through a folder link: the key wrapped for that link
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

	var owner *string
	var manageToken string
	var manageHash []byte
	var expires *int64
	var requestID *string
	if req.RequestID == "" && (req.SealedKey != nil || req.LinkKey != nil) {
		return errf(http.StatusBadRequest, "invalid upload parameters")
	}
	if req.RequestID != "" {
		if req.Kind != "file" || req.WrappedKey != nil || req.FolderID != nil {
			return errf(http.StatusBadRequest, "invalid upload parameters")
		}
		rq, unlock, err := a.admitUpload(r, req.RequestID, req.SealedKey, req.Size, plain)
		if err != nil {
			return err
		}
		defer unlock()
		// Only a file added through a folder link carries a key for that link.
		if (req.LinkKey != nil) != (rq.ShareID != nil) || len(req.LinkKey) > 256 || (req.LinkKey != nil && len(req.LinkKey) < 60) {
			return errf(http.StatusBadRequest, "invalid key material")
		}
		owner, requestID, req.FolderID = &rq.UserID, &rq.ID, rq.FolderID
		manageToken = randomToken()
		manageHash = sha([]byte(manageToken))
	} else if req.WrappedKey != nil {
		if uid == "" {
			return errUnauthorized
		}
		if len(req.WrappedKey) < 60 || len(req.WrappedKey) > 256 {
			return errf(http.StatusBadRequest, "invalid key material")
		}
		if plain > a.cfg.MaxFileSize {
			return errf(http.StatusRequestEntityTooLarge, "file exceeds the maximum size")
		}
		if req.FolderID != nil {
			if ok, err := a.db.OwnsFolder(uid, *req.FolderID); err != nil {
				return err
			} else if !ok {
				return errNotFound
			}
		}
		// Two uploads racing for the last free bytes must not both win.
		defer a.locks.lock("user:" + uid)()
		quota, err := a.writeQuota(uid)
		if err != nil {
			return err
		}
		used, err := a.db.Usage(uid)
		if err != nil {
			return err
		}
		if used+req.Size > quota {
			return errf(http.StatusInsufficientStorage, "not enough storage left in your drive")
		}
		owner = &uid
	} else {
		if !a.cfg.AllowAnonymous {
			return errf(http.StatusUnauthorized, "sign in to upload")
		}
		if req.FolderID != nil {
			return errf(http.StatusBadRequest, "quick shares cannot be stored in a drive")
		}
		if tok := r.Header.Get("X-Manage-Token"); tok != "" {
			manageHash = sha([]byte(tok))
			defer a.locks.lock("share:" + string(manageHash))()
			qs, err := a.db.QuickShare(manageHash, gcmOverhead)
			if errors.Is(err, store.ErrNotFound) {
				return errNotFound
			} else if err != nil {
				return err
			}
			switch {
			case req.Kind == "bundle" && (qs.Bundles > 0 || plain > maxAnonManifest):
				return errf(http.StatusBadRequest, "invalid upload parameters")
			case req.Kind != "bundle" && qs.Files >= a.cfg.AnonMaxFiles:
				return errf(http.StatusRequestEntityTooLarge, "too many files for one quick share")
			case req.Kind != "bundle" && qs.Bytes+plain > a.cfg.AnonMaxShareSize:
				return errf(http.StatusRequestEntityTooLarge, "that is more than a quick share can hold")
			}
			expires = &qs.ExpiresAt
		} else {
			if req.Kind == "bundle" {
				return errf(http.StatusBadRequest, "invalid upload parameters")
			}
			if !a.anonLimit.Allow(clientIP(r, a.cfg.TrustProxy)) {
				return errf(http.StatusTooManyRequests, "upload limit reached, try again later")
			}
			if plain > a.cfg.AnonMaxShareSize {
				return errf(http.StatusRequestEntityTooLarge, "that is more than a quick share can hold")
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
	}

	err = a.db.CreateItem(store.NewItem{
		ID: req.ID, UserID: owner, FolderID: req.FolderID, Kind: req.Kind, EncMeta: req.EncMeta, WrappedKey: req.WrappedKey,
		Size: req.Size, ChunkSize: req.ChunkSize, ChunkCount: req.ChunkCount, ManageHash: manageHash, ExpiresAt: expires,
		RequestID: requestID, SealedKey: req.SealedKey, LinkKey: req.LinkKey,
	})
	if err != nil {
		return errf(http.StatusConflict, "item already exists")
	}
	resp := map[string]any{"id": req.ID}
	if expires != nil {
		resp["expiresAt"] = *expires
	}
	if manageToken != "" {
		resp["manageToken"] = manageToken
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

	it, err := a.authorizeUpload(r, id)
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

	// Chunks are small; holding one in memory lets the store retry a failed write.
	if err := a.chunks.Acquire(r.Context(), want); err != nil {
		return errf(http.StatusServiceUnavailable, "the server is busy, try again shortly")
	}
	defer a.chunks.Release(want)
	body := http.MaxBytesReader(w, r.Body, want)
	data := make([]byte, want)
	if _, err := io.ReadFull(body, data); err != nil {
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			return errf(http.StatusBadRequest, "chunk has the wrong size")
		}
		return err
	}
	if _, err := io.ReadFull(body, make([]byte, 1)); err != io.EOF {
		return errf(http.StatusBadRequest, "chunk has the wrong size")
	}
	if err := a.blobs.Put(r.Context(), id, n, it.RecvBytes, data); err != nil {
		return err
	}
	if err := a.db.AddChunk(id, want); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]int64{"received": n + 1})
	return nil
}

func (a *App) handleCompleteItem(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("id")
	unlock := a.locks.lock(id)
	defer unlock()
	it, err := a.authorizeUpload(r, id)
	if err != nil {
		return err
	}
	if it.RecvChunks != it.ChunkCount || it.RecvBytes != it.Size {
		return errf(http.StatusConflict, "upload is incomplete")
	}
	if err := a.db.FinishUpload(id); err != nil {
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
		if err := a.db.SetItemMeta(it.ID, req.EncMeta); err != nil {
			return err
		}
	}
	if req.FolderID != nil {
		var folder *string
		if *req.FolderID != "" {
			if ok, err := a.db.OwnsFolder(uid, *req.FolderID); err != nil {
				return err
			} else if !ok {
				return errNotFound
			}
			folder = req.FolderID
		}
		if err := a.db.MoveItem(it.ID, folder); err != nil {
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
	ids := []string{it.ID}
	if it.UserID.Valid {
		err = a.db.DeleteItem(it.ID)
	} else {
		// A quick share goes as a whole: every file uploaded under its token.
		if ids, err = a.db.QuickShareItemIDs(it.ManageHash); err != nil {
			return err
		}
		err = a.db.DeleteQuickShare(it.ManageHash)
	}
	if err != nil {
		return err
	}
	a.removeBlobs(ids)
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

// handleItemStatus tells the creator of a quick share whether its link is
// still live, so their browser can forget the ones that are used up.
func (a *App) handleItemStatus(w http.ResponseWriter, r *http.Request) error {
	it, _, err := a.authorizeItem(r, r.PathValue("id"))
	if err != nil {
		return err
	}
	use, err := a.db.LiveShareOf(it.ID)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, 200, map[string]any{"active": false})
		return nil
	} else if err != nil {
		return err
	}
	resp := map[string]any{"active": true, "views": use.Views}
	if use.MaxViews.Valid {
		resp["maxViews"] = use.MaxViews.Int64
	}
	if use.ExpiresAt.Valid {
		resp["expiresAt"] = use.ExpiresAt.Int64
	}
	writeJSON(w, 200, resp)
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

// serveBlob streams an item's ciphertext, chunk after chunk. The next chunk
// is requested from the store while the current one is still being sent.
func (a *App) serveBlob(w http.ResponseWriter, r *http.Request, id string) error {
	it, err := a.loadItem(id)
	if err != nil {
		return err
	}
	if !it.Ready {
		return errNotFound
	}
	h := w.Header()
	h.Set("Content-Type", "application/octet-stream")
	h.Set("Content-Disposition", "attachment")
	h.Set("Cache-Control", "no-store")
	h.Set("Content-Length", strconv.FormatInt(it.Size, 10))
	if r.Method == http.MethodHead {
		return nil
	}

	ctx, cancel := context.WithCancel(r.Context())
	type opened struct {
		rc  io.ReadCloser
		err error
	}
	full := it.ChunkSize + gcmOverhead
	open := func(n int64) (io.ReadCloser, error) {
		return a.blobs.Get(ctx, id, n, n*full, min(full, it.Size-n*full))
	}
	queue := make(chan chan opened, 1)
	go func() {
		defer close(queue)
		for n := range it.ChunkCount {
			c := make(chan opened, 1)
			select {
			case queue <- c:
			case <-ctx.Done():
				return
			}
			go func() {
				rc, err := open(n)
				c <- opened{rc, err}
			}()
		}
	}()
	defer func() {
		cancel()
		go func() {
			for c := range queue {
				if o := <-c; o.rc != nil {
					o.rc.Close()
				}
			}
		}()
	}()

	buf := make([]byte, 128<<10)
	n := int64(0)
	for c := range queue {
		o := <-c
		if o.err != nil {
			if n == 0 && storage.IsNotExist(o.err) {
				h.Del("Content-Length")
				return errNotFound
			}
			if n == 0 {
				h.Del("Content-Length")
				return o.err
			}
			// Headers are gone already; cutting the stream short tells the client.
			log.Printf("storage: read %s chunk %d: %v", id, n, o.err)
			panic(http.ErrAbortHandler)
		}
		if err := a.sendChunk(w, o.rc, buf, func() (io.ReadCloser, error) { return open(n) }); err != nil {
			if ctx.Err() == nil {
				log.Printf("storage: read %s chunk %d: %v", id, n, err)
			}
			panic(http.ErrAbortHandler)
		}
		n++
	}
	return nil
}

// sendChunk copies one chunk to the client. If the store's connection drops
// midway (a slow client can outlast it), the chunk is reopened and resumed.
func (a *App) sendChunk(w io.Writer, rc io.ReadCloser, buf []byte, reopen func() (io.ReadCloser, error)) error {
	var sent int64
	for attempt := 0; ; attempt++ {
		var readErr error
		for readErr == nil {
			var k int
			k, readErr = rc.Read(buf)
			if k > 0 {
				if _, err := w.Write(buf[:k]); err != nil {
					rc.Close()
					return err
				}
				sent += int64(k)
			}
		}
		rc.Close()
		if readErr == io.EOF {
			return nil
		}
		if attempt == 2 {
			return readErr
		}
		var err error
		if rc, err = reopen(); err != nil {
			return err
		}
		if _, err := io.CopyN(io.Discard, rc, sent); err != nil {
			rc.Close()
			return err
		}
	}
}

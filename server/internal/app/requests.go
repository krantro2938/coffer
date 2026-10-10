package app

import (
	"errors"
	"net/http"
	"regexp"
	"time"

	"coffer/internal/store"
)

// File requests. An account makes a link through which anyone can upload into
// its drive without an account of their own. The uploader's browser encrypts
// each file under a fresh key and seals that key to the request's public key;
// the private half is held, wrapped, by the owner alone. So the link gives
// upload-only access: neither it nor the server can read what came in, before
// or after.
//
// The link is /r/<id>#<secret>. The server sees the id. The secret stays in
// the fragment: it opens the request's sealed description (which carries the
// public key, so the server cannot swap in one of its own) and derives the
// token an upload must present.

const (
	maxRequests       = 200 // per account
	requestAccessSize = 32
)

var requestIDRe = regexp.MustCompile(`^[0-9a-hjkmnp-tv-z]{20}$`)

var (
	errRequestGone   = errf(http.StatusNotFound, "this upload link does not exist")
	errRequestClosed = errf(http.StatusGone, "this upload link is closed")
	errRequestPaused = errf(http.StatusGone, "this upload link is not taking files right now")
)

func (a *App) handleCreateRequest(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	var req struct {
		ID          string  `json:"id"` // chosen by the browser, which binds what it seals to it
		FolderID    *string `json:"folderId"`
		AccessHash  []byte  `json:"accessHash"`
		EncInfo     []byte  `json:"encInfo"`
		EncSecret   []byte  `json:"encSecret"`
		EncPrivate  []byte  `json:"encPrivate"`
		MaxFiles    *int64  `json:"maxFiles"`
		MaxBytes    *int64  `json:"maxBytes"`
		MaxFileSize *int64  `json:"maxFileSize"`
		ExpiresIn   *int64  `json:"expiresIn"`
		// The folder link this request stands behind: its holders may add files.
		ShareID *string `json:"shareId"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	if _, err := a.writeQuota(uid); err != nil {
		return err
	}
	if !requestIDRe.MatchString(req.ID) || len(req.AccessHash) != 32 || len(req.EncInfo) < 29 || len(req.EncInfo) > 8<<10 ||
		len(req.EncSecret) < 29 || len(req.EncSecret) > 256 || len(req.EncPrivate) < 60 || len(req.EncPrivate) > 1024 {
		return errf(http.StatusBadRequest, "invalid key material")
	}
	if (req.MaxFiles != nil && (*req.MaxFiles < 1 || *req.MaxFiles > 10000)) ||
		(req.MaxBytes != nil && *req.MaxBytes < 1) || (req.MaxFileSize != nil && *req.MaxFileSize < 1) {
		return errf(http.StatusBadRequest, "invalid limits")
	}
	var expires *int64
	if req.ExpiresIn != nil {
		if *req.ExpiresIn < 60 || *req.ExpiresIn > 365*24*3600 {
			return errf(http.StatusBadRequest, "invalid expiry")
		}
		e := time.Now().Unix() + *req.ExpiresIn
		expires = &e
	}
	if req.FolderID != nil {
		if ok, err := a.db.OwnsFolder(uid, *req.FolderID); err != nil {
			return err
		} else if !ok {
			return errNotFound
		}
	}
	if req.ShareID != nil {
		// It has to be a link of theirs, to a folder, and the request must upload into that folder.
		target, owner, err := a.db.ShareTarget(normalizeShareID(*req.ShareID))
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			return err
		}
		if err != nil || owner.String != uid || req.FolderID == nil {
			return errNotFound
		}
		if it, err := a.loadItem(target); err != nil {
			return err
		} else if it.Kind != "bundle" {
			return errf(http.StatusBadRequest, "invalid folder share")
		}
		id := normalizeShareID(*req.ShareID)
		req.ShareID = &id
	}
	existing, err := a.db.Requests(uid)
	if err != nil {
		return err
	}
	own := 0
	for _, r := range existing {
		if r.ShareID == nil {
			own++
		}
	}
	if req.ShareID == nil && own >= maxRequests {
		return errf(http.StatusConflict, "remove some closed requests before making more")
	}
	nr := store.NewRequest{
		ID: req.ID, UserID: uid, FolderID: req.FolderID, AccessHash: req.AccessHash, EncInfo: req.EncInfo, EncSecret: req.EncSecret,
		EncPrivate: req.EncPrivate, MaxFiles: req.MaxFiles, MaxBytes: req.MaxBytes, MaxFileSize: req.MaxFileSize, ExpiresAt: expires,
		ShareID: req.ShareID,
	}
	if err := a.db.CreateRequest(nr); errors.Is(err, store.ErrExists) {
		return errf(http.StatusConflict, "request already exists")
	} else if err != nil {
		return err
	}
	rq, err := a.db.Request(nr.ID)
	if err != nil {
		return err
	}
	writeJSON(w, 201, rq)
	return nil
}

func (a *App) handleListRequests(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	requests, err := a.db.Requests(uid)
	if err != nil {
		return err
	}
	writeJSON(w, 200, requests)
	return nil
}

// handleRevokeRequest closes a request for good. What came in through it stays.
func (a *App) handleRevokeRequest(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	err = a.db.RevokeRequest(uid, r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		return errNotFound
	} else if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

// handleDeleteRequest takes a request off the list. Its files stay in the drive.
func (a *App) handleDeleteRequest(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	err = a.db.DeleteRequest(uid, r.PathValue("id"))
	switch {
	case errors.Is(err, store.ErrNotFound):
		return errNotFound
	case errors.Is(err, store.ErrExists):
		return errf(http.StatusConflict, "open your drive once so the files that came in are filed, then try again")
	case err != nil:
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

// handleAdoptItem swaps the key an uploader sealed to a request for one
// wrapped under the owner's master key, which only the owner's browser can make.
func (a *App) handleAdoptItem(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	var req struct {
		WrappedKey []byte `json:"wrappedKey"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	if len(req.WrappedKey) < 60 || len(req.WrappedKey) > 256 {
		return errf(http.StatusBadRequest, "invalid key material")
	}
	err = a.db.AdoptItem(uid, r.PathValue("id"), req.WrappedKey)
	if errors.Is(err, store.ErrNotFound) {
		return errNotFound
	} else if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

// ------------------------------------------------------------ uploader side

// fileLimit is the largest file, in plaintext bytes, a request takes.
func (a *App) fileLimit(rq *store.Request) int64 {
	if rq.MaxFileSize != nil && *rq.MaxFileSize < a.cfg.MaxFileSize {
		return *rq.MaxFileSize
	}
	return a.cfg.MaxFileSize
}

// handleRequestInfo is what anyone holding a request's id may learn: its
// sealed description and what it still takes. Nothing about what came in.
func (a *App) handleRequestInfo(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("id")
	if !requestIDRe.MatchString(id) {
		return errRequestGone
	}
	if !a.shareOpenLimit.Allow(clientIP(r, a.cfg.TrustProxy)) {
		return errf(http.StatusTooManyRequests, "too many attempts, try again later")
	}
	rq, err := a.db.Request(id)
	if errors.Is(err, store.ErrNotFound) {
		return errRequestGone
	} else if err != nil {
		return err
	}
	// The request behind a folder link has no page of its own.
	if rq.ShareID != nil {
		return errRequestGone
	}
	if !rq.Open() {
		return errRequestClosed
	}
	if _, err := a.writeQuota(rq.UserID); err != nil {
		var ae *apiError
		if errors.As(err, &ae) {
			return errRequestPaused
		}
		return err
	}
	resp := map[string]any{"id": rq.ID, "encInfo": rq.EncInfo, "maxFileSize": a.fileLimit(rq)}
	if rq.MaxFiles != nil {
		resp["filesLeft"] = max(*rq.MaxFiles-rq.Uploads, 0)
	}
	if rq.MaxBytes != nil {
		resp["bytesLeft"] = max(*rq.MaxBytes-rq.Bytes, 0)
	}
	if rq.ExpiresAt != nil {
		resp["expiresAt"] = *rq.ExpiresAt
	}
	writeJSON(w, 200, resp)
	return nil
}

// admitUpload decides whether a file may start coming in through a request:
// the uploader holds the link, the request is open and has room for it, and
// so has its owner's drive. size is the upload's ciphertext, plain its
// plaintext. The caller must call unlock once the upload is recorded: until
// then no other upload to the same drive is admitted, so uploads racing for
// the last place cannot both get it.
func (a *App) admitUpload(r *http.Request, id string, sealedKey []byte, size, plain int64) (rq *store.Request, unlock func(), err error) {
	if !requestIDRe.MatchString(id) {
		return nil, nil, errRequestGone
	}
	if !a.requestLimit.Allow(clientIP(r, a.cfg.TrustProxy)) || a.shareFailLimit.Blocked("request:"+id) {
		return nil, nil, errf(http.StatusTooManyRequests, "upload limit reached, try again later")
	}
	if rq, err = a.db.Request(id); errors.Is(err, store.ErrNotFound) {
		return nil, nil, errRequestGone
	} else if err != nil {
		return nil, nil, err
	}
	access, _ := decodeB64(r.Header.Get("X-Request-Access"))
	if len(access) != requestAccessSize || !equal(sha(access), rq.AccessHash) {
		a.shareFailLimit.Allow("request:" + id)
		return nil, nil, errf(http.StatusForbidden, "this upload link is incomplete or damaged")
	}
	// An ephemeral public key, a nonce and the wrapped file key.
	if len(sealedKey) < 100 || len(sealedKey) > 256 {
		return nil, nil, errf(http.StatusBadRequest, "invalid key material")
	}

	release := a.locks.lock("user:" + rq.UserID)
	defer func() {
		if err != nil {
			release()
		}
	}()
	// Read again now that nothing else can be admitted alongside.
	if rq, err = a.db.Request(id); errors.Is(err, store.ErrNotFound) {
		return nil, nil, errRequestGone
	} else if err != nil {
		return nil, nil, err
	}
	if !rq.Open() {
		return nil, nil, errRequestClosed
	}
	// A folder link takes files for as long as it can be opened.
	if rq.ShareID != nil {
		if _, err = a.db.SharePreview(*rq.ShareID, a.billing != nil); errors.Is(err, store.ErrNotFound) {
			return nil, nil, errRequestClosed
		} else if err != nil {
			return nil, nil, err
		}
	}
	switch {
	case plain > a.fileLimit(rq):
		return nil, nil, errf(http.StatusRequestEntityTooLarge, "file exceeds the maximum size")
	case rq.MaxFiles != nil && rq.Uploads >= *rq.MaxFiles:
		return nil, nil, errf(http.StatusRequestEntityTooLarge, "this upload link has all the files it asked for")
	case rq.MaxBytes != nil && rq.Bytes+size > *rq.MaxBytes:
		return nil, nil, errf(http.StatusRequestEntityTooLarge, "that is more than this upload link can still take")
	}
	quota, err := a.writeQuota(rq.UserID)
	if err != nil {
		var ae *apiError
		if errors.As(err, &ae) {
			err = errRequestPaused // why is the owner's business
		}
		return nil, nil, err
	}
	used, err := a.db.Usage(rq.UserID)
	if err != nil {
		return nil, nil, err
	}
	if used+size > quota {
		return nil, nil, errf(http.StatusInsufficientStorage, "there is not enough room left for this file")
	}
	return rq, release, nil
}

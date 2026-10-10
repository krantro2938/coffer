package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"coffer/internal/store"
)

// errShareGone is what a recipient is told about a link that cannot be opened:
// it never existed, expired, was used up or revoked, or its owner's drive is
// paused. Which of those it was is not theirs to know.
var errShareGone = errf(http.StatusNotFound, "this link does not exist, has expired or has been used up")

func (a *App) handleListShares(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	shares, err := a.db.Shares(uid)
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
		EncWrap    []byte     `json:"encWrap"`    // lets a folder link follow its folder
		OpenSecret *string    `json:"openSecret"` // short links: stored so the id alone opens it
		PwSalt     []byte     `json:"pwSalt"`
		PwKDF      *KDFParams `json:"pwKdf"`
		MaxViews   *int64     `json:"maxViews"`
		ExpiresIn  *int64     `json:"expiresIn"`
		ItemIDs    []string   `json:"itemIds"` // folder links: the files the manifest lists
	}
	if err := readJSONLimit(w, r, &req, 1<<20); err != nil {
		return err
	}
	it, uid, err := a.authorizeItem(r, req.ItemID)
	if err != nil {
		return err
	}
	if !it.Ready {
		return errf(http.StatusConflict, "upload is not finished")
	}
	if uid != "" {
		if _, err := a.writeQuota(uid); err != nil {
			return err
		}
	}
	if len(req.WrappedKey) < 60 || len(req.WrappedKey) > 256 || len(req.AccessHash) != 32 {
		return errf(http.StatusBadRequest, "invalid key material")
	}
	if len(req.EncSecret) > 256 || len(req.EncWrap) > 256 || ((req.EncSecret != nil || req.EncWrap != nil) && uid == "") {
		return errf(http.StatusBadRequest, "invalid key material")
	}
	if req.OpenSecret != nil && !openSecretRe.MatchString(*req.OpenSecret) {
		return errf(http.StatusBadRequest, "invalid short link")
	}
	if (it.Kind == "bundle") != (req.ItemIDs != nil) || len(req.ItemIDs) > 10000 {
		return errf(http.StatusBadRequest, "invalid folder share")
	}
	for _, id := range req.ItemIDs {
		// The listed files must be the sharer's own: same drive, or same quick share.
		if ok, err := a.db.Shareable(id, it); err != nil {
			return err
		} else if !ok {
			return errNotFound
		}
	}
	var pwParams *string
	if req.PwSalt != nil || req.PwKDF != nil {
		if len(req.PwSalt) != 16 || req.PwKDF == nil || !req.PwKDF.valid() {
			return errf(http.StatusBadRequest, "invalid password parameters")
		}
		p := req.PwKDF.json()
		pwParams = &p
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
	sh := store.NewShare{
		ItemID: it.ID, WrappedKey: req.WrappedKey, AccessHash: req.AccessHash, EncSecret: req.EncSecret, EncWrap: req.EncWrap, OpenSecret: req.OpenSecret,
		PwSalt: req.PwSalt, PwParams: pwParams, MaxViews: req.MaxViews, ExpiresAt: expires, ItemIDs: req.ItemIDs,
	}
	if uid != "" {
		sh.UserID = &uid
	}
	// Ids are short and random; on the rare clash, draw again.
	for range 5 {
		sh.ID = randomID(7)
		if err = a.db.CreateShare(sh); !errors.Is(err, store.ErrExists) {
			break
		}
	}
	if err != nil {
		return err
	}
	writeJSON(w, 201, store.Share{ID: sh.ID, ItemID: it.ID, HasPassword: req.PwSalt != nil, EncSecret: req.EncSecret,
		Short: req.OpenSecret != nil, MaxViews: req.MaxViews, ExpiresAt: expires, CreatedAt: now(), EncWrap: req.EncWrap})
	return nil
}

// handleRetargetShare points a folder link at a fresh manifest. A folder link
// shares a snapshot the owner's browser encrypted; when the folder changes,
// that browser uploads a new snapshot and moves the link over to it here. The
// link itself (its id, key, password, views and expiry) stays as it was.
func (a *App) handleRetargetShare(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	id := normalizeShareID(r.PathValue("id"))
	var req struct {
		ItemID     string   `json:"itemId"`
		WrappedKey []byte   `json:"wrappedKey"`
		ItemIDs    []string `json:"itemIds"`
	}
	if err := readJSONLimit(w, r, &req, 1<<20); err != nil {
		return err
	}
	it, owner, err := a.authorizeItem(r, req.ItemID)
	if err != nil {
		return err
	}
	if owner != uid || !it.Ready || it.Kind != "bundle" || req.ItemIDs == nil || len(req.ItemIDs) > 10000 {
		return errf(http.StatusBadRequest, "invalid folder share")
	}
	if len(req.WrappedKey) < 60 || len(req.WrappedKey) > 256 {
		return errf(http.StatusBadRequest, "invalid key material")
	}
	for _, item := range req.ItemIDs {
		if ok, err := a.db.Shareable(item, it); err != nil {
			return err
		} else if !ok {
			return errNotFound
		}
	}
	// Only a folder link can be moved: its manifest exists for it alone.
	current, _, err := a.db.ShareTarget(id)
	if errors.Is(err, store.ErrNotFound) {
		return errNotFound
	} else if err != nil {
		return err
	}
	if cur, err := a.loadItem(current); err != nil {
		return err
	} else if cur.Kind != "bundle" || cur.UserID.String != uid {
		return errNotFound
	}
	previous, err := a.db.RetargetShare(uid, id, it.ID, req.WrappedKey, req.ItemIDs)
	if errors.Is(err, store.ErrNotFound) {
		return errNotFound
	} else if err != nil {
		return err
	}
	// Whoever has the link open keeps downloading from it.
	a.tickets.retarget(id, it.ID)
	if previous != it.ID {
		if gone, err := a.db.DeleteUnsharedBundle(previous); err != nil {
			return err
		} else if gone {
			a.removeBlobs([]string{previous})
		}
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

func (a *App) handleDeleteShare(w http.ResponseWriter, r *http.Request) error {
	id := normalizeShareID(r.PathValue("id"))
	itemID, _, err := a.db.ShareTarget(id)
	if errors.Is(err, store.ErrNotFound) {
		return errNotFound
	} else if err != nil {
		return err
	}
	it, _, err := a.authorizeItem(r, itemID)
	if err != nil {
		return err
	}
	if err := a.db.DeleteShare(id); err != nil {
		return err
	}
	a.tickets.revokeShare(id)
	// A folder link's manifest exists only for that link.
	if it.Kind == "bundle" {
		gone, err := a.db.DeleteUnsharedBundle(it.ID)
		if err != nil {
			return err
		}
		if gone {
			a.removeBlobs([]string{it.ID})
		}
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

// ------------------------------------------------------------ recipient side

func (a *App) handleShareInfo(w http.ResponseWriter, r *http.Request) error {
	id := normalizeShareID(r.PathValue("id"))
	if !shareIDRe.MatchString(id) {
		return errNotFound
	}
	if !a.shareOpenLimit.Allow(clientIP(r, a.cfg.TrustProxy)) {
		return errf(http.StatusTooManyRequests, "too many attempts, try again later")
	}
	sh, err := a.db.SharePreview(id, a.billing != nil)
	if errors.Is(err, store.ErrNotFound) {
		return errShareGone
	} else if err != nil {
		return err
	}
	// limited: opening uses up a view, so the page asks before it does.
	resp := map[string]any{"id": id, "hasPassword": sh.PwSalt != nil, "limited": sh.Limited}
	if sh.OpenSecret.Valid {
		resp["secret"] = sh.OpenSecret.String
	}
	if sh.PwSalt != nil {
		var kdf KDFParams
		_ = json.Unmarshal([]byte(sh.PwParams.String), &kdf)
		resp["pwSalt"] = sh.PwSalt
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
	if !a.shareOpenLimit.Allow(clientIP(r, a.cfg.TrustProxy)) || a.shareFailLimit.Blocked(id) {
		return errf(http.StatusTooManyRequests, "too many attempts, try again later")
	}
	var req struct {
		Access []byte `json:"access"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}

	o, err := a.db.OpenShare(id, a.billing != nil, func(accessHash []byte) error {
		if !equal(sha(req.Access), accessHash) {
			a.shareFailLimit.Allow(id)
			return errf(http.StatusUnauthorized, "wrong password or damaged link")
		}
		return nil
	})
	if errors.Is(err, store.ErrNotFound) {
		return errShareGone
	} else if err != nil {
		return err
	}

	resp := map[string]any{
		"itemId":     o.ItemID,
		"kind":       o.Kind,
		"encMeta":    o.EncMeta,
		"wrappedKey": o.WrappedKey,
		"size":       o.Size,
		"chunkSize":  o.ChunkSize,
		"chunkCount": o.ChunkCount,
		"ticket":     a.tickets.issue(id, o.ItemID),
		"burned":     o.Burned,
	}
	if o.MaxViews.Valid {
		resp["viewsLeft"] = max(o.MaxViews.Int64-o.Views, 0)
	}
	if o.ExpiresAt.Valid {
		resp["expiresAt"] = o.ExpiresAt.Int64
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
	item := r.URL.Query().Get("item")
	if item == "" || item == t.itemID {
		return a.serveBlob(w, r, t.itemID)
	}
	// Folder links may also serve the files listed in their manifest, and the
	// ones added through them since it was written.
	ok, err := a.db.ShareServes(id, item)
	if err == nil && !ok {
		ok, err = a.db.ShareAdded(id, item)
	}
	if err != nil {
		return err
	} else if !ok {
		return errf(http.StatusNotFound, "this file is no longer available")
	}
	return a.serveBlob(w, r, item)
}

// handleShareAdded lists what has been added through a folder link since its
// manifest was written, each with its key wrapped for the link. Like the
// manifest, it is only for someone who has opened the link.
func (a *App) handleShareAdded(w http.ResponseWriter, r *http.Request) error {
	id := normalizeShareID(r.PathValue("id"))
	if t, ok := a.tickets.get(r.Header.Get("X-Ticket")); !ok || t.shareID != id {
		return errf(http.StatusForbidden, "download ticket expired, reopen the link")
	}
	added, err := a.db.AddedItems(id)
	if err != nil {
		return err
	}
	writeJSON(w, 200, added)
	return nil
}

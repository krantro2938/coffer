package app

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"

	"coffer/internal/store"
)

// KDFParams describe the Argon2id parameters the browser uses to stretch the
// account password. They are chosen client-side but must meet our floor.
type KDFParams struct {
	Alg string `json:"alg"`
	M   int    `json:"m"` // memory, KiB
	T   int    `json:"t"` // iterations
	P   int    `json:"p"` // parallelism
}

var defaultKDF = KDFParams{Alg: "argon2id", M: 65536, T: 3, P: 1}

func (k KDFParams) valid() bool {
	return k.Alg == "argon2id" && k.M >= 65536 && k.M <= 1<<20 && k.T >= 3 && k.T <= 20 && k.P >= 1 && k.P <= 8
}

func (k KDFParams) json() string {
	b, _ := json.Marshal(k)
	return string(b)
}

func normEmail(e string) string { return strings.ToLower(strings.TrimSpace(e)) }

// authHash peppers client auth keys so a stolen database alone is useless.
func (a *App) authHash(key []byte) []byte { return hmacSHA(a.secret, append([]byte("auth:"), key...)) }

func (a *App) handleParams(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		Email string `json:"email"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	email := normEmail(req.Email)
	salt, params, err := a.db.KDF(email)
	if errors.Is(err, store.ErrNotFound) {
		// Deterministic decoy so this endpoint does not reveal which emails exist.
		salt = hmacSHA(a.secret, []byte("salt:"+email))[:16]
		params = defaultKDF.json()
	} else if err != nil {
		return err
	}
	var kdf KDFParams
	_ = json.Unmarshal([]byte(params), &kdf)
	writeJSON(w, 200, map[string]any{"salt": salt, "kdf": kdf})
	return nil
}

type registerReq struct {
	Email                    string    `json:"email"`
	Salt                     []byte    `json:"salt"`
	KDF                      KDFParams `json:"kdf"`
	AuthKey                  []byte    `json:"authKey"`
	WrappedMasterKey         []byte    `json:"wrappedMasterKey"`
	RecoveryAuthKey          []byte    `json:"recoveryAuthKey"`
	RecoveryWrappedMasterKey []byte    `json:"recoveryWrappedMasterKey"`
	Lang                     string    `json:"lang"`   // for the emails we send
	Invite                   string    `json:"invite"` // token from an admin's invitation
}

func validKeyMaterial(salt []byte, kdf KDFParams, authKey, wrapped []byte) bool {
	return len(salt) >= 16 && len(salt) <= 64 && kdf.valid() && len(authKey) == 32 &&
		len(wrapped) >= 28+32 && len(wrapped) <= 256
}

func (a *App) handleRegister(w http.ResponseWriter, r *http.Request) error {
	if !a.cfg.AllowRegistration {
		return errf(http.StatusForbidden, "registration is disabled on this server")
	}
	var req registerReq
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	email := normEmail(req.Email)
	if len(email) > 254 || !emailRe.MatchString(email) {
		return errf(http.StatusBadRequest, "please enter a valid email address")
	}
	if !validKeyMaterial(req.Salt, req.KDF, req.AuthKey, req.WrappedMasterKey) ||
		len(req.RecoveryAuthKey) != 32 || len(req.RecoveryWrappedMasterKey) < 60 || len(req.RecoveryWrappedMasterKey) > 256 {
		return errf(http.StatusBadRequest, "invalid key material")
	}
	uid := randomID(26)
	quota := a.cfg.UserQuota
	if a.billing != nil {
		quota = 0 // a plan sets it
	}
	lang := "en"
	if req.Lang == "ru" {
		lang = "ru"
	}
	// The address counts as proven if Google just vouched for it; otherwise a code is emailed.
	verified := a.mail == nil
	var googleSub *string
	if t := a.readTicket(r); t != nil && t.Email == email {
		verified, googleSub = true, &t.Sub
		http.SetCookie(w, a.authCookie(r, googleCookie, "", 0))
	}
	// An invitation was emailed to this address, which proves it, and carries agreed terms.
	var inv *store.Invite
	if req.Invite != "" {
		var err error
		if inv, err = a.invite(req.Invite); err != nil {
			return err
		}
		if inv.Email != email {
			return errf(http.StatusBadRequest, "this invitation is for a different email address")
		}
		verified = true
	}
	// An earlier sign-up that never proved this address must not block its owner.
	if err := a.db.DeleteUnverifiedByEmail(email); err != nil {
		return err
	}
	err := a.db.CreateUser(store.NewUser{
		ID: uid, Email: email, KDFSalt: req.Salt, KDFParams: req.KDF.json(),
		AuthHash: a.authHash(req.AuthKey), WrappedMK: req.WrappedMasterKey,
		RecoveryAuthHash: a.authHash(req.RecoveryAuthKey), RecoveryWrappedMK: req.RecoveryWrappedMasterKey,
		Quota: quota, Verified: verified, GoogleSub: googleSub, Lang: lang,
	})
	if errors.Is(err, store.ErrExists) {
		return errf(http.StatusConflict, "an account with this email already exists")
	} else if err != nil {
		return err
	}
	if inv != nil {
		if err := a.db.AcceptInvite(sha([]byte(req.Invite)), uid, inv); err != nil {
			return err
		}
	}
	if !verified {
		if err := a.sendCode(r.Context(), uid, email, lang); err != nil {
			log.Printf("mail: code: %v", err)
			_ = a.db.DeleteUser(uid)
			return errf(http.StatusBadGateway, "the code could not be sent, try again shortly")
		}
	}
	if err := a.startSession(w, r, uid); err != nil {
		return err
	}
	return a.writeMe(w, uid)
}

func (a *App) handleLogin(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		Email   string `json:"email"`
		AuthKey []byte `json:"authKey"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	email := normEmail(req.Email)
	if a.loginFailLimit.Blocked(email) {
		return errf(http.StatusTooManyRequests, "too many failed attempts, try again in 15 minutes")
	}
	uid, err := a.verifyPassword(email, req.AuthKey)
	if err != nil {
		return err
	}
	if err := a.refuseSuspended(uid); err != nil {
		return err
	}
	if err := a.startSession(w, r, uid); err != nil {
		return err
	}
	return a.writeMe(w, uid)
}

// refuseSuspended keeps an account an admin has suspended from signing in.
func (a *App) refuseSuspended(uid string) error {
	suspended, err := a.db.Suspended(uid)
	if err != nil {
		return err
	}
	if suspended {
		return errSuspended
	}
	return nil
}

var errBadLogin = errf(http.StatusUnauthorized, "incorrect email or password")

func (a *App) verifyPassword(email string, authKey []byte) (string, error) {
	uid, hash, err := a.db.Credentials(email)
	if errors.Is(err, store.ErrNotFound) {
		a.loginFailLimit.Allow(email)
		return "", errBadLogin
	} else if err != nil {
		return "", err
	}
	if !equal(a.authHash(authKey), hash) {
		a.loginFailLimit.Allow(email)
		return "", errBadLogin
	}
	return uid, nil
}

func (a *App) handleLogout(w http.ResponseWriter, r *http.Request) error {
	a.clearSession(w, r)
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

func (a *App) handleMe(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	return a.writeMe(w, uid)
}

func (a *App) writeMe(w http.ResponseWriter, uid string) error {
	p, err := a.db.Profile(uid)
	if err != nil {
		return err
	}
	sub, err := a.subState(uid)
	if err != nil {
		return err
	}
	used, err := a.db.Usage(uid)
	if err != nil {
		return err
	}
	var kdf KDFParams
	_ = json.Unmarshal([]byte(p.KDFParams), &kdf)
	writeJSON(w, 200, map[string]any{
		"email":            p.Email,
		"salt":             p.KDFSalt,
		"kdf":              kdf,
		"wrappedMasterKey": p.WrappedMK,
		"quota":            sub.allowance(),
		"used":             used,
		"billing":          a.billingJSON(sub), // null: drives are free on this server
		"verified":         sub.Verified,
		"createdAt":        p.CreatedAt,
	})
	return nil
}

func (a *App) handleChangePassword(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	var req struct {
		AuthKey          []byte    `json:"authKey"`
		Salt             []byte    `json:"salt"`
		KDF              KDFParams `json:"kdf"`
		NewAuthKey       []byte    `json:"newAuthKey"`
		WrappedMasterKey []byte    `json:"wrappedMasterKey"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	if !validKeyMaterial(req.Salt, req.KDF, req.NewAuthKey, req.WrappedMasterKey) {
		return errf(http.StatusBadRequest, "invalid key material")
	}
	hash, err := a.db.AuthHash(uid)
	if err != nil {
		return err
	}
	if !equal(a.authHash(req.AuthKey), hash) {
		return errf(http.StatusUnauthorized, "current password is incorrect")
	}
	if err := a.db.SetPassword(uid, req.Salt, req.KDF.json(), a.authHash(req.NewAuthKey), req.WrappedMasterKey); err != nil {
		return err
	}
	// Sign out every other device.
	if err := a.db.DeleteSessions(uid); err != nil {
		return err
	}
	if err := a.startSession(w, r, uid); err != nil {
		return err
	}
	return a.writeMe(w, uid)
}

func (a *App) checkRecovery(email string, key []byte) (string, []byte, error) {
	if a.loginFailLimit.Blocked("recover:" + email) {
		return "", nil, errf(http.StatusTooManyRequests, "too many failed attempts, try again in 15 minutes")
	}
	uid, hash, wrapped, err := a.db.Recovery(email)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return "", nil, err
	}
	if uid == "" || !equal(a.authHash(key), hash) {
		a.loginFailLimit.Allow("recover:" + email)
		return "", nil, errf(http.StatusUnauthorized, "email or recovery key is incorrect")
	}
	return uid, wrapped, nil
}

func (a *App) handleRecoverStart(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		Email           string `json:"email"`
		RecoveryAuthKey []byte `json:"recoveryAuthKey"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	_, wrapped, err := a.checkRecovery(normEmail(req.Email), req.RecoveryAuthKey)
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"recoveryWrappedMasterKey": wrapped})
	return nil
}

func (a *App) handleRecoverFinish(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		Email            string    `json:"email"`
		RecoveryAuthKey  []byte    `json:"recoveryAuthKey"`
		Salt             []byte    `json:"salt"`
		KDF              KDFParams `json:"kdf"`
		AuthKey          []byte    `json:"authKey"`
		WrappedMasterKey []byte    `json:"wrappedMasterKey"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	uid, _, err := a.checkRecovery(normEmail(req.Email), req.RecoveryAuthKey)
	if err != nil {
		return err
	}
	if !validKeyMaterial(req.Salt, req.KDF, req.AuthKey, req.WrappedMasterKey) {
		return errf(http.StatusBadRequest, "invalid key material")
	}
	if err := a.db.SetPassword(uid, req.Salt, req.KDF.json(), a.authHash(req.AuthKey), req.WrappedMasterKey); err != nil {
		return err
	}
	if err := a.db.DeleteSessions(uid); err != nil {
		return err
	}
	if err := a.startSession(w, r, uid); err != nil {
		return err
	}
	return a.writeMe(w, uid)
}

func (a *App) handleDeleteAccount(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	var req struct {
		AuthKey []byte `json:"authKey"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	hash, err := a.db.AuthHash(uid)
	if err != nil {
		return err
	}
	if !equal(a.authHash(req.AuthKey), hash) {
		return errf(http.StatusUnauthorized, "password is incorrect")
	}
	// Stop the billing first: a deleted account must never be charged again.
	if a.billing != nil {
		if err := a.cancelSub(r.Context(), uid); err != nil {
			log.Printf("billing: cancel for deleted account: %v", err)
			return errf(http.StatusBadGateway, "your plan could not be cancelled, so nothing was deleted; try again shortly")
		}
	}
	ids, err := a.db.UserItemIDs(uid)
	if err != nil {
		return err
	}
	if err := a.db.DeleteUser(uid); err != nil {
		return err
	}
	a.removeBlobs(ids)
	a.clearSession(w, r)
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

// ------------------------------------------------------------------- sessions

// sessionHash is the hash of the caller's own session token, or nil.
func sessionHash(r *http.Request) []byte {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		return nil
	}
	return sha([]byte(c.Value))
}

// handleSessions lists the browsers the account is signed in on.
func (a *App) handleSessions(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	sessions, err := a.db.Sessions(uid, sessionHash(r))
	if err != nil {
		return err
	}
	writeJSON(w, 200, sessions)
	return nil
}

// handleEndSession signs one browser out. Ending the caller's own session is
// what signing out is for, so it is refused here.
func (a *App) handleEndSession(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	sessions, err := a.db.Sessions(uid, sessionHash(r))
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	for _, se := range sessions {
		if se.ID == id && se.Current {
			return errf(http.StatusBadRequest, "use sign out to end this session")
		}
	}
	err = a.db.EndSession(uid, id)
	if errors.Is(err, store.ErrNotFound) {
		return errNotFound
	} else if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

// handleEndOtherSessions signs the account out everywhere except here.
func (a *App) handleEndOtherSessions(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	if err := a.db.EndOtherSessions(uid, sessionHash(r)); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

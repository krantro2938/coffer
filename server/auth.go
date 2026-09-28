package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
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
	var salt []byte
	var params string
	err := a.db.QueryRow(`SELECT kdf_salt, kdf_params FROM users WHERE email = ?`, email).Scan(&salt, &params)
	if errors.Is(err, sql.ErrNoRows) {
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
	_, err := a.db.Exec(`INSERT INTO users (id, email, kdf_salt, kdf_params, auth_hash, wrapped_mk,
		recovery_auth_hash, recovery_wrapped_mk, quota, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		uid, email, req.Salt, req.KDF.json(), a.authHash(req.AuthKey), req.WrappedMasterKey,
		a.authHash(req.RecoveryAuthKey), req.RecoveryWrappedMasterKey, a.cfg.UserQuota, now())
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return errf(http.StatusConflict, "an account with this email already exists")
		}
		return err
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
	if a.loginFailLimit.blocked(email) {
		return errf(http.StatusTooManyRequests, "too many failed attempts, try again in 15 minutes")
	}
	uid, err := a.verifyPassword(email, req.AuthKey)
	if err != nil {
		return err
	}
	if err := a.startSession(w, r, uid); err != nil {
		return err
	}
	return a.writeMe(w, uid)
}

var errBadLogin = errf(http.StatusUnauthorized, "incorrect email or password")

func (a *App) verifyPassword(email string, authKey []byte) (string, error) {
	var uid string
	var hash []byte
	err := a.db.QueryRow(`SELECT id, auth_hash FROM users WHERE email = ?`, email).Scan(&uid, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		a.loginFailLimit.allow(email)
		return "", errBadLogin
	} else if err != nil {
		return "", err
	}
	if !equal(a.authHash(authKey), hash) {
		a.loginFailLimit.allow(email)
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
	var email, params string
	var salt, wrapped []byte
	var quota, created int64
	err := a.db.QueryRow(`SELECT email, kdf_salt, kdf_params, wrapped_mk, quota, created_at FROM users WHERE id = ?`, uid).
		Scan(&email, &salt, &params, &wrapped, &quota, &created)
	if err != nil {
		return err
	}
	used, err := a.usage(uid)
	if err != nil {
		return err
	}
	var kdf KDFParams
	_ = json.Unmarshal([]byte(params), &kdf)
	writeJSON(w, 200, map[string]any{
		"email":            email,
		"salt":             salt,
		"kdf":              kdf,
		"wrappedMasterKey": wrapped,
		"quota":            quota,
		"used":             used,
		"createdAt":        created,
	})
	return nil
}

func (a *App) usage(uid string) (int64, error) {
	var used int64
	err := a.db.QueryRow(`SELECT COALESCE(SUM(size), 0) FROM items WHERE user_id = ?`, uid).Scan(&used)
	return used, err
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
	var hash []byte
	if err := a.db.QueryRow(`SELECT auth_hash FROM users WHERE id = ?`, uid).Scan(&hash); err != nil {
		return err
	}
	if !equal(a.authHash(req.AuthKey), hash) {
		return errf(http.StatusUnauthorized, "current password is incorrect")
	}
	if _, err := a.db.Exec(`UPDATE users SET kdf_salt = ?, kdf_params = ?, auth_hash = ?, wrapped_mk = ? WHERE id = ?`,
		req.Salt, req.KDF.json(), a.authHash(req.NewAuthKey), req.WrappedMasterKey, uid); err != nil {
		return err
	}
	// Sign out every other device.
	if _, err := a.db.Exec(`DELETE FROM sessions WHERE user_id = ?`, uid); err != nil {
		return err
	}
	if err := a.startSession(w, r, uid); err != nil {
		return err
	}
	return a.writeMe(w, uid)
}

func (a *App) checkRecovery(email string, key []byte) (string, []byte, error) {
	if a.loginFailLimit.blocked("recover:" + email) {
		return "", nil, errf(http.StatusTooManyRequests, "too many failed attempts, try again in 15 minutes")
	}
	var uid string
	var hash, wrapped []byte
	err := a.db.QueryRow(`SELECT id, recovery_auth_hash, recovery_wrapped_mk FROM users WHERE email = ?`, email).
		Scan(&uid, &hash, &wrapped)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", nil, err
	}
	if uid == "" || !equal(a.authHash(key), hash) {
		a.loginFailLimit.allow("recover:" + email)
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
	if _, err := a.db.Exec(`UPDATE users SET kdf_salt = ?, kdf_params = ?, auth_hash = ?, wrapped_mk = ? WHERE id = ?`,
		req.Salt, req.KDF.json(), a.authHash(req.AuthKey), req.WrappedMasterKey, uid); err != nil {
		return err
	}
	if _, err := a.db.Exec(`DELETE FROM sessions WHERE user_id = ?`, uid); err != nil {
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
	var hash []byte
	if err := a.db.QueryRow(`SELECT auth_hash FROM users WHERE id = ?`, uid).Scan(&hash); err != nil {
		return err
	}
	if !equal(a.authHash(req.AuthKey), hash) {
		return errf(http.StatusUnauthorized, "password is incorrect")
	}
	ids, err := a.itemIDs(`SELECT id FROM items WHERE user_id = ?`, uid)
	if err != nil {
		return err
	}
	if _, err := a.db.Exec(`DELETE FROM users WHERE id = ?`, uid); err != nil {
		return err
	}
	a.removeBlobs(ids)
	a.clearSession(w, r)
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

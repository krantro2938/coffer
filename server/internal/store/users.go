package store

import (
	"database/sql"
	"strings"
)

// NewUser is an account as the browser set it up: the server is given a salt,
// hashes of derived keys and the master key wrapped under them, never the
// password or the key itself.
type NewUser struct {
	ID                string
	Email             string
	KDFSalt           []byte
	KDFParams         string // JSON
	AuthHash          []byte
	WrappedMK         []byte
	RecoveryAuthHash  []byte
	RecoveryWrappedMK []byte
	Quota             int64
	Verified          bool
	GoogleSub         *string
	Lang              string
}

// CreateUser adds an account, or returns ErrExists if the address is taken.
func (s *Store) CreateUser(u NewUser) error {
	_, err := s.db.Exec(`INSERT INTO users (id, email, kdf_salt, kdf_params, auth_hash, wrapped_mk,
		recovery_auth_hash, recovery_wrapped_mk, quota, created_at, email_verified, google_sub, lang)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		u.ID, u.Email, u.KDFSalt, u.KDFParams, u.AuthHash, u.WrappedMK,
		u.RecoveryAuthHash, u.RecoveryWrappedMK, u.Quota, now(), u.Verified, u.GoogleSub, u.Lang)
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return ErrExists
	}
	return err
}

// DeleteUser removes an account. Its sessions, folders, items and share links
// cascade; the caller removes the stored ciphertext.
func (s *Store) DeleteUser(id string) error {
	return s.exec(`DELETE FROM users WHERE id = ?`, id)
}

// DeleteUnverified removes the account if it never proved its address.
func (s *Store) DeleteUnverified(id string) error {
	return s.exec(`DELETE FROM users WHERE id = ? AND email_verified = 0`, id)
}

// DeleteUnverifiedByEmail removes a sign-up that never proved this address.
func (s *Store) DeleteUnverifiedByEmail(email string) error {
	return s.exec(`DELETE FROM users WHERE email = ? AND email_verified = 0`, email)
}

// DeleteStaleSignups removes accounts created before cutoff that never proved
// their address.
func (s *Store) DeleteStaleSignups(cutoff int64) error {
	return s.exec(`DELETE FROM users WHERE email_verified = 0 AND created_at <= ?`, cutoff)
}

// VerifiedUserExists reports whether a confirmed account has this address.
func (s *Store) VerifiedUserExists(email string) (bool, error) {
	n, err := s.count(`SELECT COUNT(*) FROM users WHERE email = ? AND email_verified = 1`, email)
	return n > 0, err
}

// KDF returns the salt and Argon2id parameters an account's password is
// stretched with.
func (s *Store) KDF(email string) (salt []byte, params string, err error) {
	err = s.db.QueryRow(`SELECT kdf_salt, kdf_params FROM users WHERE email = ?`, email).Scan(&salt, &params)
	return salt, params, notFound(err)
}

// Credentials returns the id and password hash of the account with this address.
func (s *Store) Credentials(email string) (id string, authHash []byte, err error) {
	err = s.db.QueryRow(`SELECT id, auth_hash FROM users WHERE email = ?`, email).Scan(&id, &authHash)
	return id, authHash, notFound(err)
}

// AuthHash returns an account's password hash.
func (s *Store) AuthHash(id string) (hash []byte, err error) {
	err = s.db.QueryRow(`SELECT auth_hash FROM users WHERE id = ?`, id).Scan(&hash)
	return hash, err
}

// Recovery returns what is needed to check a recovery key and hand back the
// master key wrapped under it.
func (s *Store) Recovery(email string) (id string, authHash, wrappedMK []byte, err error) {
	err = s.db.QueryRow(`SELECT id, recovery_auth_hash, recovery_wrapped_mk FROM users WHERE email = ?`, email).
		Scan(&id, &authHash, &wrappedMK)
	return id, authHash, wrappedMK, notFound(err)
}

// SetPassword replaces an account's password material.
func (s *Store) SetPassword(id string, salt []byte, kdfParams string, authHash, wrappedMK []byte) error {
	return s.exec(`UPDATE users SET kdf_salt = ?, kdf_params = ?, auth_hash = ?, wrapped_mk = ? WHERE id = ?`,
		salt, kdfParams, authHash, wrappedMK, id)
}

// Profile is what a signed-in browser needs to unlock its drive.
type Profile struct {
	Email     string
	KDFSalt   []byte
	KDFParams string // JSON
	WrappedMK []byte
	CreatedAt int64
}

// Profile returns the account's own view of itself.
func (s *Store) Profile(id string) (*Profile, error) {
	var p Profile
	err := s.db.QueryRow(`SELECT email, kdf_salt, kdf_params, wrapped_mk, created_at FROM users WHERE id = ?`, id).
		Scan(&p.Email, &p.KDFSalt, &p.KDFParams, &p.WrappedMK, &p.CreatedAt)
	return &p, err
}

// Email returns an account's address.
func (s *Store) Email(id string) (email string, err error) {
	err = s.db.QueryRow(`SELECT email FROM users WHERE id = ?`, id).Scan(&email)
	return email, err
}

// Suspended reports whether an admin has suspended the account.
func (s *Store) Suspended(id string) (suspended bool, err error) {
	err = s.db.QueryRow(`SELECT suspended_at IS NOT NULL FROM users WHERE id = ?`, id).Scan(&suspended)
	return suspended, err
}

// Usage is how many bytes of ciphertext an account is storing.
func (s *Store) Usage(id string) (int64, error) {
	return s.count(`SELECT COALESCE(SUM(size), 0) FROM items WHERE user_id = ?`, id)
}

// ------------------------------------------------------------------- sessions

// CreateSession signs a browser in until expiresAt. id is what the account is
// shown to tell its sessions apart; userAgent is the browser's description of itself.
func (s *Store) CreateSession(tokenHash []byte, userID string, expiresAt int64, id, userAgent string) error {
	return s.exec(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at, id, user_agent, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		tokenHash, userID, now(), expiresAt, id, userAgent, now())
}

// lastSeenStep is how stale a session's last-seen time may get before it is
// written again, so that reading a session rarely costs a write.
const lastSeenStep = 5 * 60

// SessionUser returns the account a live session belongs to, or ErrNotFound,
// and notes that the session was used.
func (s *Store) SessionUser(tokenHash []byte) (userID string, err error) {
	var seen sql.NullInt64
	err = s.db.QueryRow(`SELECT user_id, last_seen FROM sessions WHERE token_hash = ? AND expires_at > ?`, tokenHash, now()).Scan(&userID, &seen)
	if err != nil {
		return "", notFound(err)
	}
	if now()-seen.Int64 > lastSeenStep {
		_ = s.exec(`UPDATE sessions SET last_seen = ? WHERE token_hash = ?`, now(), tokenHash)
	}
	return userID, nil
}

// Session is one browser an account is signed in on.
type Session struct {
	ID        string `json:"id"`
	UserAgent string `json:"userAgent"`
	CreatedAt int64  `json:"createdAt"`
	LastSeen  int64  `json:"lastSeen"`
	Current   bool   `json:"current"` // the one asking
}

// Sessions lists where an account is signed in, most recently used first.
// current is the token hash of the session asking.
func (s *Store) Sessions(userID string, current []byte) ([]Session, error) {
	rows, err := s.db.Query(`SELECT id, COALESCE(user_agent, ''), created_at, COALESCE(last_seen, created_at), token_hash = ?
		FROM sessions WHERE user_id = ? AND expires_at > ? AND id IS NOT NULL ORDER BY 5 DESC, 4 DESC`, current, userID, now())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Session{}
	for rows.Next() {
		var se Session
		if err := rows.Scan(&se.ID, &se.UserAgent, &se.CreatedAt, &se.LastSeen, &se.Current); err != nil {
			return nil, err
		}
		out = append(out, se)
	}
	return out, rows.Err()
}

// EndSession signs one of an account's browsers out by its id, or returns ErrNotFound.
func (s *Store) EndSession(userID, id string) error {
	res, err := s.db.Exec(`DELETE FROM sessions WHERE user_id = ? AND id = ?`, userID, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// EndOtherSessions signs an account out everywhere but on the session asking.
func (s *Store) EndOtherSessions(userID string, current []byte) error {
	return s.exec(`DELETE FROM sessions WHERE user_id = ? AND token_hash != ?`, userID, current)
}

// DeleteSession signs one browser out.
func (s *Store) DeleteSession(tokenHash []byte) error {
	return s.exec(`DELETE FROM sessions WHERE token_hash = ?`, tokenHash)
}

// DeleteSessions signs an account out everywhere.
func (s *Store) DeleteSessions(userID string) error {
	return s.exec(`DELETE FROM sessions WHERE user_id = ?`, userID)
}

// DeleteExpiredSessions clears out sessions that have run their course.
func (s *Store) DeleteExpiredSessions() error {
	return s.exec(`DELETE FROM sessions WHERE expires_at <= ?`, now())
}

// --------------------------------------------------------- email verification

// SetCode stores the hash of a freshly emailed code, replacing any earlier one.
func (s *Store) SetCode(userID string, hash []byte, expiresAt int64) error {
	return s.exec(`UPDATE users SET otp_hash = ?, otp_expires = ?, otp_tries = 0, otp_sent = ? WHERE id = ?`,
		hash, expiresAt, now(), userID)
}

// Code is the state of an account's emailed code.
type Code struct {
	Hash     []byte // nil when none was issued
	Expires  sql.NullInt64
	Tries    int
	Verified bool
}

// Code returns the emailed code an account is expected to enter.
func (s *Store) Code(userID string) (*Code, error) {
	var c Code
	err := s.db.QueryRow(`SELECT otp_hash, otp_expires, otp_tries, email_verified FROM users WHERE id = ?`, userID).
		Scan(&c.Hash, &c.Expires, &c.Tries, &c.Verified)
	return &c, err
}

// CountCodeTry records a wrong guess at the code.
func (s *Store) CountCodeTry(userID string) error {
	return s.exec(`UPDATE users SET otp_tries = otp_tries + 1 WHERE id = ?`, userID)
}

// MarkVerified records that the account's address is proven.
func (s *Store) MarkVerified(userID string) error {
	return s.exec(`UPDATE users SET email_verified = 1, otp_hash = NULL, otp_expires = NULL WHERE id = ?`, userID)
}

// CodeRecipient is who a new code would go to, and when the last one went out.
type CodeRecipient struct {
	Email    string
	Lang     sql.NullString
	SentAt   sql.NullInt64
	Verified bool
}

// CodeRecipient returns what is needed to decide on sending another code.
func (s *Store) CodeRecipient(userID string) (*CodeRecipient, error) {
	var c CodeRecipient
	err := s.db.QueryRow(`SELECT email, lang, otp_sent, email_verified FROM users WHERE id = ?`, userID).
		Scan(&c.Email, &c.Lang, &c.SentAt, &c.Verified)
	return &c, err
}

// --------------------------------------------------------------------- Google

// GoogleAccount is the account a Google identity signs in to.
type GoogleAccount struct {
	ID       string
	Sub      sql.NullString // the Google identity already tied to it, if any
	Verified bool
}

// GoogleAccount finds the account tied to a Google identity or, failing that,
// the one with the same address. It returns ErrNotFound when there is neither.
func (s *Store) GoogleAccount(sub, email string) (*GoogleAccount, error) {
	var a GoogleAccount
	err := s.db.QueryRow(`SELECT id, google_sub, email_verified FROM users WHERE google_sub = ? OR email = ?
		ORDER BY google_sub = ? DESC LIMIT 1`, sub, email, sub).Scan(&a.ID, &a.Sub, &a.Verified)
	return &a, notFound(err)
}

// SetGoogleSub ties an account to a Google identity.
func (s *Store) SetGoogleSub(id, sub string) error {
	return s.exec(`UPDATE users SET google_sub = ? WHERE id = ?`, sub, id)
}

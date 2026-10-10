package store

import "database/sql"

// Terms are what an admin can grant an account or promise in an invitation,
// in the shape the columns hold them.
type Terms struct {
	CompQuota *int64  // complimentary storage, in bytes
	CompUntil *int64  // when it ends; nil for no end date
	Offer     *string // JSON: a personal price
}

// Invite is an admin's invitation to open an account on agreed terms. It is
// identified by the hash of the token in its link.
type Invite struct {
	ID        string // the token hash, in upper-case hex
	Email     string
	CompQuota sql.NullInt64
	CompUntil sql.NullInt64
	Offer     sql.NullString // JSON
	Note      sql.NullString
	CreatedAt int64
	UsedAt    sql.NullInt64
}

// CreateInvite records an invitation. An address has one live invitation at a
// time: a new one replaces the old.
func (s *Store) CreateInvite(tokenHash []byte, email string, t Terms, note string) error {
	if err := s.exec(`DELETE FROM invites WHERE email = ? AND used_at IS NULL`, email); err != nil {
		return err
	}
	return s.exec(`INSERT INTO invites (token_hash, email, comp_quota, comp_until, offer, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		tokenHash, email, t.CompQuota, t.CompUntil, t.Offer, note, now())
}

// LiveInvite returns an unused invitation made after createdAfter, or ErrNotFound.
func (s *Store) LiveInvite(tokenHash []byte, createdAfter int64) (*Invite, error) {
	var inv Invite
	err := s.db.QueryRow(`SELECT email, comp_quota, comp_until, offer FROM invites WHERE token_hash = ? AND used_at IS NULL AND created_at > ?`,
		tokenHash, createdAfter).Scan(&inv.Email, &inv.CompQuota, &inv.CompUntil, &inv.Offer)
	return &inv, notFound(err)
}

// AcceptInvite gives a new account the invitation's terms and marks the
// invitation used.
func (s *Store) AcceptInvite(tokenHash []byte, userID string, inv *Invite) error {
	if err := s.exec(`UPDATE users SET comp_quota = ?, comp_until = ?, offer = ? WHERE id = ?`,
		inv.CompQuota, inv.CompUntil, inv.Offer, userID); err != nil {
		return err
	}
	return s.exec(`UPDATE invites SET used_at = ? WHERE token_hash = ?`, now(), tokenHash)
}

// Invites lists the latest 200 invitations, newest first.
func (s *Store) Invites() ([]Invite, error) {
	rows, err := s.db.Query(`SELECT hex(token_hash), email, comp_quota, comp_until, offer, note, created_at, used_at FROM invites
		ORDER BY created_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Invite
	for rows.Next() {
		var inv Invite
		if err := rows.Scan(&inv.ID, &inv.Email, &inv.CompQuota, &inv.CompUntil, &inv.Offer, &inv.Note, &inv.CreatedAt, &inv.UsedAt); err != nil {
			return nil, err
		}
		out = append(out, inv)
	}
	return out, rows.Err()
}

// RevokeInvite deletes an unused invitation by its id, or returns ErrNotFound.
func (s *Store) RevokeInvite(id string) error {
	res, err := s.db.Exec(`DELETE FROM invites WHERE hex(token_hash) = ? AND used_at IS NULL`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteExpiredInvites removes unused invitations made at or before createdBefore.
func (s *Store) DeleteExpiredInvites(createdBefore int64) error {
	return s.exec(`DELETE FROM invites WHERE used_at IS NULL AND created_at <= ?`, createdBefore)
}

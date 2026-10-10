package store

// TrialRequest is someone who asked to try a drive before paying.
type TrialRequest struct {
	Email     string `json:"email"`
	Lang      string `json:"lang"`
	CreatedAt int64  `json:"createdAt"`
	InvitedAt *int64 `json:"invitedAt"`
}

// AddTrialRequest notes that an address asked for a trial, and reports whether
// it is new. Asking twice changes nothing.
func (s *Store) AddTrialRequest(email, lang string) (bool, error) {
	res, err := s.db.Exec(`INSERT OR IGNORE INTO trial_requests (email, lang, created_at) VALUES (?, ?, ?)`, email, lang, now())
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// TrialRequests lists the latest 500 requests, those still waiting first.
func (s *Store) TrialRequests() ([]TrialRequest, error) {
	rows, err := s.db.Query(`SELECT email, COALESCE(lang, ''), created_at, invited_at FROM trial_requests
		ORDER BY invited_at IS NOT NULL, created_at DESC LIMIT 500`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TrialRequest{}
	for rows.Next() {
		var t TrialRequest
		if err := rows.Scan(&t.Email, &t.Lang, &t.CreatedAt, &t.InvitedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// MarkTrialInvited records that a request, if there was one, has been answered.
func (s *Store) MarkTrialInvited(email string) error {
	return s.exec(`UPDATE trial_requests SET invited_at = COALESCE(invited_at, ?) WHERE email = ?`, now(), email)
}

// PendingTrialRequests counts the requests nobody has answered yet.
func (s *Store) PendingTrialRequests() (int64, error) {
	return s.count(`SELECT COUNT(*) FROM trial_requests WHERE invited_at IS NULL`)
}

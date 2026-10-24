package store

// Waiter is someone who asked to hear when the paid plans open.
type Waiter struct {
	Email     string `json:"email"`
	Lang      string `json:"lang"`
	CreatedAt int64  `json:"createdAt"`
}

// AddToWaitlist notes an address that wants to hear when the paid plans open,
// and reports whether it is new. Asking twice changes nothing.
func (s *Store) AddToWaitlist(email, lang string) (bool, error) {
	res, err := s.db.Exec(`INSERT OR IGNORE INTO waitlist (email, lang, created_at) VALUES (?, ?, ?)`, email, lang, now())
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// Waitlist lists everyone waiting for the paid plans, newest first.
func (s *Store) Waitlist() ([]Waiter, error) {
	rows, err := s.db.Query(`SELECT email, COALESCE(lang, ''), created_at FROM waitlist ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Waiter{}
	for rows.Next() {
		var w Waiter
		if err := rows.Scan(&w.Email, &w.Lang, &w.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

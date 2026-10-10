package store

import "database/sql"

// Standing is where an account stands: its plan, what an admin has granted or
// taken away, and whether its address is proven.
type Standing struct {
	Plan, Status, SubID, CustomerID, PendingTxn sql.NullString
	PeriodEnd, CancelAt, LapsedAt               sql.NullInt64
	Quota                                       int64
	Verified                                    bool // email address proven
	Suspended                                   bool // access revoked by an admin
	CompQuota, CompUntil                        sql.NullInt64
	OfferJSON                                   sql.NullString // a personal price set by an admin
}

// Standing returns an account's standing.
func (s *Store) Standing(userID string) (*Standing, error) {
	var st Standing
	err := s.db.QueryRow(`SELECT plan, sub_status, sub_id, customer_id, pending_txn, period_end, cancel_at, lapsed_at, quota, email_verified,
		suspended_at IS NOT NULL, comp_quota, comp_until, offer FROM users WHERE id = ?`, userID).
		Scan(&st.Plan, &st.Status, &st.SubID, &st.CustomerID, &st.PendingTxn, &st.PeriodEnd, &st.CancelAt, &st.LapsedAt, &st.Quota, &st.Verified,
			&st.Suspended, &st.CompQuota, &st.CompUntil, &st.OfferJSON)
	return &st, err
}

// entitledSQL lists the subscription statuses that let a drive be written to.
// past_due stays writable while Paddle retries the payment.
const entitledSQL = `('active', 'trialing', 'past_due')`

// coveredSQL is the condition, on a users row aliased u, for a drive that can
// be added to: a plan in good standing or a complimentary allowance, and no
// suspension.
const coveredSQL = `u.suspended_at IS NULL AND (u.sub_status IN ` + entitledSQL + `
	OR (u.comp_quota IS NOT NULL AND (u.comp_until IS NULL OR u.comp_until > CAST(strftime('%s', 'now') AS INTEGER))))`

// SetPendingTxn remembers the checkout an account has open.
func (s *Store) SetPendingTxn(userID, txnID string) error {
	return s.exec(`UPDATE users SET pending_txn = ? WHERE id = ?`, txnID, userID)
}

// ClearPendingTxn forgets a checkout that came to nothing.
func (s *Store) ClearPendingTxn(userID string) error {
	return s.exec(`UPDATE users SET pending_txn = NULL WHERE id = ?`, userID)
}

// SetCustomer records the Paddle customer an account pays as.
func (s *Store) SetCustomer(userID, customerID string) error {
	return s.exec(`UPDATE users SET customer_id = ? WHERE id = ?`, customerID, userID)
}

// Subscription is a snapshot of a Paddle subscription to record on an account.
type Subscription struct {
	ID         string
	CustomerID string
	Plan       string
	Status     string
	Quota      int64
	PeriodEnd  *int64
	CancelAt   *int64
	Entitled   bool  // whether Status lets the drive be written to
	UpdatedAt  int64 // Paddle's clock, in microseconds
}

// ApplySubscription records a subscription's state on an account. A snapshot
// older than the one already stored is ignored, so late or replayed webhooks
// are harmless. It clears the pending checkout, and starts the grace period
// before a lapsed drive is emptied when the plan stops covering it.
func (s *Store) ApplySubscription(userID string, sub Subscription) error {
	return s.exec(`UPDATE users SET plan = ?, sub_status = ?, sub_id = ?, customer_id = ?, period_end = ?, cancel_at = ?,
		quota = ?, sub_updated = ?, pending_txn = NULL,
		lapsed_at = CASE WHEN ? OR (comp_quota IS NOT NULL AND (comp_until IS NULL OR comp_until > ?)) THEN NULL ELSE COALESCE(lapsed_at, ?) END,
		lapse_notice = CASE WHEN ? THEN 0 ELSE lapse_notice END
		WHERE id = ? AND sub_updated <= ?`,
		sub.Plan, sub.Status, sub.ID, sub.CustomerID, sub.PeriodEnd, sub.CancelAt, sub.Quota,
		sub.UpdatedAt, sub.Entitled, now(), now(), sub.Entitled, userID, sub.UpdatedAt)
}

// SubscriptionAccount finds the account a subscription event is about: the one
// already on that subscription or, failing that, the one named by userID. It
// also returns the subscription the account is on now ("" for none).
func (s *Store) SubscriptionAccount(userID, subID string) (id, current string, err error) {
	var cur sql.NullString
	err = s.db.QueryRow(`SELECT id, sub_id FROM users WHERE id = ? OR sub_id = ? ORDER BY sub_id = ? DESC LIMIT 1`, userID, subID, subID).
		Scan(&id, &cur)
	return id, cur.String, notFound(err)
}

// ResetSubscriptionClock lets the next snapshot through whatever its age, for
// when an account moves to a different subscription.
func (s *Store) ResetSubscriptionClock(userID string) error {
	return s.exec(`UPDATE users SET sub_updated = 0 WHERE id = ?`, userID)
}

// DueSubscriptions lists accounts whose paid period has run out or that are
// waiting on a checkout, 200 at a time.
func (s *Store) DueSubscriptions() ([]string, error) {
	return s.ids(`SELECT id FROM users WHERE (sub_id IS NOT NULL AND sub_status != 'canceled' AND period_end <= ?)
		OR pending_txn IS NOT NULL LIMIT 200`, now())
}

// LapseExpiredAllowances starts the grace period for accounts whose
// complimentary allowance has run out with no plan behind it.
func (s *Store) LapseExpiredAllowances() error {
	return s.exec(`UPDATE users SET lapsed_at = ? WHERE lapsed_at IS NULL AND comp_quota IS NOT NULL AND comp_until <= ?
		AND (sub_status IS NULL OR sub_status NOT IN `+entitledSQL+`)`, now(), now())
}

// Lapsed is an account whose drive is no longer covered.
type Lapsed struct {
	ID, Email, Lang string
	At              int64
	Notice          int // 0: not told yet, 1: told it lapsed, 2: final warning sent
}

// Lapsed lists the accounts in their grace period.
func (s *Store) Lapsed() ([]Lapsed, error) {
	rows, err := s.db.Query(`SELECT id, email, COALESCE(lang, ''), lapsed_at, lapse_notice FROM users WHERE lapsed_at IS NOT NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Lapsed
	for rows.Next() {
		var l Lapsed
		if err := rows.Scan(&l.ID, &l.Email, &l.Lang, &l.At, &l.Notice); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// SetLapseNotice records which warning an account has been sent.
func (s *Store) SetLapseNotice(userID string, level int) error {
	return s.exec(`UPDATE users SET lapse_notice = ? WHERE id = ?`, level, userID)
}

// SetLapsedAt moves the start of an account's grace period.
func (s *Store) SetLapsedAt(userID string, at int64) error {
	return s.exec(`UPDATE users SET lapsed_at = ? WHERE id = ?`, at, userID)
}

// EmptyDrive deletes everything an account stored and clears its plan. The
// account itself stays. The caller removes the stored ciphertext.
func (s *Store) EmptyDrive(userID string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, q := range []string{
		`DELETE FROM items WHERE user_id = ?`, // their share links cascade
		`DELETE FROM folders WHERE user_id = ?`,
		`UPDATE users SET plan = NULL, sub_status = NULL, sub_id = NULL, period_end = NULL, cancel_at = NULL,
			lapsed_at = NULL, lapse_notice = 0, quota = 0, comp_quota = NULL, comp_until = NULL WHERE id = ?`,
	} {
		if _, err := tx.Exec(q, userID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

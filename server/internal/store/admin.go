package store

import (
	"database/sql"
	"encoding/json"
	"log"
	"strings"
	"time"
)

// Queries behind the admin console. An admin sees accounts, sizes and
// reports, never names, keys or contents: those are not here to be seen.

// Overview is the admin console's front page, in numbers.
type Overview struct {
	Counts map[string]int64
	ByPlan map[string]int64 // accounts with a running subscription, by plan
}

// Overview counts what is on the server.
func (s *Store) Overview() (*Overview, error) {
	o := Overview{Counts: map[string]int64{}, ByPlan: map[string]int64{}}
	for _, c := range []struct {
		key, q string
		args   []any
	}{
		{"users", `SELECT COUNT(*) FROM users`, nil},
		{"unverified", `SELECT COUNT(*) FROM users WHERE email_verified = 0`, nil},
		{"paying", `SELECT COUNT(*) FROM users WHERE sub_status IN ` + entitledSQL, nil},
		{"pastDue", `SELECT COUNT(*) FROM users WHERE sub_status = 'past_due'`, nil},
		{"comped", `SELECT COUNT(*) FROM users WHERE comp_quota IS NOT NULL AND (comp_until IS NULL OR comp_until > ?)`, []any{now()}},
		{"lapsed", `SELECT COUNT(*) FROM users WHERE lapsed_at IS NOT NULL`, nil},
		{"suspended", `SELECT COUNT(*) FROM users WHERE suspended_at IS NOT NULL`, nil},
		{"newThisWeek", `SELECT COUNT(*) FROM users WHERE created_at > ?`, []any{now() - 7*86400}},
		{"storedBytes", `SELECT COALESCE(SUM(size), 0) FROM items WHERE user_id IS NOT NULL`, nil},
		{"quickShareBytes", `SELECT COALESCE(SUM(size), 0) FROM items WHERE user_id IS NULL`, nil},
		{"driveFiles", `SELECT COUNT(*) FROM items WHERE user_id IS NOT NULL AND kind != 'bundle'`, nil},
		{"liveLinks", `SELECT COUNT(*) FROM shares WHERE ` + activeShare, []any{now()}},
		{"openReports", `SELECT COUNT(*) FROM reports WHERE status = 'open'`, nil},
		{"pendingInvites", `SELECT COUNT(*) FROM invites WHERE used_at IS NULL`, nil},
		{"trialRequests", `SELECT COUNT(*) FROM trial_requests WHERE invited_at IS NULL`, nil},
		{"waitlist", `SELECT COUNT(*) FROM waitlist`, nil},
	} {
		n, err := s.count(c.q, c.args...)
		if err != nil {
			return nil, err
		}
		o.Counts[c.key] = n
	}
	rows, err := s.db.Query(`SELECT plan, COUNT(*) FROM users WHERE sub_status IN ` + entitledSQL + ` GROUP BY plan`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var plan string
		var n int64
		if err := rows.Scan(&plan, &n); err != nil {
			return nil, err
		}
		o.ByPlan[plan] = n
	}
	return &o, rows.Err()
}

// Day is one UTC day of product activity, counted from rows that still exist.
type Day struct {
	Day             string `json:"day"` // 2026-10-11
	Signups         int64  `json:"signups"`
	SignupsWithLink int64  `json:"signupsWithLink"` // of those, made a request link within 24 hours
	SharesCreated   int64  `json:"sharesCreated"`
	RequestsCreated int64  `json:"requestsCreated"`
	FilesReceived   int64  `json:"filesReceived"`
	SharesOpened    int64  `json:"sharesOpened"`
}

// bump adds one to today's total for a kind of event. See migration 00006.
func bump(tx *sql.Tx, metric string) error {
	_, err := tx.Exec(`INSERT INTO daily_counts (day, metric, n) VALUES (date('now'), ?, 1)
		ON CONFLICT (day, metric) DO UPDATE SET n = n + 1`, metric)
	return err
}

// Daily counts the last `days` UTC days, oldest first, zeros included.
//
// Everything is derived from existing rows, so it only sees what survives:
// links are deleted when they expire, burn or are revoked, accounts and files
// when their owner deletes them, and an unconfirmed sign-up after a day. The
// older the day, the more it undercounts. How often a share link was opened
// is counted separately, in daily_counts, from the day that table appeared.
// Aggregates only; nothing per visitor.
func (s *Store) Daily(days int) ([]Day, error) {
	today := now() / 86400 * 86400
	since := today - int64(days-1)*86400
	out := make([]Day, days)
	index := map[string]int{}
	for i := range out {
		d := time.Unix(since+int64(i)*86400, 0).UTC().Format("2006-01-02")
		out[i].Day = d
		index[d] = i
	}
	for _, c := range []struct {
		q   string
		set func(*Day, int64)
	}{
		{`SELECT date(created_at, 'unixepoch'), COUNT(*) FROM users WHERE created_at >= ? GROUP BY 1`,
			func(d *Day, n int64) { d.Signups = n }},
		{`SELECT date(u.created_at, 'unixepoch'), COUNT(*) FROM users u WHERE u.created_at >= ? AND EXISTS (
			SELECT 1 FROM requests r WHERE r.user_id = u.id AND r.share_id IS NULL AND r.created_at <= u.created_at + 86400) GROUP BY 1`,
			func(d *Day, n int64) { d.SignupsWithLink = n }},
		{`SELECT date(created_at, 'unixepoch'), COUNT(*) FROM shares WHERE created_at >= ? GROUP BY 1`,
			func(d *Day, n int64) { d.SharesCreated = max(d.SharesCreated, n) }},
		// Exact, but only from when it was first recorded; the rows above cover the days before.
		{`SELECT day, n FROM daily_counts WHERE metric = 'share_created' AND day >= date(?, 'unixepoch')`,
			func(d *Day, n int64) { d.SharesCreated = max(d.SharesCreated, n) }},
		{`SELECT day, n FROM daily_counts WHERE metric = 'share_opened' AND day >= date(?, 'unixepoch')`,
			func(d *Day, n int64) { d.SharesOpened = n }},
		{`SELECT date(created_at, 'unixepoch'), COUNT(*) FROM requests WHERE share_id IS NULL AND created_at >= ? GROUP BY 1`,
			func(d *Day, n int64) { d.RequestsCreated = n }},
		{`SELECT date(i.created_at, 'unixepoch'), COUNT(*) FROM items i JOIN requests r ON r.id = i.request_id
			WHERE r.share_id IS NULL AND i.ready = 1 AND i.created_at >= ? GROUP BY 1`,
			func(d *Day, n int64) { d.FilesReceived = n }},
	} {
		if err := s.eachDay(c.q, since, func(day string, n int64) {
			if i, ok := index[day]; ok {
				c.set(&out[i], n)
			}
		}); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *Store) eachDay(query string, since int64, f func(day string, n int64)) error {
	rows, err := s.db.Query(query, since)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var day string
		var n int64
		if err := rows.Scan(&day, &n); err != nil {
			return err
		}
		f(day, n)
	}
	return rows.Err()
}

// Account is an account as the admin console shows it.
type Account struct {
	ID            string
	Email         string
	CreatedAt     int64
	Verified      bool
	Google        bool // tied to a Google identity
	Plan          *string
	Status        *string
	PeriodEnd     *int64
	CancelAt      *int64
	LapsedAt      *int64
	CompQuota     *int64
	CompUntil     *int64
	Offer         *string // JSON
	SuspendedAt   *int64
	SuspendReason *string
	Note          *string
	Quota         int64 // as stored; what they may use depends on their standing
	CustomerID    *string
	SubID         *string
	Used          int64 // bytes of ciphertext
	Files         int64
	Links         int64
	LastSeen      *int64 // their latest sign-in still on record
}

const accountSQL = `SELECT u.id, u.email, u.created_at, u.email_verified, u.google_sub IS NOT NULL, u.plan, u.sub_status, u.period_end,
	u.cancel_at, u.lapsed_at, u.comp_quota, u.comp_until, u.offer, u.suspended_at, u.suspend_reason, u.note, u.quota,
	u.customer_id, u.sub_id,
	(SELECT COALESCE(SUM(size), 0) FROM items i WHERE i.user_id = u.id),
	(SELECT COUNT(*) FROM items i WHERE i.user_id = u.id AND i.kind != 'bundle'),
	(SELECT COUNT(*) FROM shares s WHERE s.user_id = u.id),
	(SELECT MAX(created_at) FROM sessions s WHERE s.user_id = u.id)
	FROM users u`

func scanAccount(row interface{ Scan(...any) error }) (*Account, error) {
	var a Account
	err := row.Scan(&a.ID, &a.Email, &a.CreatedAt, &a.Verified, &a.Google, &a.Plan, &a.Status, &a.PeriodEnd, &a.CancelAt, &a.LapsedAt,
		&a.CompQuota, &a.CompUntil, &a.Offer, &a.SuspendedAt, &a.SuspendReason, &a.Note, &a.Quota, &a.CustomerID, &a.SubID,
		&a.Used, &a.Files, &a.Links, &a.LastSeen)
	return &a, err
}

// Account returns one account, or ErrNotFound.
func (s *Store) Account(id string) (*Account, error) {
	a, err := scanAccount(s.db.QueryRow(accountSQL+` WHERE u.id = ?`, id))
	return a, notFound(err)
}

// AccountFilter narrows the account list.
type AccountFilter struct {
	Email string // part of an address
	// Only is "paying", "comped", "lapsed", "suspended" or "unverified";
	// anything else lists every account.
	Only string
}

// Accounts lists the latest 200 accounts that match, newest first.
func (s *Store) Accounts(f AccountFilter) ([]*Account, error) {
	where, args := []string{"1 = 1"}, []any{}
	if f.Email != "" {
		where = append(where, `u.email LIKE ? ESCAPE '\'`)
		args = append(args, "%"+strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(f.Email)+"%")
	}
	switch f.Only {
	case "paying":
		where = append(where, `u.sub_status IN `+entitledSQL)
	case "comped":
		where = append(where, `u.comp_quota IS NOT NULL`)
	case "lapsed":
		where = append(where, `u.lapsed_at IS NOT NULL`)
	case "suspended":
		where = append(where, `u.suspended_at IS NOT NULL`)
	case "unverified":
		where = append(where, `u.email_verified = 0`)
	}
	rows, err := s.db.Query(accountSQL+` WHERE `+strings.Join(where, " AND ")+` ORDER BY u.created_at DESC LIMIT 200`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Account{}
	for rows.Next() {
		a, err := scanAccount(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// SetTerms replaces an account's complimentary allowance and personal price.
// Fresh cover ends any grace period that was running.
func (s *Store) SetTerms(userID string, t Terms) error {
	return s.exec(`UPDATE users SET comp_quota = ?, comp_until = ?, offer = ?,
		lapsed_at = CASE WHEN ? IS NOT NULL THEN NULL ELSE lapsed_at END,
		lapse_notice = CASE WHEN ? IS NOT NULL THEN 0 ELSE lapse_notice END WHERE id = ?`,
		t.CompQuota, t.CompUntil, t.Offer, t.CompQuota, t.CompQuota, userID)
}

// Suspend revokes an account's access and signs it out everywhere. Its links
// stop opening at once. With keepReason, an account that is already suspended
// keeps the reason it was given first.
func (s *Store) Suspend(userID, reason string, keepReason bool) error {
	q := `UPDATE users SET suspended_at = ?, suspend_reason = ? WHERE id = ?`
	if keepReason {
		q += ` AND suspended_at IS NULL`
	}
	if err := s.exec(q, now(), reason, userID); err != nil {
		return err
	}
	return s.DeleteSessions(userID)
}

// Unsuspend restores an account's access.
func (s *Store) Unsuspend(userID string) error {
	return s.exec(`UPDATE users SET suspended_at = NULL, suspend_reason = NULL WHERE id = ?`, userID)
}

// SetNote replaces the admin's note on an account; "" clears it.
func (s *Store) SetNote(userID, note string) error {
	return s.exec(`UPDATE users SET note = NULLIF(?, '') WHERE id = ?`, note, userID)
}

// Audit records something an admin did. detail may be nil; anything else is
// stored as JSON. A failure is logged, not returned: the action has happened.
func (s *Store) Audit(action, target string, detail any) {
	var d sql.NullString
	if detail != nil {
		b, _ := json.Marshal(detail)
		d = sql.NullString{String: string(b), Valid: true}
	}
	if err := s.exec(`INSERT INTO admin_log (at, action, target, detail) VALUES (?, ?, ?, ?)`, now(), action, target, d); err != nil {
		log.Printf("admin: audit: %v", err)
	}
}

// AuditEntry is one line of the admin activity log.
type AuditEntry struct {
	At     int64  `json:"at"`
	Action string `json:"action"`
	Target string `json:"target"`
	Detail string `json:"detail"`
}

// AuditLog lists the latest 200 things admins did, newest first.
func (s *Store) AuditLog() ([]AuditEntry, error) {
	rows, err := s.db.Query(`SELECT at, action, COALESCE(target, ''), COALESCE(detail, '') FROM admin_log ORDER BY id DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(&e.At, &e.Action, &e.Target, &e.Detail); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

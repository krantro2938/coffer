package store

import "database/sql"

// NewReport is an abuse report filed against a share link.
type NewReport struct {
	ID      string
	ShareID string
	ItemID  string
	Owner   sql.NullString // the account that made the link, if one did
	Reason  string
	Details string
	Contact string // "" for none
	Secret  string // the link's key, if the reporter chose to hand it over
}

// CreateReport files a report.
func (s *Store) CreateReport(r NewReport) error {
	return s.exec(`INSERT INTO reports (id, share_id, item_id, user_id, reason, details, contact, secret, created_at)
		VALUES (?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?)`,
		r.ID, r.ShareID, r.ItemID, r.Owner, r.Reason, r.Details, r.Contact, r.Secret, now())
}

// Report is an abuse report as the admin console lists it.
type Report struct {
	ID           string
	ShareID      string
	Owner        sql.NullString
	OwnerEmail   sql.NullString
	OwnerReports int64 // reports against this owner's links, this one included
	Reason       string
	Details      string
	Contact      sql.NullString
	Secret       sql.NullString
	Status       string // "open", "dismissed" or "actioned"
	Resolution   sql.NullString
	CreatedAt    int64
	ResolvedAt   sql.NullInt64
	LinkLive     bool // the reported link still exists
}

// Reports lists the latest 200 open reports, or the latest 200 closed ones.
func (s *Store) Reports(resolved bool) ([]Report, error) {
	cmp := "="
	if resolved {
		cmp = "!="
	}
	rows, err := s.db.Query(`SELECT r.id, r.share_id, r.user_id, r.reason, r.details, r.contact, r.secret, r.status, r.resolution, r.created_at,
		r.resolved_at, u.email, EXISTS (SELECT 1 FROM shares s WHERE s.id = r.share_id),
		(SELECT COUNT(*) FROM reports x WHERE x.user_id IS NOT NULL AND x.user_id = r.user_id)
		FROM reports r LEFT JOIN users u ON u.id = r.user_id WHERE r.status ` + cmp + ` 'open' ORDER BY r.created_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Report
	for rows.Next() {
		var r Report
		if err := rows.Scan(&r.ID, &r.ShareID, &r.Owner, &r.Reason, &r.Details, &r.Contact, &r.Secret, &r.Status, &r.Resolution, &r.CreatedAt,
			&r.ResolvedAt, &r.OwnerEmail, &r.LinkLive, &r.OwnerReports); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ReportTarget returns what a report was filed against, or ErrNotFound.
func (s *Store) ReportTarget(id string) (shareID string, itemID, owner sql.NullString, err error) {
	err = s.db.QueryRow(`SELECT share_id, item_id, user_id FROM reports WHERE id = ?`, id).Scan(&shareID, &itemID, &owner)
	return shareID, itemID, owner, notFound(err)
}

// ResolveReport closes a report.
func (s *Store) ResolveReport(id, status, resolution string) error {
	return s.exec(`UPDATE reports SET status = ?, resolution = ?, resolved_at = ? WHERE id = ?`, status, resolution, now(), id)
}

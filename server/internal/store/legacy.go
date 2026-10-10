package store

import "database/sql"

// Before migrations were versioned, the schema was created on start-up and
// columns were added to it one by one. adoptLegacy brings a database from
// that time up to the first migration, whichever release it was last run by,
// so that the migration finds nothing left to do and only records itself.
// New installations have no tables yet and skip this.
func adoptLegacy(db *sql.DB) error {
	var legacy bool
	err := db.QueryRow(`SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users')
		AND NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'goose_db_version')`).Scan(&legacy)
	if err != nil || !legacy {
		return err
	}
	for _, c := range []struct{ table, name, def string }{
		{"shares", "open_secret", "TEXT"},
		{"users", "plan", "TEXT"},
		{"users", "sub_status", "TEXT"},
		{"users", "sub_id", "TEXT"},
		{"users", "customer_id", "TEXT"},
		{"users", "period_end", "INTEGER"},
		{"users", "cancel_at", "INTEGER"},
		{"users", "pending_txn", "TEXT"},
		{"users", "sub_updated", "INTEGER NOT NULL DEFAULT 0"},
		{"users", "lapsed_at", "INTEGER"},
		{"users", "lapse_notice", "INTEGER NOT NULL DEFAULT 0"},
		{"users", "email_verified", "INTEGER NOT NULL DEFAULT 1"},
		{"users", "otp_hash", "BLOB"},
		{"users", "otp_expires", "INTEGER"},
		{"users", "otp_tries", "INTEGER NOT NULL DEFAULT 0"},
		{"users", "otp_sent", "INTEGER"},
		{"users", "google_sub", "TEXT"},
		{"users", "lang", "TEXT"},
		{"users", "comp_quota", "INTEGER"},
		{"users", "comp_until", "INTEGER"},
		{"users", "offer", "TEXT"},
		{"users", "suspended_at", "INTEGER"},
		{"users", "suspend_reason", "TEXT"},
		{"users", "note", "TEXT"},
	} {
		var n int
		if err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?`, c.table, c.name).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			if _, err := db.Exec(`ALTER TABLE ` + c.table + ` ADD COLUMN ` + c.name + ` ` + c.def); err != nil {
				return err
			}
		}
	}
	return nil
}

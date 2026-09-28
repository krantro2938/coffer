package main

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"time"
)

// janitor periodically deletes everything that has expired: links, anonymous
// drops, abandoned uploads and old sessions.
func (a *App) janitor(ctx context.Context) {
	a.sweep()
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			a.sweep()
		}
	}
}

func (a *App) sweep() {
	n := now()
	// Burned links linger for the ticket lifetime so their last download can finish.
	burnedCutoff := n - int64(ticketTTL.Seconds())
	if res, err := a.db.Exec(`DELETE FROM shares WHERE (expires_at IS NOT NULL AND expires_at <= ?) OR burned_at <= ?`, n, burnedCutoff); err != nil {
		log.Printf("janitor: shares: %v", err)
	} else if c, _ := res.RowsAffected(); c > 0 {
		log.Printf("janitor: removed %d expired links", c)
	}

	ids, err := a.itemIDs(`SELECT id FROM items WHERE
		(expires_at IS NOT NULL AND expires_at <= ?)
		OR (ready = 0 AND created_at <= ?)
		OR ((user_id IS NULL OR kind = 'bundle') AND created_at <= ? AND NOT EXISTS (SELECT 1 FROM shares WHERE shares.item_id = items.id))`,
		n, n-24*3600, n-3600)
	if err != nil {
		log.Printf("janitor: items: %v", err)
	}
	for _, id := range ids {
		if _, err := a.db.Exec(`DELETE FROM items WHERE id = ?`, id); err != nil {
			log.Printf("janitor: delete item: %v", err)
			continue
		}
		a.removeBlobs([]string{id})
	}
	if len(ids) > 0 {
		log.Printf("janitor: removed %d expired items", len(ids))
	}

	if _, err := a.db.Exec(`DELETE FROM sessions WHERE expires_at <= ?`, n); err != nil {
		log.Printf("janitor: sessions: %v", err)
	}

	// Remove blob files with no database row (e.g. after a crash mid-delete).
	dirs, _ := os.ReadDir(a.blobs)
	for _, d := range dirs {
		if !d.IsDir() {
			continue
		}
		files, _ := os.ReadDir(filepath.Join(a.blobs, d.Name()))
		for _, f := range files {
			info, err := f.Info()
			if err != nil || time.Since(info.ModTime()) < time.Hour {
				continue
			}
			var exists int
			_ = a.db.QueryRow(`SELECT COUNT(*) FROM items WHERE id = ?`, f.Name()).Scan(&exists)
			if exists == 0 {
				_ = os.Remove(filepath.Join(a.blobs, d.Name(), f.Name()))
			}
		}
	}
}

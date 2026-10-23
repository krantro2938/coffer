package app

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"coffer/internal/mail"
	"coffer/internal/storage"
)

// janitor periodically deletes everything that has expired: links, quick
// shares, abandoned uploads and old sessions. Less often it clears stored
// ciphertext nothing points to, snapshots the database and re-checks
// subscriptions that are due.
func (a *App) janitor(ctx context.Context) {
	a.sweep()
	go a.hourly(ctx)
	t := time.NewTicker(time.Minute)
	h := time.NewTicker(time.Hour)
	defer t.Stop()
	defer h.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			a.sweep()
		case <-h.C:
			go a.hourly(ctx)
		}
	}
}

const backupsKept = 14

func (a *App) hourly(ctx context.Context) {
	if !a.hourlyBusy.CompareAndSwap(false, true) {
		return
	}
	defer a.hourlyBusy.Store(false)

	if a.billing != nil {
		a.syncDue(ctx)
		a.enforceLapse(ctx)
	}
	if err := a.db.DeleteExpiredInvites(now() - int64(inviteTTL.Seconds())); err != nil {
		log.Printf("janitor: invites: %v", err)
	}
	if err := a.db.DeleteOrphanedLinkRequests(); err != nil {
		log.Printf("janitor: link requests: %v", err)
	}
	err := a.blobs.Sweep(ctx, func(id string) bool {
		known, err := a.db.ItemExists(id)
		// When in doubt, keep.
		return err != nil || known
	})
	if err != nil && ctx.Err() == nil {
		log.Printf("janitor: orphan sweep: %v", err)
	}
	if time.Since(a.lastBackup) >= 24*time.Hour {
		if err := a.backupDB(ctx); err != nil {
			log.Printf("janitor: database backup: %v", err)
		} else {
			a.lastBackup = time.Now()
		}
	}
}

// backupDB stores a consistent snapshot of the database next to the blobs.
// Without the metadata (wrapped keys above all) the ciphertext is worthless,
// so the two have to be recoverable together. server.key is deliberately not
// included: keep a copy of it somewhere else.
func (a *App) backupDB(ctx context.Context) error {
	tmp := filepath.Join(a.cfg.DataDir, "snapshot.tmp")
	_ = os.Remove(tmp)
	if err := a.db.Snapshot(ctx, tmp); err != nil {
		return err
	}
	return a.blobs.Backup(ctx, storage.BackupPrefix+time.Now().UTC().Format("20060102")+".db", tmp, backupsKept)
}

func (a *App) sweep() {
	// Burned links linger for the ticket lifetime so their last download can finish.
	if c, err := a.db.DeleteExpiredShares(now() - int64(ticketTTL.Seconds())); err != nil {
		log.Printf("janitor: shares: %v", err)
	} else if c > 0 {
		log.Printf("janitor: removed %d expired links", c)
	}

	ids, err := a.db.ExpiredItemIDs()
	if err != nil {
		log.Printf("janitor: items: %v", err)
	}
	for _, id := range ids {
		if err := a.db.DeleteItem(id); err != nil {
			log.Printf("janitor: delete item: %v", err)
			continue
		}
		a.removeBlobs([]string{id})
	}
	if len(ids) > 0 {
		log.Printf("janitor: removed %d expired items", len(ids))
	}

	if err := a.db.DeleteExpiredSessions(); err != nil {
		log.Printf("janitor: sessions: %v", err)
	}
	if a.mail != nil && a.cfg.PublicURL != "" && a.telling.CompareAndSwap(false, true) {
		go func() {
			defer a.telling.Store(false)
			a.tellArrivals()
		}()
	}
	// Sign-ups that never confirmed their email; they cannot have stored anything.
	if err := a.db.DeleteStaleSignups(now() - 24*3600); err != nil {
		log.Printf("janitor: unverified accounts: %v", err)
	}
}

// arrivalQuiet is how long uploads through an account's links must have
// stopped before it is emailed about them, so that a batch makes one email.
const arrivalQuiet = 2 * time.Minute

// tellArrivals emails each account that has new files from its links. The
// email can say how many, never which: the server cannot read their names.
func (a *App) tellArrivals() {
	due, err := a.db.PendingArrivals(now() - int64(arrivalQuiet.Seconds()))
	if err != nil {
		log.Printf("janitor: arrivals: %v", err)
		return
	}
	for _, d := range due {
		// Marked first: a failed send is not retried, rather than risk sending twice.
		if err := a.db.MarkArrivalsTold(d.UserID, d.Latest); err != nil {
			log.Printf("janitor: arrivals: %v", err)
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		err := a.mail.Send(ctx, d.Email, mail.ArrivalMessage(d.Lang, d.Files, strings.TrimRight(a.cfg.PublicURL, "/")+"/requests"))
		cancel()
		if err != nil {
			log.Printf("mail: arrivals: %v", err)
		}
	}
}

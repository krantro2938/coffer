package store

import (
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
)

func open(t *testing.T) *Store {
	t.Helper()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func addUser(t *testing.T, s *Store, id, email string) {
	t.Helper()
	err := s.CreateUser(NewUser{
		ID: id, Email: email, KDFSalt: []byte("salt"), KDFParams: "{}", AuthHash: []byte("hash"), WrappedMK: []byte("mk"),
		RecoveryAuthHash: []byte("rhash"), RecoveryWrappedMK: []byte("rmk"), Quota: 1 << 20, Verified: true, Lang: "en",
	})
	if err != nil {
		t.Fatal(err)
	}
}

// addItem stores a finished one-chunk item; a nil owner makes it a quick-share file.
func addItem(t *testing.T, s *Store, id string, owner *string, manageHash []byte) {
	t.Helper()
	exp := now() + 3600
	it := NewItem{ID: id, UserID: owner, Kind: "file", EncMeta: []byte("meta"), Size: 116, ChunkSize: 65536, ChunkCount: 1}
	if owner == nil {
		it.ManageHash, it.ExpiresAt = manageHash, &exp
	}
	if err := s.CreateItem(it); err != nil {
		t.Fatal(err)
	}
	if err := s.AddChunk(id, 116); err != nil {
		t.Fatal(err)
	}
	if err := s.FinishUpload(id); err != nil {
		t.Fatal(err)
	}
}

func TestOpenTwice(t *testing.T) {
	dir := t.TempDir()
	for range 2 {
		s, err := Open(dir)
		if err != nil {
			t.Fatal(err)
		}
		s.Close()
	}
}

// A database from the first release, before any column was added and before
// migrations were versioned, must come up with its rows intact.
func TestAdoptLegacy(t *testing.T) {
	dir := t.TempDir()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(dir, "coffer.db"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`
		CREATE TABLE users (
			id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, kdf_salt BLOB NOT NULL, kdf_params TEXT NOT NULL,
			auth_hash BLOB NOT NULL, wrapped_mk BLOB NOT NULL, recovery_auth_hash BLOB NOT NULL, recovery_wrapped_mk BLOB NOT NULL,
			quota INTEGER NOT NULL, created_at INTEGER NOT NULL);
		CREATE TABLE sessions (token_hash BLOB PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
		CREATE TABLE folders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE, enc_name BLOB NOT NULL, created_at INTEGER NOT NULL);
		CREATE TABLE items (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
			folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE, kind TEXT NOT NULL, enc_meta BLOB NOT NULL, wrapped_key BLOB,
			size INTEGER NOT NULL, chunk_size INTEGER NOT NULL, chunk_count INTEGER NOT NULL, recv_chunks INTEGER NOT NULL DEFAULT 0,
			recv_bytes INTEGER NOT NULL DEFAULT 0, ready INTEGER NOT NULL DEFAULT 0, manage_hash BLOB, expires_at INTEGER,
			created_at INTEGER NOT NULL);
		CREATE TABLE shares (id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
			user_id TEXT REFERENCES users(id) ON DELETE CASCADE, wrapped_key BLOB NOT NULL, access_hash BLOB NOT NULL,
			enc_secret BLOB, pw_salt BLOB, pw_params TEXT, max_views INTEGER, views INTEGER NOT NULL DEFAULT 0, burned_at INTEGER,
			expires_at INTEGER, created_at INTEGER NOT NULL);
		INSERT INTO users VALUES ('u1', 'old@example.com', x'01', '{}', x'02', x'03', x'04', x'05', 1024, 1700000000);
		INSERT INTO items (id, user_id, kind, enc_meta, size, chunk_size, chunk_count, ready, created_at)
			VALUES ('i1', 'u1', 'file', x'06', 100, 65536, 1, 1, 1700000000);`)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()

	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	st, err := s.Standing("u1")
	if err != nil {
		t.Fatal(err)
	}
	if !st.Verified || st.Suspended || st.Quota != 1024 {
		t.Errorf("standing of a legacy account = %+v; want verified, not suspended, quota 1024", st)
	}
	if used, err := s.Usage("u1"); err != nil || used != 100 {
		t.Errorf("Usage = %d, %v; want 100", used, err)
	}
	// Tables and columns that came later are there to be used.
	if err := s.CreateShare(NewShare{ID: "abcdefg", ItemID: "i1", WrappedKey: []byte("k"), AccessHash: []byte("h")}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Reports(false); err != nil {
		t.Fatal(err)
	}
}

func TestCreateUserTwice(t *testing.T) {
	s := open(t)
	addUser(t, s, "u1", "a@example.com")
	err := s.CreateUser(NewUser{ID: "u2", Email: "A@Example.com", KDFSalt: []byte("s"), KDFParams: "{}", AuthHash: []byte("h"),
		WrappedMK: []byte("m"), RecoveryAuthHash: []byte("r"), RecoveryWrappedMK: []byte("w")})
	if !errors.Is(err, ErrExists) {
		t.Fatalf("second account on the same address: %v; want ErrExists", err)
	}
}

func TestSessions(t *testing.T) {
	s := open(t)
	addUser(t, s, "u1", "a@example.com")
	if err := s.CreateSession([]byte("live"), "u1", now()+60, "s1", "Firefox"); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateSession([]byte("stale"), "u1", now()-1, "s2", "Chrome"); err != nil {
		t.Fatal(err)
	}
	if uid, err := s.SessionUser([]byte("live")); err != nil || uid != "u1" {
		t.Errorf("live session: %q, %v", uid, err)
	}
	if _, err := s.SessionUser([]byte("stale")); !errors.Is(err, ErrNotFound) {
		t.Errorf("expired session: %v; want ErrNotFound", err)
	}
	if err := s.DeleteSessions("u1"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SessionUser([]byte("live")); !errors.Is(err, ErrNotFound) {
		t.Errorf("after signing out everywhere: %v; want ErrNotFound", err)
	}
}

func TestOpenShareCountsViews(t *testing.T) {
	s := open(t)
	addItem(t, s, "i1", nil, []byte("manage"))
	two := int64(2)
	if err := s.CreateShare(NewShare{ID: "abcdefg", ItemID: "i1", WrappedKey: []byte("k"), AccessHash: []byte("right"), MaxViews: &two}); err != nil {
		t.Fatal(err)
	}
	allow := func([]byte) error { return nil }
	refused := errors.New("wrong token")

	if _, err := s.OpenShare("abcdefg", false, func([]byte) error { return refused }); err != refused {
		t.Fatalf("refused open: %v; want the authorizer's error", err)
	}
	o, err := s.OpenShare("abcdefg", false, allow)
	if err != nil {
		t.Fatal(err)
	}
	if o.Views != 1 || o.Burned {
		t.Errorf("first open: views %d, burned %v; a refused open must not count", o.Views, o.Burned)
	}
	if o, err = s.OpenShare("abcdefg", false, allow); err != nil || !o.Burned {
		t.Fatalf("second open: %+v, %v; want it to use the link up", o, err)
	}
	if _, err := s.OpenShare("abcdefg", false, allow); !errors.Is(err, ErrNotFound) {
		t.Errorf("third open: %v; want ErrNotFound", err)
	}
}

func TestSharesPauseWithTheirOwner(t *testing.T) {
	s := open(t)
	addUser(t, s, "u1", "a@example.com")
	owner := "u1"
	addItem(t, s, "i1", &owner, nil)
	if err := s.CreateShare(NewShare{ID: "abcdefg", ItemID: "i1", UserID: &owner, WrappedKey: []byte("k"), AccessHash: []byte("h")}); err != nil {
		t.Fatal(err)
	}
	opens := func(billing bool) bool {
		t.Helper()
		_, err := s.SharePreview("abcdefg", billing)
		if err != nil && !errors.Is(err, ErrNotFound) {
			t.Fatal(err)
		}
		return err == nil
	}

	if !opens(false) {
		t.Error("a link from a free drive should open")
	}
	if opens(true) {
		t.Error("with billing on, a link from a drive without a plan should not open")
	}
	quota := int64(1 << 30)
	if err := s.SetTerms("u1", Terms{CompQuota: &quota}); err != nil {
		t.Fatal(err)
	}
	if !opens(true) {
		t.Error("a complimentary allowance should cover the drive's links")
	}
	if err := s.Suspend("u1", "testing", false); err != nil {
		t.Fatal(err)
	}
	if opens(false) || opens(true) {
		t.Error("a suspended account's links should not open")
	}
}

func TestQuickShareTotals(t *testing.T) {
	s := open(t)
	if _, err := s.QuickShare([]byte("nothing"), 16); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown manage token: %v; want ErrNotFound", err)
	}
	addItem(t, s, "i1", nil, []byte("manage"))
	addItem(t, s, "i2", nil, []byte("manage"))
	addItem(t, s, "i3", nil, []byte("another"))
	qs, err := s.QuickShare([]byte("manage"), 16)
	if err != nil {
		t.Fatal(err)
	}
	if qs.Files != 2 || qs.Bundles != 0 || qs.Bytes != 200 {
		t.Errorf("totals = %+v; want 2 files, no manifest, 200 plaintext bytes", qs)
	}
	ids, err := s.QuickShareSiblingIDs("i1")
	if err != nil || len(ids) != 2 {
		t.Errorf("siblings of i1 = %v, %v; want i1 and i2", ids, err)
	}
}

func TestStaleSubscriptionSnapshotIsIgnored(t *testing.T) {
	s := open(t)
	addUser(t, s, "u1", "a@example.com")
	apply := func(status string, at int64) {
		t.Helper()
		err := s.ApplySubscription("u1", Subscription{
			ID: "sub_1", CustomerID: "ctm_1", Plan: "plus", Status: status, Quota: 500 << 30,
			Entitled: status == "active", UpdatedAt: at,
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	apply("active", 200)
	apply("canceled", 100) // a webhook that arrives late
	st, err := s.Standing("u1")
	if err != nil {
		t.Fatal(err)
	}
	if st.Status.String != "active" || st.LapsedAt.Valid {
		t.Errorf("after a late snapshot: status %q, lapsed %v; want still active", st.Status.String, st.LapsedAt.Valid)
	}
	apply("canceled", 300)
	if st, _ = s.Standing("u1"); st.Status.String != "canceled" || !st.LapsedAt.Valid {
		t.Errorf("after cancelling: status %q, lapsed %v; want canceled and in its grace period", st.Status.String, st.LapsedAt.Valid)
	}
}

func TestAccountFilter(t *testing.T) {
	s := open(t)
	addUser(t, s, "u1", "ann@example.com")
	addUser(t, s, "u2", "bob_100%@example.com")
	if err := s.Suspend("u2", "testing", false); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		f    AccountFilter
		want int
	}{
		{AccountFilter{}, 2},
		{AccountFilter{Email: "ann"}, 1},
		{AccountFilter{Email: "_100%"}, 1}, // LIKE wildcards are taken literally
		{AccountFilter{Email: "%"}, 1},
		{AccountFilter{Only: "suspended"}, 1},
		{AccountFilter{Only: "suspended", Email: "ann"}, 0},
	} {
		got, err := s.Accounts(c.f)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != c.want {
			t.Errorf("Accounts(%+v) = %d accounts; want %d", c.f, len(got), c.want)
		}
	}
}

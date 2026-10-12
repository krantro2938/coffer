package store

import "testing"

func TestDailyCounts(t *testing.T) {
	s := open(t)
	today := now() / 86400 * 86400
	at := func(daysAgo int, hours int64) int64 { return today - int64(daysAgo)*86400 + hours*3600 }
	mustExec := func(q string, args ...any) {
		t.Helper()
		if _, err := s.db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	// a signs up 3 days ago and makes a request link 2 hours later; b signs up the same day and does
	// not; c signs up 3 days ago and makes one 2 days later, too late to count.
	for id, email := range map[string]string{"a": "a@x.test", "b": "b@x.test", "c": "c@x.test"} {
		addUser(t, s, id, email)
		mustExec(`UPDATE users SET created_at = ? WHERE id = ?`, at(3, 1), id)
	}
	req := func(id, user string, created int64, share *string) {
		mustExec(`INSERT INTO requests (id, user_id, access_hash, enc_info, enc_secret, enc_private, share_id, created_at)
			VALUES (?, ?, x'01', x'01', x'01', x'01', ?, ?)`, id, user, share, created)
	}
	req("r1", "a", at(3, 3), nil)
	req("r2", "c", at(1, 1), nil)
	folder := "sh"
	req("r3", "b", at(3, 2), &folder) // behind a folder link: not a request link

	owner := "a"
	addItem(t, s, "i1", &owner, nil)
	addItem(t, s, "i2", &owner, nil)
	mustExec(`UPDATE items SET request_id = 'r1', created_at = ? WHERE id = 'i1'`, at(2, 5))
	mustExec(`UPDATE items SET request_id = 'r3', created_at = ? WHERE id = 'i2'`, at(2, 5))

	// Two links made and three opens today are counted even though the links no longer exist.
	mustExec(`INSERT INTO daily_counts (day, metric, n) VALUES (date('now'), 'share_created', 2), (date('now'), 'share_opened', 3)`)

	days, err := s.Daily(30)
	if err != nil {
		t.Fatal(err)
	}
	if len(days) != 30 {
		t.Fatalf("%d days", len(days))
	}
	byAgo := func(n int) Day { return days[29-n] }
	if d := byAgo(3); d.Signups != 3 || d.SignupsWithLink != 1 || d.RequestsCreated != 1 {
		t.Errorf("3 days ago: %+v", d)
	}
	if d := byAgo(2); d.FilesReceived != 1 {
		t.Errorf("2 days ago: %+v", d)
	}
	if d := byAgo(1); d.RequestsCreated != 1 || d.Signups != 0 {
		t.Errorf("yesterday: %+v", d)
	}
	if d := byAgo(0); d != (Day{Day: d.Day, SharesCreated: 2, SharesOpened: 3}) {
		t.Errorf("today: %+v", d)
	}
}

func TestOpeningAndMakingLinksIsCounted(t *testing.T) {
	s := open(t)
	addUser(t, s, "u", "u@x.test")
	owner := "u"
	addItem(t, s, "it", &owner, nil)
	if err := s.CreateShare(NewShare{ID: "sh1", ItemID: "it", UserID: &owner, WrappedKey: []byte("k"), AccessHash: []byte("a")}); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := s.OpenShare("sh1", false, func([]byte) error { return nil }); err != nil {
			t.Fatal(err)
		}
	}
	// A wrong token opens nothing and counts nothing.
	if _, err := s.OpenShare("sh1", false, func([]byte) error { return ErrNotFound }); err == nil {
		t.Fatal("expected a refusal")
	}
	days, err := s.Daily(2)
	if err != nil {
		t.Fatal(err)
	}
	if d := days[1]; d.SharesCreated != 1 || d.SharesOpened != 2 {
		t.Errorf("%+v", d)
	}
}

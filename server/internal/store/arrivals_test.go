package store

import "testing"

func TestPendingArrivals(t *testing.T) {
	s := open(t)
	addUser(t, s, "u1", "owner@example.com")
	if err := s.CreateRequest(NewRequest{ID: "r1", UserID: "u1", AccessHash: []byte("a"), EncInfo: []byte("i"),
		EncSecret: []byte("s"), EncPrivate: []byte("p")}); err != nil {
		t.Fatal(err)
	}
	owner, request := "u1", "r1"
	upload := func(id string, finish bool) {
		t.Helper()
		err := s.CreateItem(NewItem{ID: id, UserID: &owner, Kind: "file", EncMeta: []byte("meta"), Size: 116, ChunkSize: 65536,
			ChunkCount: 1, RequestID: &request, SealedKey: []byte("sealed")})
		if err != nil {
			t.Fatal(err)
		}
		if finish {
			if err := s.AddChunk(id, 116); err != nil {
				t.Fatal(err)
			}
			if err := s.FinishUpload(id); err != nil {
				t.Fatal(err)
			}
		}
	}
	pending := func(quietSince int64) []Arrivals {
		t.Helper()
		got, err := s.PendingArrivals(quietSince)
		if err != nil {
			t.Fatal(err)
		}
		return got
	}

	upload("i1", true)
	upload("i2", true)
	if got := pending(now() - 120); len(got) != 0 {
		t.Fatalf("told while uploads are still fresh: %+v", got)
	}
	upload("i3", false)
	if got := pending(now() + 1); len(got) != 0 {
		t.Fatalf("told while an upload is still going: %+v", got)
	}
	if err := s.AddChunk("i3", 116); err != nil {
		t.Fatal(err)
	}
	if err := s.FinishUpload("i3"); err != nil {
		t.Fatal(err)
	}
	got := pending(now() + 1)
	if len(got) != 1 || got[0].Files != 3 || got[0].Email != "owner@example.com" {
		t.Fatalf("want one email about 3 files, got %+v", got)
	}
	if err := s.MarkArrivalsTold("u1", got[0].Latest); err != nil {
		t.Fatal(err)
	}
	if got := pending(now() + 1); len(got) != 0 {
		t.Fatalf("told twice: %+v", got)
	}
	if err := s.SetNotifyUploads("u1", false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE users SET uploads_notified_at = 0`); err != nil {
		t.Fatal(err)
	}
	if got := pending(now() + 1); len(got) != 0 {
		t.Fatalf("told an account that turned the emails off: %+v", got)
	}
}

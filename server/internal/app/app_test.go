package app

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"coffer/internal/config"
	"coffer/internal/storage"
	"coffer/internal/store"
)

const testAdminToken = "an-admin-token-for-the-tests"

// server is a Coffer server on a throwaway data directory: free drives, no
// email, no web app.
type server struct {
	t      *testing.T
	app    *App
	public *httptest.Server
	admin  *httptest.Server
}

func newServer(t *testing.T, tweak func(*config.Config)) *server {
	t.Helper()
	dir := t.TempDir()
	cfg := config.Config{
		DataDir: dir, StaticDir: filepath.Join(dir, "no-web-app"), PublicURL: "https://coffer.test",
		AllowRegistration: true, AllowAnonymous: true,
		MaxFileSize: 1 << 20, AnonMaxShareSize: 1 << 20, AnonMaxFiles: 2, UserQuota: 1 << 20,
		AnonMaxExpiry: 24 * time.Hour, SessionTTL: time.Hour, AdminToken: testAdminToken,
	}
	if tweak != nil {
		tweak(&cfg)
	}
	db, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	blobs, err := storage.NewLocal(dir)
	if err != nil {
		t.Fatal(err)
	}
	a := New(cfg, db, blobs, random(32))
	s := &server{t: t, app: a, public: httptest.NewServer(a.Handler()), admin: httptest.NewServer(a.AdminHandler())}
	t.Cleanup(func() {
		s.public.Close()
		s.admin.Close()
		db.Close()
	})
	return s
}

func encodeB64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

func random(n int) []byte {
	b := make([]byte, n)
	rand.Read(b)
	return b
}

// client is one browser: it keeps cookies and sends the header the API insists on.
type client struct {
	t    *testing.T
	base string
	hc   *http.Client
}

func (s *server) browser() *client      { return s.client(s.public.URL) }
func (s *server) adminBrowser() *client { return s.client(s.admin.URL) }
func (s *server) client(base string) *client {
	jar, _ := cookiejar.New(nil)
	return &client{t: s.t, base: base, hc: &http.Client{Jar: jar}}
}

// do sends a request and decodes a JSON reply into out, returning the status.
// body may be nil, raw bytes, or anything to send as JSON.
func (c *client) do(method, path string, body, out any, headers ...string) int {
	c.t.Helper()
	var r io.Reader
	switch b := body.(type) {
	case nil:
	case []byte:
		r = bytes.NewReader(b)
	default:
		j, err := json.Marshal(b)
		if err != nil {
			c.t.Fatal(err)
		}
		r = bytes.NewReader(j)
	}
	req, err := http.NewRequest(method, c.base+path, r)
	if err != nil {
		c.t.Fatal(err)
	}
	req.Header.Set("X-Coffer", "1")
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	res, err := c.hc.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	switch o := out.(type) {
	case nil:
	case *[]byte:
		*o = raw
	default:
		if err := json.Unmarshal(raw, out); err != nil {
			c.t.Fatalf("%s %s: %d %s", method, path, res.StatusCode, raw)
		}
	}
	return res.StatusCode
}

// must is do for calls that have to succeed.
func (c *client) must(want int, method, path string, body, out any, headers ...string) {
	c.t.Helper()
	var raw []byte
	if got := c.do(method, path, body, &raw, headers...); got != want {
		c.t.Fatalf("%s %s: got %d %s; want %d", method, path, got, raw, want)
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			c.t.Fatalf("%s %s: %s", method, path, raw)
		}
	}
}

type account struct {
	email             string
	authKey, recovery []byte
}

// register opens an account the way the web app does: with keys the server
// cannot tell from random bytes, because to it they are.
func (c *client) register(email string, extra map[string]any) (account, int) {
	c.t.Helper()
	acct := account{email: email, authKey: random(32), recovery: random(32)}
	req := map[string]any{
		"email": email, "salt": random(16), "kdf": defaultKDF, "authKey": acct.authKey, "wrappedMasterKey": random(60),
		"recoveryAuthKey": acct.recovery, "recoveryWrappedMasterKey": random(60),
	}
	for k, v := range extra {
		req[k] = v
	}
	return acct, c.do("POST", "/api/auth/register", req, nil)
}

func (c *client) mustRegister(email string) account {
	c.t.Helper()
	acct, status := c.register(email, nil)
	if status != 200 {
		c.t.Fatalf("register %s: %d", email, status)
	}
	return acct
}

// upload stores one small item. With a wrapped key it goes into the signed-in
// account's drive; without, it starts a quick share and returns its manage token.
func (c *client) upload(data []byte, drive bool, headers ...string) (id, manageToken string) {
	c.t.Helper()
	id = randomID(26)
	req := map[string]any{
		"id": id, "kind": "file", "encMeta": random(40), "size": len(data), "chunkSize": minChunkSize, "chunkCount": 1,
	}
	if drive {
		req["wrappedKey"] = random(60)
	} else {
		req["expiresIn"] = 3600
	}
	var created struct {
		ManageToken string `json:"manageToken"`
	}
	c.must(201, "POST", "/api/items", req, &created, headers...)
	if created.ManageToken != "" {
		headers = append(headers, "X-Manage-Token", created.ManageToken)
	}
	c.must(200, "PUT", "/api/items/"+id+"/chunks/0", data, nil, headers...)
	c.must(200, "POST", "/api/items/"+id+"/complete", nil, nil, headers...)
	return id, created.ManageToken
}

// share makes a link to an item and returns its id and the access token that opens it.
func (c *client) share(itemID string, opts map[string]any, headers ...string) (id string, access []byte) {
	c.t.Helper()
	access = random(32)
	req := map[string]any{"itemId": itemID, "wrappedKey": random(60), "accessHash": sha(access)}
	for k, v := range opts {
		req[k] = v
	}
	var sh store.Share
	c.must(201, "POST", "/api/shares", req, &sh, headers...)
	return sh.ID, access
}

func TestStateChangingRequestsNeedTheHeader(t *testing.T) {
	s := newServer(t, nil)
	res, err := http.Post(s.public.URL+"/api/auth/logout", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Errorf("POST without X-Coffer: %d; want 403", res.StatusCode)
	}
}

func TestAccount(t *testing.T) {
	s := newServer(t, nil)
	c := s.browser()
	acct := c.mustRegister("ann@example.com")

	var me struct {
		Email    string `json:"email"`
		Quota    int64  `json:"quota"`
		Verified bool   `json:"verified"`
		Billing  any    `json:"billing"`
	}
	c.must(200, "GET", "/api/auth/me", nil, &me)
	if me.Email != acct.email || me.Quota != 1<<20 || !me.Verified || me.Billing != nil {
		t.Errorf("me = %+v; want a verified free drive of 1 MiB", me)
	}
	if _, status := s.browser().register("ANN@example.com", nil); status != http.StatusConflict {
		t.Errorf("registering the same address again: %d; want 409", status)
	}

	other := s.browser()
	if status := other.do("POST", "/api/auth/login", map[string]any{"email": acct.email, "authKey": random(32)}, nil); status != 401 {
		t.Errorf("login with the wrong key: %d; want 401", status)
	}
	other.must(200, "POST", "/api/auth/login", map[string]any{"email": acct.email, "authKey": acct.authKey}, nil)

	// Changing the password signs every other browser out.
	newKey := random(32)
	c.must(200, "POST", "/api/auth/password", map[string]any{
		"authKey": acct.authKey, "salt": random(16), "kdf": defaultKDF, "newAuthKey": newKey, "wrappedMasterKey": random(60),
	}, nil)
	if status := other.do("GET", "/api/auth/me", nil, nil); status != 401 {
		t.Errorf("the other browser after a password change: %d; want 401", status)
	}
	c.must(200, "GET", "/api/auth/me", nil, nil)

	// The recovery key lets the owner back in with a new password.
	fresh := s.browser()
	fresh.must(200, "POST", "/api/auth/recover/finish", map[string]any{
		"email": acct.email, "recoveryAuthKey": acct.recovery, "salt": random(16), "kdf": defaultKDF,
		"authKey": random(32), "wrappedMasterKey": random(60),
	}, nil)
	if status := s.browser().do("POST", "/api/auth/login", map[string]any{"email": acct.email, "authKey": newKey}, nil); status != 401 {
		t.Errorf("login with the password that recovery replaced: %d; want 401", status)
	}
}

func TestDrive(t *testing.T) {
	s := newServer(t, nil)
	c := s.browser()
	c.mustRegister("ann@example.com")

	var outer, inner struct {
		ID string `json:"id"`
	}
	c.must(201, "POST", "/api/folders", map[string]any{"encName": random(40)}, &outer)
	c.must(201, "POST", "/api/folders", map[string]any{"encName": random(40), "parentId": outer.ID}, &inner)
	if status := c.do("PATCH", "/api/folders/"+outer.ID, map[string]any{"parentId": inner.ID}, nil); status != 400 {
		t.Errorf("moving a folder into its own subfolder: %d; want 400", status)
	}

	data := random(500)
	id, _ := c.upload(data, true)
	c.must(200, "PATCH", "/api/items/"+id, map[string]any{"folderId": inner.ID}, nil)

	var got []byte
	if status := c.do("GET", "/api/items/"+id+"/blob", nil, &got); status != 200 || !bytes.Equal(got, data) {
		t.Error("the download differs from what was uploaded")
	}
	if status := s.browser().do("GET", "/api/items/"+id+"/blob", nil, nil); status != 401 {
		t.Errorf("someone else's download: %d; want 401", status)
	}

	var drive struct {
		Folders []store.Folder    `json:"folders"`
		Items   []store.DriveItem `json:"items"`
		Usage   struct{ Used, Quota int64 }
	}
	c.must(200, "GET", "/api/drive", nil, &drive)
	if len(drive.Folders) != 2 || len(drive.Items) != 1 || drive.Usage.Used != 500 {
		t.Errorf("drive = %d folders, %d items, %d bytes; want 2, 1, 500", len(drive.Folders), len(drive.Items), drive.Usage.Used)
	}

	// Deleting the outer folder takes the subfolder and the file with it.
	c.must(200, "DELETE", "/api/folders/"+outer.ID, nil, nil)
	c.must(200, "GET", "/api/drive", nil, &drive)
	if len(drive.Folders) != 0 || len(drive.Items) != 0 || drive.Usage.Used != 0 {
		t.Errorf("after deleting the folder: %d folders, %d items, %d bytes", len(drive.Folders), len(drive.Items), drive.Usage.Used)
	}
}

func TestDriveQuota(t *testing.T) {
	s := newServer(t, func(c *config.Config) { c.UserQuota = 1000 })
	c := s.browser()
	c.mustRegister("ann@example.com")
	c.upload(random(600), true)
	status := c.do("POST", "/api/items", map[string]any{
		"id": randomID(26), "kind": "file", "encMeta": random(40), "wrappedKey": random(60),
		"size": 600, "chunkSize": minChunkSize, "chunkCount": 1,
	}, nil)
	if status != http.StatusInsufficientStorage {
		t.Errorf("an upload past the quota: %d; want 507", status)
	}
}

func TestShareBurnsAfterItsViews(t *testing.T) {
	s := newServer(t, nil)
	owner := s.browser()
	owner.mustRegister("ann@example.com")
	data := random(300)
	itemID, _ := owner.upload(data, true)
	id, access := owner.share(itemID, map[string]any{"maxViews": 1})

	visitor := s.browser()
	visitor.must(200, "GET", "/api/s/"+id, nil, nil)
	if status := visitor.do("POST", "/api/s/"+id+"/open", map[string]any{"access": random(32)}, nil); status != 401 {
		t.Fatalf("opening with the wrong token: %d; want 401", status)
	}
	// The wrong token did not use up the single view.
	var opened struct {
		Ticket    string `json:"ticket"`
		Burned    bool   `json:"burned"`
		ViewsLeft int64  `json:"viewsLeft"`
	}
	visitor.must(200, "POST", "/api/s/"+id+"/open", map[string]any{"access": access}, &opened)
	if !opened.Burned || opened.ViewsLeft != 0 {
		t.Errorf("opened = %+v; want the link used up", opened)
	}
	// The ticket still serves the download that view paid for.
	var got []byte
	if status := visitor.do("GET", "/api/s/"+id+"/blob", nil, &got, "X-Ticket", opened.Ticket); status != 200 || !bytes.Equal(got, data) {
		t.Errorf("download with the ticket: %d, %d bytes", status, len(got))
	}
	if status := visitor.do("GET", "/api/s/"+id, nil, nil); status != 404 {
		t.Errorf("the link after its last view: %d; want 404", status)
	}
}

func TestQuickShare(t *testing.T) {
	s := newServer(t, nil)
	c := s.browser()
	first, token := c.upload(random(100), false)
	c.upload(random(100), false, "X-Manage-Token", token)
	// AnonMaxFiles is 2 here.
	status := c.do("POST", "/api/items", map[string]any{
		"id": randomID(26), "kind": "file", "encMeta": random(40), "size": 100, "chunkSize": minChunkSize, "chunkCount": 1,
	}, nil, "X-Manage-Token", token)
	if status != http.StatusRequestEntityTooLarge {
		t.Errorf("a third file in a quick share of two: %d; want 413", status)
	}

	id, access := c.share(first, nil, "X-Manage-Token", token)
	if status := s.browser().do("POST", "/api/shares", map[string]any{"itemId": first, "wrappedKey": random(60), "accessHash": random(32)}, nil); status != 404 {
		t.Errorf("sharing a quick share without its manage token: %d; want 404", status)
	}
	s.browser().must(200, "POST", "/api/s/"+id+"/open", map[string]any{"access": access}, nil)

	var st struct {
		Active bool  `json:"active"`
		Views  int64 `json:"views"`
	}
	c.must(200, "GET", "/api/items/"+first+"/status", nil, &st, "X-Manage-Token", token)
	if !st.Active || st.Views != 1 {
		t.Errorf("status = %+v; want live with one view", st)
	}
	// Cancelling takes every file of the quick share, and the link.
	c.must(200, "DELETE", "/api/items/"+first, nil, nil, "X-Manage-Token", token)
	if status := s.browser().do("GET", "/api/s/"+id, nil, nil); status != 404 {
		t.Errorf("the link after its quick share was cancelled: %d; want 404", status)
	}
}

func TestAdminConsoleIsNotOnThePublicSite(t *testing.T) {
	s := newServer(t, nil)
	if status := s.browser().do("GET", "/api/admin/session", nil, nil); status != 404 {
		t.Errorf("the admin API on the public site: %d; want 404", status)
	}
	a := s.adminBrowser()
	if status := a.do("GET", "/api/admin/users", nil, nil); status != 401 {
		t.Errorf("the account list without signing in: %d; want 401", status)
	}
	if status := a.do("POST", "/api/admin/login", map[string]any{"token": "not the token"}, nil); status != 401 {
		t.Errorf("signing in with the wrong token: %d; want 401", status)
	}
	if status := a.do("GET", "/api/auth/me", nil, nil); status != 404 {
		t.Errorf("the public API on the admin listener: %d; want 404", status)
	}
}

func (s *server) signedInAdmin() *client {
	s.t.Helper()
	a := s.adminBrowser()
	a.must(200, "POST", "/api/admin/login", map[string]any{"token": testAdminToken}, nil)
	return a
}

func TestInvitation(t *testing.T) {
	s := newServer(t, nil)
	a := s.signedInAdmin()
	quota := int64(5 << 30)
	var inv struct {
		Link string `json:"link"`
	}
	a.must(201, "POST", "/api/admin/invites", map[string]any{"email": "guest@example.com", "compQuota": quota}, &inv)
	const prefix = "https://coffer.test/register?invite="
	if len(inv.Link) <= len(prefix) || inv.Link[:len(prefix)] != prefix {
		t.Fatalf("invitation link = %q", inv.Link)
	}
	token := inv.Link[len(prefix):]

	c := s.browser()
	var who struct {
		Email     string `json:"email"`
		CompQuota int64  `json:"compQuota"`
	}
	c.must(200, "GET", "/api/invites/"+token, nil, &who)
	if who.Email != "guest@example.com" || who.CompQuota != quota {
		t.Errorf("the invitation is for %q with %d bytes; want the guest and what was promised", who.Email, who.CompQuota)
	}
	if _, status := s.browser().register("someone-else@example.com", map[string]any{"invite": token}); status != 400 {
		t.Errorf("accepting an invitation as another address: %d; want 400", status)
	}
	if _, status := c.register("guest@example.com", map[string]any{"invite": token}); status != 200 {
		t.Fatalf("accepting the invitation: %d", status)
	}
	var me struct {
		Quota int64 `json:"quota"`
	}
	c.must(200, "GET", "/api/auth/me", nil, &me)
	if me.Quota != quota {
		t.Errorf("quota = %d; want the %d the invitation promised", me.Quota, quota)
	}
	if status := s.browser().do("GET", "/api/invites/"+token, nil, nil); status != 404 {
		t.Errorf("a used invitation: %d; want 404", status)
	}

	var log []store.AuditEntry
	a.must(200, "GET", "/api/admin/log", nil, &log)
	if len(log) != 2 || log[0].Action != "invite" || log[1].Action != "sign in" {
		t.Errorf("activity log = %+v; want the invitation, then the sign-in", log)
	}
}

func TestReportAndSuspension(t *testing.T) {
	s := newServer(t, nil)
	owner := s.browser()
	acct := owner.mustRegister("ann@example.com")
	itemID, _ := owner.upload(random(200), true)
	reported, _ := owner.share(itemID, nil)
	other, _ := owner.share(itemID, nil)

	s.browser().must(201, "POST", "/api/s/"+reported+"/report", map[string]any{
		"reason": "malware", "details": "This file is not what it says it is.",
	}, nil)

	a := s.signedInAdmin()
	var reports []struct {
		ID         string `json:"id"`
		ShareID    string `json:"shareId"`
		OwnerEmail string `json:"ownerEmail"`
		LinkLive   bool   `json:"linkLive"`
	}
	a.must(200, "GET", "/api/admin/reports", nil, &reports)
	if len(reports) != 1 || reports[0].ShareID != reported || reports[0].OwnerEmail != acct.email || !reports[0].LinkLive {
		t.Fatalf("open reports = %+v", reports)
	}
	a.must(200, "POST", "/api/admin/reports/"+reports[0].ID, map[string]any{"action": "remove-link"}, nil)
	if status := s.browser().do("GET", "/api/s/"+reported, nil, nil); status != 404 {
		t.Errorf("the reported link after it was taken down: %d; want 404", status)
	}
	s.browser().must(200, "GET", "/api/s/"+other, nil, nil)
	a.must(200, "GET", "/api/admin/reports", nil, &reports)
	if len(reports) != 0 {
		t.Errorf("open reports after resolving: %+v", reports)
	}

	var users []struct {
		ID    string `json:"id"`
		Email string `json:"email"`
		Used  int64  `json:"used"`
		Links int64  `json:"links"`
	}
	a.must(200, "GET", "/api/admin/users?q=ann", nil, &users)
	if len(users) != 1 || users[0].Used != 200 || users[0].Links != 1 {
		t.Fatalf("accounts matching ann = %+v", users)
	}

	// Suspending signs the account out, keeps it out and pauses its links.
	a.must(200, "POST", "/api/admin/users/"+users[0].ID, map[string]any{"action": "suspend", "reason": "testing"}, nil)
	if status := owner.do("GET", "/api/auth/me", nil, nil); status != 401 {
		t.Errorf("a suspended account's session: %d; want 401", status)
	}
	if status := s.browser().do("POST", "/api/auth/login", map[string]any{"email": acct.email, "authKey": acct.authKey}, nil); status != 403 {
		t.Errorf("a suspended account signing in: %d; want 403", status)
	}
	if status := s.browser().do("GET", "/api/s/"+other, nil, nil); status != 404 {
		t.Errorf("a suspended account's link: %d; want 404", status)
	}
	a.must(200, "POST", "/api/admin/users/"+users[0].ID, map[string]any{"action": "unsuspend"}, nil)
	s.browser().must(200, "GET", "/api/s/"+other, nil, nil)

	a.must(200, "DELETE", "/api/admin/users/"+users[0].ID, nil, nil)
	if status := s.browser().do("GET", "/api/s/"+other, nil, nil); status != 404 {
		t.Errorf("a deleted account's link: %d; want 404", status)
	}
}

// ---------------------------------------------------------------- file requests

type fileRequest struct {
	ID     string `json:"id"`
	access []byte
}

// request makes a file request the way the web app does, with sealed blobs
// the server cannot open.
func (c *client) request(opts map[string]any) fileRequest {
	c.t.Helper()
	rq := fileRequest{access: random(32)}
	body := map[string]any{"id": randomID(20), "accessHash": sha(rq.access), "encInfo": random(120), "encSecret": random(44), "encPrivate": random(170)}
	for k, v := range opts {
		body[k] = v
	}
	c.must(201, "POST", "/api/requests", body, &rq)
	return rq
}

// offer starts an upload through a request and returns the status, the item's
// id and the token for sending its chunks.
func (c *client) offer(rq fileRequest, size int) (status int, id, token string) {
	c.t.Helper()
	id = randomID(26)
	var created struct {
		ManageToken string `json:"manageToken"`
	}
	var raw []byte
	status = c.do("POST", "/api/items", map[string]any{
		"id": id, "kind": "file", "encMeta": random(40), "size": size, "chunkSize": minChunkSize, "chunkCount": 1,
		"requestId": rq.ID, "sealedKey": random(125),
	}, &raw, "X-Request-Access", encodeB64(rq.access))
	json.Unmarshal(raw, &created)
	return status, id, created.ManageToken
}

// send uploads one whole file through a request.
func (c *client) send(rq fileRequest, data []byte) (id, token string) {
	c.t.Helper()
	status, id, token := c.offer(rq, len(data))
	if status != 201 {
		c.t.Fatalf("starting an upload through the request: %d", status)
	}
	c.must(200, "PUT", "/api/items/"+id+"/chunks/0", data, nil, "X-Manage-Token", token)
	c.must(200, "POST", "/api/items/"+id+"/complete", nil, nil, "X-Manage-Token", token)
	return id, token
}

func TestFileRequest(t *testing.T) {
	s := newServer(t, nil)
	owner := s.browser()
	owner.mustRegister("ann@example.com")
	var inbox struct {
		ID string `json:"id"`
	}
	owner.must(201, "POST", "/api/folders", map[string]any{"encName": random(40)}, &inbox)
	rq := owner.request(map[string]any{"folderId": inbox.ID})

	// Anyone with the id sees the sealed description, and nothing else.
	visitor := s.browser()
	var info map[string]any
	visitor.must(200, "GET", "/api/r/"+rq.ID, nil, &info)
	for k := range info {
		if k != "id" && k != "encInfo" && k != "maxFileSize" {
			t.Errorf("request info carries %q", k)
		}
	}
	if status := visitor.do("GET", "/api/requests", nil, nil); status != 401 {
		t.Errorf("listing requests without an account: %d; want 401", status)
	}

	// Without the token from the link, the id alone uploads nothing.
	if status, _, _ := visitor.offer(fileRequest{ID: rq.ID, access: random(32)}, 216); status != 403 {
		t.Errorf("an upload with the wrong access token: %d; want 403", status)
	}

	// A key for a folder link has no place on a plain request. Refusing it must
	// leave the server able to take the next upload.
	if status := visitor.do("POST", "/api/items", map[string]any{
		"id": randomID(26), "kind": "file", "encMeta": random(40), "size": 216, "chunkSize": minChunkSize, "chunkCount": 1,
		"requestId": rq.ID, "sealedKey": random(125), "linkKey": random(60),
	}, nil, "X-Request-Access", encodeB64(rq.access)); status != 400 {
		t.Errorf("an upload carrying a link key it has no use for: %d; want 400", status)
	}

	data := random(200)
	id, token := visitor.send(rq, data)

	// The upload token was for uploading. It reads, shares and deletes nothing.
	for _, c := range []struct {
		method, path string
		body         any
	}{
		{"GET", "/api/items/" + id + "/blob", nil},
		{"GET", "/api/items/" + id + "/status", nil},
		{"DELETE", "/api/items/" + id, nil},
		{"PATCH", "/api/items/" + id, map[string]any{"encMeta": random(40)}},
		{"POST", "/api/shares", map[string]any{"itemId": id, "wrappedKey": random(60), "accessHash": random(32)}},
		{"POST", "/api/items/" + id + "/adopt", map[string]any{"wrappedKey": random(60)}},
		{"PUT", "/api/items/" + id + "/chunks/0", data},
	} {
		if status := visitor.do(c.method, c.path, c.body, nil, "X-Manage-Token", token); status < 400 {
			t.Errorf("%s %s with a spent upload token: %d; want it refused", c.method, c.path, status)
		}
	}

	// It is in the owner's drive, in the request's folder, counted against their space.
	var drive struct {
		Items    []store.DriveItem `json:"items"`
		Requests []store.Request   `json:"requests"`
		Usage    struct{ Used int64 }
	}
	owner.must(200, "GET", "/api/drive", nil, &drive)
	if len(drive.Items) != 1 || drive.Items[0].ID != id || drive.Items[0].FolderID == nil || *drive.Items[0].FolderID != inbox.ID ||
		len(drive.Items[0].SealedKey) != 125 || drive.Usage.Used != 200 {
		t.Fatalf("the owner's drive after an upload: %+v, %d bytes used", drive.Items, drive.Usage.Used)
	}
	if len(drive.Requests) != 1 || drive.Requests[0].Received != 1 || drive.Requests[0].Bytes != 200 {
		t.Errorf("the request after an upload: %+v", drive.Requests)
	}
	var got []byte
	if status := owner.do("GET", "/api/items/"+id+"/blob", nil, &got); status != 200 || !bytes.Equal(got, data) {
		t.Errorf("the owner's download: %d, %d bytes", status, len(got))
	}

	// A request cannot be forgotten while a file's key is still sealed to it.
	if status := owner.do("DELETE", "/api/requests/"+rq.ID, nil, nil); status != 409 {
		t.Errorf("removing a request with an unfiled upload: %d; want 409", status)
	}
	stranger := s.browser()
	stranger.mustRegister("bob@example.com")
	if status := stranger.do("POST", "/api/items/"+id+"/adopt", map[string]any{"wrappedKey": random(60)}, nil); status != 404 {
		t.Errorf("someone else adopting the upload: %d; want 404", status)
	}
	if status := stranger.do("POST", "/api/requests/"+rq.ID+"/revoke", nil, nil); status != 404 {
		t.Errorf("someone else closing the request: %d; want 404", status)
	}
	owner.must(200, "POST", "/api/items/"+id+"/adopt", map[string]any{"wrappedKey": random(60)}, nil)
	drive.Items = nil // decoding reuses elements, and an adopted item has no sealedKey to overwrite the old one
	owner.must(200, "GET", "/api/drive", nil, &drive)
	if drive.Items[0].SealedKey != nil || len(drive.Items[0].WrappedKey) != 60 {
		t.Errorf("after adopting: %+v", drive.Items[0])
	}

	// Closing it stops uploads at once; what came in stays.
	owner.must(200, "POST", "/api/requests/"+rq.ID+"/revoke", nil, nil)
	if status := visitor.do("GET", "/api/r/"+rq.ID, nil, nil); status != 410 {
		t.Errorf("a closed request: %d; want 410", status)
	}
	if status, _, _ := visitor.offer(rq, 216); status != 410 {
		t.Errorf("an upload to a closed request: %d; want 410", status)
	}
	owner.must(200, "DELETE", "/api/requests/"+rq.ID, nil, nil)
	owner.must(200, "GET", "/api/drive", nil, &drive)
	if len(drive.Items) != 1 || len(drive.Requests) != 0 {
		t.Errorf("after removing the request: %d items, %d requests; want the file kept", len(drive.Items), len(drive.Requests))
	}
	if status := visitor.do("GET", "/api/r/"+rq.ID, nil, nil); status != 404 {
		t.Errorf("a removed request: %d; want 404", status)
	}
}

func TestFileRequestLimits(t *testing.T) {
	s := newServer(t, func(c *config.Config) { c.UserQuota = 2000 })
	owner := s.browser()
	owner.mustRegister("ann@example.com")
	visitor := s.browser()

	perFile := owner.request(map[string]any{"maxFileSize": 100})
	if status, _, _ := visitor.offer(perFile, 101+gcmOverhead); status != 413 {
		t.Errorf("a file over the request's size limit: %d; want 413", status)
	}
	visitor.send(perFile, random(100+gcmOverhead))

	inAll := owner.request(map[string]any{"maxBytes": 300})
	visitor.send(inAll, random(200))
	if status, _, _ := visitor.offer(inAll, 200); status != 413 {
		t.Errorf("an upload past the request's total: %d; want 413", status)
	}

	// The owner's own space bounds every request.
	open := owner.request(nil)
	if status, _, _ := visitor.offer(open, 1800); status != http.StatusInsufficientStorage {
		t.Errorf("an upload past the owner's quota: %d; want 507", status)
	}

	// An expired request takes nothing.
	past := time.Now().Unix() - 1
	err := s.app.db.CreateRequest(store.NewRequest{
		ID: "0123456789abcdefghjk", UserID: mustUserID(t, s), AccessHash: sha(open.access),
		EncInfo: random(60), EncSecret: random(44), EncPrivate: random(170), ExpiresAt: &past,
	})
	if err != nil {
		t.Fatal(err)
	}
	expired := fileRequest{ID: "0123456789abcdefghjk", access: open.access}
	if status := visitor.do("GET", "/api/r/"+expired.ID, nil, nil); status != 410 {
		t.Errorf("an expired request: %d; want 410", status)
	}
	if status, _, _ := visitor.offer(expired, 116); status != 410 {
		t.Errorf("an upload to an expired request: %d; want 410", status)
	}
}

func mustUserID(t *testing.T, s *server) string {
	t.Helper()
	accts, err := s.app.db.Accounts(store.AccountFilter{})
	if err != nil || len(accts) == 0 {
		t.Fatalf("accounts: %v, %v", accts, err)
	}
	return accts[len(accts)-1].ID
}

// Uploads racing for the last places in a request must not all get one.
func TestFileRequestConcurrentUploads(t *testing.T) {
	s := newServer(t, nil)
	owner := s.browser()
	owner.mustRegister("ann@example.com")
	rq := owner.request(map[string]any{"maxFiles": 3})

	const racers = 16
	statuses := make(chan int, racers)
	for range racers {
		go func() {
			status, _, _ := s.browser().offer(rq, 116)
			statuses <- status
		}()
	}
	admitted := 0
	for range racers {
		switch status := <-statuses; status {
		case 201:
			admitted++
		case 413:
		default:
			t.Errorf("a racing upload: %d; want 201 or 413", status)
		}
	}
	if admitted != 3 {
		t.Errorf("%d uploads were admitted to a request for 3", admitted)
	}
}

// A folder link shares a snapshot; its owner's browser can move it to a newer one.
func TestFolderLinkFollowsItsFolder(t *testing.T) {
	s := newServer(t, nil)
	owner := s.browser()
	owner.mustRegister("ann@example.com")
	first, _ := owner.upload(random(100), true)
	second, _ := owner.upload(random(100), true)
	bundle := func() string {
		id := randomID(26)
		data := random(80)
		owner.must(201, "POST", "/api/items", map[string]any{
			"id": id, "kind": "bundle", "encMeta": random(40), "wrappedKey": random(60),
			"size": len(data), "chunkSize": minChunkSize, "chunkCount": 1,
		}, nil)
		owner.must(200, "PUT", "/api/items/"+id+"/chunks/0", data, nil)
		owner.must(200, "POST", "/api/items/"+id+"/complete", nil, nil)
		return id
	}
	old := bundle()
	id, access := owner.share(old, map[string]any{"itemIds": []string{first}})

	visitor := s.browser()
	var info struct {
		Limited bool `json:"limited"`
	}
	visitor.must(200, "GET", "/api/s/"+id, nil, &info)
	if info.Limited {
		t.Error("a link without a view limit says it has one")
	}
	var opened struct {
		ItemID string `json:"itemId"`
		Ticket string `json:"ticket"`
	}
	visitor.must(200, "POST", "/api/s/"+id+"/open", map[string]any{"access": access}, &opened)
	if status := visitor.do("GET", "/api/s/"+id+"/blob?item="+second, nil, nil, "X-Ticket", opened.Ticket); status != 404 {
		t.Errorf("a file the link does not list: %d; want 404", status)
	}

	fresh := bundle()
	retarget := map[string]any{"itemId": fresh, "wrappedKey": random(60), "itemIds": []string{first, second}}
	stranger := s.browser()
	stranger.mustRegister("bob@example.com")
	if status := stranger.do("PUT", "/api/shares/"+id+"/item", retarget, nil); status < 400 {
		t.Errorf("someone else moving the link: %d; want it refused", status)
	}
	owner.must(200, "PUT", "/api/shares/"+id+"/item", retarget, nil)

	// The page that was already open keeps working, and now reaches the new file.
	visitor.must(200, "GET", "/api/s/"+id+"/blob?item="+second, nil, nil, "X-Ticket", opened.Ticket)
	var again struct {
		ItemID string `json:"itemId"`
	}
	s.browser().must(200, "POST", "/api/s/"+id+"/open", map[string]any{"access": access}, &again)
	if again.ItemID != fresh {
		t.Errorf("the link opens %s; want the new manifest %s", again.ItemID, fresh)
	}
	// The old manifest went with the move.
	if status := owner.do("GET", "/api/items/"+old+"/blob", nil, nil); status != 404 {
		t.Errorf("the old manifest: %d; want 404", status)
	}

	// A link to a plain file is not one that can be moved.
	fileLink, _ := owner.share(first, nil)
	if status := owner.do("PUT", "/api/shares/"+fileLink+"/item", retarget, nil); status != 404 {
		t.Errorf("moving a file link: %d; want 404", status)
	}
	owner.must(200, "GET", "/api/items/"+first+"/blob", nil, nil)

	limited, _ := owner.share(first, map[string]any{"maxViews": 3})
	visitor.must(200, "GET", "/api/s/"+limited, nil, &info)
	if !info.Limited {
		t.Error("a link with a view limit does not say so")
	}
}

// A folder link can let its holders add files: an upload through it lands in
// the folder and is visible to everyone with the link at once.
func TestFolderLinkThatTakesFiles(t *testing.T) {
	s := newServer(t, nil)
	owner := s.browser()
	owner.mustRegister("ann@example.com")
	var folder struct {
		ID string `json:"id"`
	}
	owner.must(201, "POST", "/api/folders", map[string]any{"encName": random(40)}, &folder)
	manifest := randomID(26)
	owner.must(201, "POST", "/api/items", map[string]any{
		"id": manifest, "kind": "bundle", "encMeta": random(40), "wrappedKey": random(60),
		"size": 80, "chunkSize": minChunkSize, "chunkCount": 1,
	}, nil)
	owner.must(200, "PUT", "/api/items/"+manifest+"/chunks/0", random(80), nil)
	owner.must(200, "POST", "/api/items/"+manifest+"/complete", nil, nil)
	link, access := owner.share(manifest, map[string]any{"itemIds": []string{}})
	rq := owner.request(map[string]any{"folderId": folder.ID, "shareId": link})

	// Its request is not an upload page of its own, and nobody else can attach one to the link.
	if status := s.browser().do("GET", "/api/r/"+rq.ID, nil, nil); status != 404 {
		t.Errorf("the request behind a link, as a page: %d; want 404", status)
	}
	stranger := s.browser()
	stranger.mustRegister("bob@example.com")
	var theirs struct {
		ID string `json:"id"`
	}
	stranger.must(201, "POST", "/api/folders", map[string]any{"encName": random(40)}, &theirs)
	if status := stranger.do("POST", "/api/requests", map[string]any{
		"id": randomID(20), "accessHash": random(32), "encInfo": random(120), "encSecret": random(44), "encPrivate": random(170),
		"folderId": theirs.ID, "shareId": link,
	}, nil); status != 404 {
		t.Errorf("attaching a request to someone else's link: %d; want 404", status)
	}

	add := func(c *client, data []byte) (int, string) {
		id := randomID(26)
		var created struct {
			ManageToken string `json:"manageToken"`
		}
		var raw []byte
		status := c.do("POST", "/api/items", map[string]any{
			"id": id, "kind": "file", "encMeta": random(40), "size": len(data), "chunkSize": minChunkSize, "chunkCount": 1,
			"requestId": rq.ID, "sealedKey": random(125), "linkKey": random(60),
		}, &raw, "X-Request-Access", encodeB64(rq.access))
		if status != 201 {
			return status, id
		}
		json.Unmarshal(raw, &created)
		c.must(200, "PUT", "/api/items/"+id+"/chunks/0", data, nil, "X-Manage-Token", created.ManageToken)
		c.must(200, "POST", "/api/items/"+id+"/complete", nil, nil, "X-Manage-Token", created.ManageToken)
		return status, id
	}
	guest := s.browser()
	data := random(300)
	status, added := add(guest, data)
	if status != 201 {
		t.Fatalf("adding through the link: %d", status)
	}

	// Another holder of the link sees it and can download it; without opening the link, nobody can.
	if status := s.browser().do("GET", "/api/s/"+link+"/added", nil, nil); status != 403 {
		t.Errorf("listing what was added without a ticket: %d; want 403", status)
	}
	other := s.browser()
	var opened struct {
		Ticket string `json:"ticket"`
	}
	other.must(200, "POST", "/api/s/"+link+"/open", map[string]any{"access": access}, &opened)
	var list []store.AddedItem
	other.must(200, "GET", "/api/s/"+link+"/added", nil, &list, "X-Ticket", opened.Ticket)
	if len(list) != 1 || list[0].ID != added || len(list[0].LinkKey) != 60 {
		t.Fatalf("added through the link: %+v", list)
	}
	var got []byte
	if status := other.do("GET", "/api/s/"+link+"/blob?item="+added, nil, &got, "X-Ticket", opened.Ticket); status != 200 || !bytes.Equal(got, data) {
		t.Errorf("downloading what was added: %d, %d bytes", status, len(got))
	}

	// It is in the owner's folder.
	var drive struct {
		Items []store.DriveItem `json:"items"`
	}
	owner.must(200, "GET", "/api/drive", nil, &drive)
	inFolder := 0
	for _, it := range drive.Items {
		if it.ID == added && it.FolderID != nil && *it.FolderID == folder.ID {
			inFolder++
		}
	}
	if inFolder != 1 {
		t.Errorf("the added file is not in the owner's folder: %+v", drive.Items)
	}

	// Once the link is revoked, it takes nothing more.
	owner.must(200, "DELETE", "/api/shares/"+link, nil, nil)
	if status, _ := add(guest, data); status != 410 {
		t.Errorf("adding through a revoked link: %d; want 410", status)
	}
}

func TestSessions(t *testing.T) {
	s := newServer(t, nil)
	here := s.browser()
	acct := here.mustRegister("ann@example.com")
	there := s.browser()
	there.must(200, "POST", "/api/auth/login", map[string]any{"email": acct.email, "authKey": acct.authKey}, nil, "User-Agent", "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0")
	third := s.browser()
	third.must(200, "POST", "/api/auth/login", map[string]any{"email": acct.email, "authKey": acct.authKey}, nil)

	var list []store.Session
	here.must(200, "GET", "/api/auth/sessions", nil, &list)
	if len(list) != 3 || !list[0].Current || list[1].Current || list[2].Current {
		t.Fatalf("sessions = %+v; want three, this one first", list)
	}
	var other store.Session
	for _, se := range list {
		if se.UserAgent == "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0" {
			other = se
		}
	}
	if other.ID == "" {
		t.Fatalf("no session carries the other browser's user agent: %+v", list)
	}

	if status := here.do("DELETE", "/api/auth/sessions/"+list[0].ID, nil, nil); status != 400 {
		t.Errorf("ending the current session this way: %d; want 400", status)
	}
	stranger := s.browser()
	stranger.mustRegister("bob@example.com")
	if status := stranger.do("DELETE", "/api/auth/sessions/"+other.ID, nil, nil); status != 404 {
		t.Errorf("ending someone else's session: %d; want 404", status)
	}

	here.must(200, "DELETE", "/api/auth/sessions/"+other.ID, nil, nil)
	if status := there.do("GET", "/api/auth/me", nil, nil); status != 401 {
		t.Errorf("the browser that was signed out: %d; want 401", status)
	}
	third.must(200, "GET", "/api/auth/me", nil, nil)

	here.must(200, "POST", "/api/auth/sessions/end-others", nil, nil)
	if status := third.do("GET", "/api/auth/me", nil, nil); status != 401 {
		t.Errorf("another browser after signing out everywhere else: %d; want 401", status)
	}
	here.must(200, "GET", "/api/auth/sessions", nil, &list)
	if len(list) != 1 || !list[0].Current {
		t.Errorf("sessions left = %+v; want only this one", list)
	}
}

func TestTrialRequest(t *testing.T) {
	s := newServer(t, nil)
	c := s.browser()
	if status := c.do("POST", "/api/trial", map[string]any{"email": "not an address"}, nil); status != 400 {
		t.Errorf("a trial request without a real address: %d; want 400", status)
	}
	c.must(201, "POST", "/api/trial", map[string]any{"email": "Guest@Example.com", "lang": "de"}, nil)
	c.must(201, "POST", "/api/trial", map[string]any{"email": "guest@example.com"}, nil) // asking twice is fine

	if status := c.do("GET", "/api/admin/trials", nil, nil); status != 404 {
		t.Errorf("the list of trial requests on the public site: %d; want 404", status)
	}
	a := s.signedInAdmin()
	var trials []store.TrialRequest
	a.must(200, "GET", "/api/admin/trials", nil, &trials)
	if len(trials) != 1 || trials[0].Email != "guest@example.com" || trials[0].Lang != "de" || trials[0].InvitedAt != nil {
		t.Fatalf("trial requests = %+v", trials)
	}
	a.must(201, "POST", "/api/admin/invites", map[string]any{"email": "guest@example.com", "compQuota": int64(5 << 30)}, nil)
	trials = nil
	a.must(200, "GET", "/api/admin/trials", nil, &trials)
	if len(trials) != 1 || trials[0].InvitedAt == nil {
		t.Errorf("after inviting: %+v; want it marked as answered", trials)
	}
}

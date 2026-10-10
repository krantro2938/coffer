package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"coffer/internal/mail"
	"coffer/internal/paddle"
	"coffer/internal/store"
)

// The admin console. It is a second HTTP server in the same process, on its
// own port and meant for its own hostname, so nothing here is reachable from
// the public site. An admin sees accounts, sizes and reports, never names,
// keys or contents: those are not on the server to be seen.

const (
	adminCookie     = "coffer_admin"
	adminSessionTTL = 12 * time.Hour
	inviteTTL       = 14 * 24 * time.Hour
)

type adminSessions struct {
	mu sync.Mutex
	m  map[string]time.Time
}

func (s *adminSessions) start() string {
	tok := randomToken()
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, exp := range s.m {
		if time.Now().After(exp) {
			delete(s.m, k)
		}
	}
	s.m[string(sha([]byte(tok)))] = time.Now().Add(adminSessionTTL)
	return tok
}

func (s *adminSessions) valid(tok string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	exp, ok := s.m[string(sha([]byte(tok)))]
	return ok && time.Now().Before(exp)
}

func (s *adminSessions) end(tok string) {
	s.mu.Lock()
	delete(s.m, string(sha([]byte(tok))))
	s.mu.Unlock()
}

func (a *App) adminRoutes() http.Handler {
	mux := http.NewServeMux()
	open := func(pattern string, fn handler) { mux.Handle(pattern, fn) }
	h := func(pattern string, fn handler) {
		mux.Handle(pattern, handler(func(w http.ResponseWriter, r *http.Request) error {
			c, err := r.Cookie(adminCookie)
			if err != nil || !a.admins.valid(c.Value) {
				return errUnauthorized
			}
			return fn(w, r)
		}))
	}

	open("POST /api/admin/login", a.handleAdminLogin)
	open("GET /api/admin/session", func(w http.ResponseWriter, r *http.Request) error {
		c, err := r.Cookie(adminCookie)
		writeJSON(w, 200, map[string]bool{"signedIn": err == nil && a.admins.valid(c.Value)})
		return nil
	})
	open("GET /api/config", a.handleConfig)
	h("POST /api/admin/logout", a.handleAdminLogout)
	h("GET /api/admin/overview", a.handleAdminOverview)
	h("GET /api/admin/users", a.handleAdminUsers)
	h("GET /api/admin/users/{id}", a.handleAdminUser)
	h("POST /api/admin/users/{id}", a.handleAdminUpdateUser)
	h("DELETE /api/admin/users/{id}", a.handleAdminDeleteUser)
	h("GET /api/admin/invites", a.handleAdminInvites)
	h("POST /api/admin/invites", a.handleAdminInvite)
	h("DELETE /api/admin/invites/{id}", a.handleAdminRevokeInvite)
	h("GET /api/admin/reports", a.handleAdminReports)
	h("POST /api/admin/reports/{id}", a.handleAdminResolveReport)
	h("GET /api/admin/trials", a.handleAdminTrials)
	h("GET /api/admin/log", a.handleAdminLog)

	mux.Handle("/api/", handler(func(w http.ResponseWriter, r *http.Request) error { return errNotFound }))
	if a.static != nil {
		mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/" {
				http.Redirect(w, r, "/admin", http.StatusFound)
				return
			}
			a.static.ServeHTTP(w, r)
		}))
	}
	return a.securityHeaders(a.csrf(mux))
}

func (a *App) handleAdminLogin(w http.ResponseWriter, r *http.Request) error {
	ip := clientIP(r, a.cfg.TrustProxy)
	if a.adminLimit.Blocked(ip) {
		return errf(http.StatusTooManyRequests, "too many attempts, try again later")
	}
	var req struct {
		Token string `json:"token"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	if !equal(sha([]byte(req.Token)), sha([]byte(a.cfg.AdminToken))) {
		a.adminLimit.Allow(ip)
		return errf(http.StatusUnauthorized, "that token is not right")
	}
	http.SetCookie(w, &http.Cookie{
		Name: adminCookie, Value: a.admins.start(), Path: "/api/admin/", MaxAge: int(adminSessionTTL.Seconds()),
		HttpOnly: true, Secure: a.isSecure(r), SameSite: http.SameSiteStrictMode,
	})
	a.db.Audit("sign in", ip, nil)
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

func (a *App) handleAdminLogout(w http.ResponseWriter, r *http.Request) error {
	if c, err := r.Cookie(adminCookie); err == nil {
		a.admins.end(c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: adminCookie, Path: "/api/admin/", MaxAge: -1, HttpOnly: true, Secure: a.isSecure(r), SameSite: http.SameSiteStrictMode})
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

func (a *App) handleAdminOverview(w http.ResponseWriter, r *http.Request) error {
	o, err := a.db.Overview()
	if err != nil {
		return err
	}
	out := map[string]any{"billing": a.billing != nil, "byPlan": o.ByPlan}
	for k, n := range o.Counts {
		out[k] = n
	}
	// What the listed plans bring in each month; personal prices are not included.
	var cents int64
	for id, n := range o.ByPlan {
		if pl := paddle.PlanByID(id); pl != nil {
			cents += n * int64(pl.Cents)
		}
	}
	out["listMonthlyCents"] = cents
	writeJSON(w, 200, out)
	return nil
}

type adminUser struct {
	ID            string  `json:"id"`
	Email         string  `json:"email"`
	CreatedAt     int64   `json:"createdAt"`
	Verified      bool    `json:"verified"`
	Google        bool    `json:"google"`
	Plan          *string `json:"plan"`
	Status        *string `json:"status"`
	PeriodEnd     *int64  `json:"periodEnd"`
	CancelAt      *int64  `json:"cancelAt"`
	LapsedAt      *int64  `json:"lapsedAt"`
	CompQuota     *int64  `json:"compQuota"`
	CompUntil     *int64  `json:"compUntil"`
	Offer         *offer  `json:"offer"`
	SuspendedAt   *int64  `json:"suspendedAt"`
	SuspendReason *string `json:"suspendReason"`
	Note          *string `json:"note"`
	Quota         int64   `json:"quota"` // what they may store right now
	Used          int64   `json:"used"`
	Files         int64   `json:"files"`
	Links         int64   `json:"links"`
	Covered       bool    `json:"covered"`
	Customer      *string `json:"customerId,omitempty"`
	Subscription  *string `json:"subscriptionId,omitempty"`
	LastSeen      *int64  `json:"lastSeen,omitempty"`
}

func nullString(p *string) sql.NullString {
	if p == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *p, Valid: true}
}

func nullInt64(p *int64) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: *p, Valid: true}
}

// adminView works out what an account may store right now from its row.
func adminView(acct *store.Account) *adminUser {
	u := &adminUser{
		ID: acct.ID, Email: acct.Email, CreatedAt: acct.CreatedAt, Verified: acct.Verified, Google: acct.Google,
		Plan: acct.Plan, Status: acct.Status, PeriodEnd: acct.PeriodEnd, CancelAt: acct.CancelAt, LapsedAt: acct.LapsedAt,
		CompQuota: acct.CompQuota, CompUntil: acct.CompUntil, SuspendedAt: acct.SuspendedAt, SuspendReason: acct.SuspendReason,
		Note: acct.Note, Used: acct.Used, Files: acct.Files, Links: acct.Links,
		Customer: acct.CustomerID, Subscription: acct.SubID, LastSeen: acct.LastSeen,
	}
	if acct.Offer != nil {
		var o offer
		if json.Unmarshal([]byte(*acct.Offer), &o) == nil {
			u.Offer = &o
		}
	}
	s := subState{Standing: store.Standing{
		Plan: nullString(acct.Plan), Status: nullString(acct.Status), Quota: acct.Quota, Suspended: acct.SuspendedAt != nil,
		CompQuota: nullInt64(acct.CompQuota), CompUntil: nullInt64(acct.CompUntil),
	}}
	u.Quota, u.Covered = s.allowance(), s.covered()
	return u
}

func (a *App) handleAdminUsers(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	accts, err := a.db.Accounts(store.AccountFilter{Email: strings.TrimSpace(q.Get("q")), Only: q.Get("filter")})
	if err != nil {
		return err
	}
	users := make([]*adminUser, 0, len(accts))
	for _, acct := range accts {
		users = append(users, adminView(acct))
	}
	writeJSON(w, 200, users)
	return nil
}

func (a *App) adminUser(id string) (*adminUser, error) {
	acct, err := a.db.Account(id)
	if errors.Is(err, store.ErrNotFound) {
		return nil, errNotFound
	} else if err != nil {
		return nil, err
	}
	return adminView(acct), nil
}

func (a *App) handleAdminUser(w http.ResponseWriter, r *http.Request) error {
	u, err := a.adminUser(r.PathValue("id"))
	if err != nil {
		return err
	}
	writeJSON(w, 200, u)
	return nil
}

// terms are what an admin can set on an account or promise in an invitation.
type terms struct {
	// Complimentary storage, with an optional end date (unix seconds; 0 for none).
	CompQuota *int64 `json:"compQuota"`
	CompUntil *int64 `json:"compUntil"`
	// A personal price to be bought through the checkout.
	Offer *offer `json:"offer"`
}

func (t *terms) check(billing bool) error {
	if t.CompQuota != nil && (*t.CompQuota < 1<<30 || *t.CompQuota > 100<<40) {
		return errf(http.StatusBadRequest, "storage must be between 1 GB and 100 TB")
	}
	if t.CompUntil != nil && *t.CompUntil != 0 && *t.CompUntil <= now() {
		return errf(http.StatusBadRequest, "the end date must be in the future")
	}
	if t.Offer != nil && (!billing || !t.Offer.valid()) {
		return errf(http.StatusBadRequest, "that price is not valid")
	}
	return nil
}

// columns is the terms as the database holds them.
func (t *terms) columns() store.Terms {
	var c store.Terms
	if t.CompQuota != nil {
		c.CompQuota = t.CompQuota
		if t.CompUntil != nil && *t.CompUntil != 0 {
			c.CompUntil = t.CompUntil
		}
	}
	if t.Offer != nil {
		b, _ := json.Marshal(t.Offer)
		o := string(b)
		c.Offer = &o
	}
	return c
}

// handleAdminUpdateUser applies one action to an account.
func (a *App) handleAdminUpdateUser(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("id")
	var req struct {
		Action string  `json:"action"`
		Reason string  `json:"reason"`
		Note   *string `json:"note"`
		terms
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	u, err := a.adminUser(id)
	if err != nil {
		return err
	}
	switch req.Action {
	case "terms":
		// Replaces the allowance and the personal price with what was sent.
		if err := req.terms.check(a.billing != nil); err != nil {
			return err
		}
		err = a.db.SetTerms(id, req.terms.columns())
		a.db.Audit("set terms", u.Email, req.terms)
	case "suspend":
		reason := strings.TrimSpace(req.Reason)
		if reason == "" || len(reason) > 500 {
			return errf(http.StatusBadRequest, "say why, in up to 500 characters")
		}
		// Signed out everywhere; their links stop opening at once.
		err = a.db.Suspend(id, reason, false)
		a.db.Audit("suspend", u.Email, reason)
	case "unsuspend":
		err = a.db.Unsuspend(id)
		a.db.Audit("lift suspension", u.Email, nil)
	case "note":
		if req.Note == nil || len(*req.Note) > 2000 {
			return errf(http.StatusBadRequest, "notes can be up to 2000 characters")
		}
		err = a.db.SetNote(id, strings.TrimSpace(*req.Note))
	case "verify":
		err = a.db.MarkVerified(id)
		a.db.Audit("mark email confirmed", u.Email, nil)
	case "sign-out":
		err = a.db.DeleteSessions(id)
		a.db.Audit("sign out everywhere", u.Email, nil)
	case "sync":
		if a.billing == nil {
			return errf(http.StatusBadRequest, "billing is off on this server")
		}
		err = a.syncBilling(r.Context(), id)
	default:
		return errf(http.StatusBadRequest, "unknown action")
	}
	if err != nil {
		return err
	}
	u, err = a.adminUser(id)
	if err != nil {
		return err
	}
	writeJSON(w, 200, u)
	return nil
}

// handleAdminDeleteUser removes an account and everything it stored, ending
// its plan first so it is never charged again.
func (a *App) handleAdminDeleteUser(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("id")
	u, err := a.adminUser(id)
	if err != nil {
		return err
	}
	if a.billing != nil {
		if err := a.cancelSub(r.Context(), id); err != nil {
			log.Printf("billing: cancel for deleted account: %v", err)
			return errf(http.StatusBadGateway, "the plan could not be cancelled, so nothing was deleted; try again shortly")
		}
	}
	ids, err := a.db.UserItemIDs(id)
	if err != nil {
		return err
	}
	if err := a.db.DeleteUser(id); err != nil {
		return err
	}
	a.removeBlobs(ids)
	a.db.Audit("delete account", u.Email, map[string]any{"files": u.Files, "bytes": u.Used})
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

// ---------------------------------------------------------------- invitations

func inviteMessage(link string, t *terms, note string) mail.Message {
	body := "You have been invited to open a private, end-to-end encrypted drive on Coffer."
	switch {
	case t.CompQuota != nil && t.CompUntil != nil && *t.CompUntil != 0:
		body += "\nIt comes with " + strconv.FormatInt(*t.CompQuota>>30, 10) + " GB at no charge until " +
			time.Unix(*t.CompUntil, 0).UTC().Format("2 January 2006") + "."
	case t.CompQuota != nil:
		body += "\nIt comes with " + strconv.FormatInt(*t.CompQuota>>30, 10) + " GB at no charge."
	case t.Offer != nil:
		body += "\nYour plan: " + strconv.FormatInt(t.Offer.Quota>>30, 10) + " GB for €" +
			strconv.FormatFloat(float64(t.Offer.Cents)/100, 'f', 2, 64) + " a " + t.Offer.Interval
		if t.Offer.TrialDays > 0 {
			body += ", free for the first " + strconv.Itoa(t.Offer.TrialDays) + " days"
		}
		body += "."
	}
	if note != "" {
		body += "\n\n" + note
	}
	body += "\n\nYou choose the password yourself, and it never leaves your device."
	return mail.Message{
		Subject:   "Your Coffer drive is waiting",
		Heading:   "You're invited",
		Body:      body,
		Link:      link,
		LinkLabel: "Set your password",
		Footer:    "This invitation is for you alone and works for 14 days. If you weren't expecting it, ignore this email.",
	}
}

func (a *App) handleAdminInvite(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		Email string `json:"email"`
		Note  string `json:"note"`
		terms
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	email := normEmail(req.Email)
	if len(email) > 254 || !emailRe.MatchString(email) || len(req.Note) > 1000 {
		return errf(http.StatusBadRequest, "please enter a valid email address")
	}
	if err := req.terms.check(a.billing != nil); err != nil {
		return err
	}
	if exists, err := a.db.VerifiedUserExists(email); err != nil {
		return err
	} else if exists {
		return errf(http.StatusConflict, "an account with this email already exists; set its terms instead")
	}
	token := randomToken()
	// One live invitation per address: a new one replaces the old.
	if err := a.db.CreateInvite(sha([]byte(token)), email, req.terms.columns(), strings.TrimSpace(req.Note)); err != nil {
		return err
	}
	link := a.cfg.PublicURL + "/register?invite=" + token
	sent := false
	if a.mail != nil && a.cfg.PublicURL != "" {
		if err := a.mail.Send(r.Context(), email, inviteMessage(link, &req.terms, strings.TrimSpace(req.Note))); err != nil {
			log.Printf("mail: invite: %v", err)
		} else {
			sent = true
		}
	}
	if err := a.db.MarkTrialInvited(email); err != nil {
		log.Printf("admin: trial request: %v", err)
	}
	a.db.Audit("invite", email, req.terms)
	// The link is shown once, for when email is off or did not go out.
	writeJSON(w, 201, map[string]any{"link": link, "emailed": sent})
	return nil
}

func (a *App) handleAdminInvites(w http.ResponseWriter, r *http.Request) error {
	invites, err := a.db.Invites()
	if err != nil {
		return err
	}
	out := []map[string]any{}
	for _, i := range invites {
		inv := map[string]any{
			"id": i.ID, "email": i.Email, "createdAt": i.CreatedAt, "expiresAt": i.CreatedAt + int64(inviteTTL.Seconds()), "note": i.Note.String,
		}
		if i.CompQuota.Valid {
			inv["compQuota"] = i.CompQuota.Int64
		}
		if i.CompUntil.Valid {
			inv["compUntil"] = i.CompUntil.Int64
		}
		if i.Offer.Valid {
			inv["offer"] = json.RawMessage(i.Offer.String)
		}
		if i.UsedAt.Valid {
			inv["usedAt"] = i.UsedAt.Int64
		}
		out = append(out, inv)
	}
	writeJSON(w, 200, out)
	return nil
}

func (a *App) handleAdminRevokeInvite(w http.ResponseWriter, r *http.Request) error {
	err := a.db.RevokeInvite(strings.ToUpper(r.PathValue("id")))
	if errors.Is(err, store.ErrNotFound) {
		return errNotFound
	} else if err != nil {
		return err
	}
	a.db.Audit("revoke invitation", "", nil)
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

// invite looks up a live invitation by the token in its link.
func (a *App) invite(token string) (*store.Invite, error) {
	inv, err := a.db.LiveInvite(sha([]byte(token)), now()-int64(inviteTTL.Seconds()))
	if errors.Is(err, store.ErrNotFound) {
		return nil, errf(http.StatusNotFound, "this invitation has expired or was already used")
	}
	return inv, err
}

// handleInvite tells the sign-up page who an invitation is for (public site).
func (a *App) handleInvite(w http.ResponseWriter, r *http.Request) error {
	if !a.shareOpenLimit.Allow(clientIP(r, a.cfg.TrustProxy)) {
		return errf(http.StatusTooManyRequests, "too many attempts, try again later")
	}
	inv, err := a.invite(r.PathValue("token"))
	if err != nil {
		return err
	}
	// What it comes with, so the sign-up page does not talk about prices to someone who was given a drive.
	resp := map[string]any{"email": inv.Email, "offer": inv.Offer.Valid}
	if inv.CompQuota.Valid {
		resp["compQuota"] = inv.CompQuota.Int64
		if inv.CompUntil.Valid {
			resp["compUntil"] = inv.CompUntil.Int64
		}
	}
	writeJSON(w, 200, resp)
	return nil
}

// -------------------------------------------------------------------- reports

var reportReasons = map[string]bool{"malware": true, "phishing": true, "illegal": true, "copyright": true, "harassment": true, "other": true}

// handleReport files an abuse report against a share link (public site). We
// cannot look inside a link ourselves, so the reporter may hand over its key.
func (a *App) handleReport(w http.ResponseWriter, r *http.Request) error {
	id := normalizeShareID(r.PathValue("id"))
	if !shareIDRe.MatchString(id) {
		return errNotFound
	}
	if !a.reportLimit.Allow(clientIP(r, a.cfg.TrustProxy)) {
		return errf(http.StatusTooManyRequests, "too many reports from this network, try again later")
	}
	var req struct {
		Reason  string `json:"reason"`
		Details string `json:"details"`
		Contact string `json:"contact"`
		Secret  string `json:"secret"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	req.Details, req.Contact = strings.TrimSpace(req.Details), strings.TrimSpace(req.Contact)
	if !reportReasons[req.Reason] || len(req.Details) < 10 || len(req.Details) > 4000 || len(req.Contact) > 254 || len(req.Secret) > 64 {
		return errf(http.StatusBadRequest, "please describe the problem in a sentence or two")
	}
	itemID, owner, err := a.db.ShareTarget(id)
	if errors.Is(err, store.ErrNotFound) {
		return errShareGone
	} else if err != nil {
		return err
	}
	if err := a.db.CreateReport(store.NewReport{
		ID: randomID(12), ShareID: id, ItemID: itemID, Owner: owner,
		Reason: req.Reason, Details: req.Details, Contact: req.Contact, Secret: req.Secret,
	}); err != nil {
		return err
	}
	if a.mail != nil && a.cfg.AdminNotify != "" {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if err := a.mail.Send(ctx, a.cfg.AdminNotify, mail.Message{
				Subject: "Coffer: new abuse report (" + req.Reason + ")",
				Heading: "A link was reported",
				Body:    "Link " + id + " was reported for: " + req.Reason + ".\n\n" + req.Details,
				Footer:  "Review it in the admin console.",
			}); err != nil {
				log.Printf("mail: report notice: %v", err)
			}
		}()
	}
	writeJSON(w, 201, map[string]bool{"ok": true})
	return nil
}

func (a *App) handleAdminReports(w http.ResponseWriter, r *http.Request) error {
	reports, err := a.db.Reports(r.URL.Query().Get("status") == "resolved")
	if err != nil {
		return err
	}
	out := []map[string]any{}
	for _, rp := range reports {
		rep := map[string]any{
			"id": rp.ID, "shareId": rp.ShareID, "reason": rp.Reason, "details": rp.Details, "status": rp.Status, "createdAt": rp.CreatedAt,
			"linkLive": rp.LinkLive, "contact": rp.Contact.String, "resolution": rp.Resolution.String,
		}
		if rp.Owner.Valid {
			rep["ownerId"], rep["ownerEmail"], rep["ownerReports"] = rp.Owner.String, rp.OwnerEmail.String, rp.OwnerReports
		}
		// With the key the reporter handed over, the reviewer can open the link like any recipient.
		if rp.Secret.Valid && a.cfg.PublicURL != "" {
			rep["reviewUrl"] = a.cfg.PublicURL + "/s/" + rp.ShareID + "#" + rp.Secret.String
		}
		if rp.ResolvedAt.Valid {
			rep["resolvedAt"] = rp.ResolvedAt.Int64
		}
		out = append(out, rep)
	}
	writeJSON(w, 200, out)
	return nil
}

// handleAdminResolveReport closes a report: dismiss it, take the link down,
// delete the file behind it, or suspend whoever shared it.
func (a *App) handleAdminResolveReport(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		Action string `json:"action"`
		Note   string `json:"note"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	share, itemID, owner, err := a.db.ReportTarget(r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		return errNotFound
	} else if err != nil {
		return err
	}
	removeLink := func() error {
		err := a.db.DeleteShare(share)
		a.tickets.revokeShare(share)
		return err
	}
	switch req.Action {
	case "dismiss":
	case "remove-link":
		err = removeLink()
	case "delete-file":
		// For a quick share that is every file uploaded with it.
		var ids []string
		if owner.Valid {
			ids = []string{itemID.String}
			listed, err := a.db.ShareItemIDs(share)
			if err != nil {
				return err
			}
			ids = append(ids, listed...)
		} else if ids, err = a.db.QuickShareSiblingIDs(itemID.String); err != nil {
			return err
		}
		if err = removeLink(); err == nil {
			for _, id := range ids {
				if err = a.db.DeleteItem(id); err != nil {
					return err
				}
			}
			a.removeBlobs(ids)
		}
	case "suspend":
		if !owner.Valid {
			return errf(http.StatusBadRequest, "this was shared without an account; delete the file instead")
		}
		err = a.db.Suspend(owner.String, "abuse report "+r.PathValue("id"), true)
	default:
		return errf(http.StatusBadRequest, "unknown action")
	}
	if err != nil {
		return err
	}
	resolution := req.Action
	if note := strings.TrimSpace(req.Note); note != "" {
		resolution += ": " + note
	}
	status := "actioned"
	if req.Action == "dismiss" {
		status = "dismissed"
	}
	if err := a.db.ResolveReport(r.PathValue("id"), status, resolution); err != nil {
		return err
	}
	a.db.Audit("report: "+req.Action, share, req.Note)
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

func (a *App) handleAdminLog(w http.ResponseWriter, r *http.Request) error {
	entries, err := a.db.AuditLog()
	if err != nil {
		return err
	}
	writeJSON(w, 200, entries)
	return nil
}

// ------------------------------------------------------------- trial requests

// handleTrialRequest takes an email address from someone who would like to
// try a drive before paying (public site). It says the same thing whatever
// the address, so it cannot be used to learn who has an account.
func (a *App) handleTrialRequest(w http.ResponseWriter, r *http.Request) error {
	if !a.trialLimit.Allow(clientIP(r, a.cfg.TrustProxy)) {
		return errf(http.StatusTooManyRequests, "too many attempts, try again later")
	}
	var req struct {
		Email string `json:"email"`
		Lang  string `json:"lang"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	email := normEmail(req.Email)
	if len(email) > 254 || !emailRe.MatchString(email) {
		return errf(http.StatusBadRequest, "please enter a valid email address")
	}
	if len(req.Lang) > 8 {
		req.Lang = ""
	}
	fresh, err := a.db.AddTrialRequest(email, req.Lang)
	if err != nil {
		return err
	}
	if fresh && a.mail != nil && a.cfg.AdminNotify != "" {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if err := a.mail.Send(ctx, a.cfg.AdminNotify, mail.Message{
				Subject: "Coffer: someone asked for a trial",
				Heading: "A trial was requested",
				Body:    email + " would like to try a drive.",
				Footer:  "Invite them from the admin console.",
			}); err != nil {
				log.Printf("mail: trial notice: %v", err)
			}
		}()
	}
	writeJSON(w, 201, map[string]bool{"ok": true})
	return nil
}

func (a *App) handleAdminTrials(w http.ResponseWriter, r *http.Request) error {
	trials, err := a.db.TrialRequests()
	if err != nil {
		return err
	}
	writeJSON(w, 200, trials)
	return nil
}

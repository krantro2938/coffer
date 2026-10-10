package app

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"time"

	"coffer/internal/mail"
	"coffer/internal/store"
)

// Proving an email address. A new account gets a six-digit code by email, or
// skips that by signing up through Google, which has already checked the
// address. Either way the encryption password is still chosen, and kept, by
// the user alone: Google identifies an account, it never unlocks a drive.

const (
	otpTTL      = 10 * time.Minute
	otpMaxTries = 5
	otpCooldown = 60 * time.Second
)

func (a *App) otpHash(uid, code string) []byte {
	return hmacSHA(a.secret, []byte("otp:"+uid+":"+code))
}

// sendCode issues a fresh code, replacing any earlier one.
func (a *App) sendCode(ctx context.Context, uid, email, lang string) error {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return err
	}
	code := fmt.Sprintf("%06d", n.Int64())
	if err := a.db.SetCode(uid, a.otpHash(uid, code), time.Now().Add(otpTTL).Unix()); err != nil {
		return err
	}
	return a.mail.Send(ctx, email, mail.CodeMessage(lang, code))
}

func (a *App) handleVerify(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := readJSON(w, r, &req); err != nil {
		return err
	}
	defer a.locks.lock("otp:" + uid)()
	code, err := a.db.Code(uid)
	if err != nil {
		return err
	}
	if code.Verified {
		return a.writeMe(w, uid)
	}
	if code.Hash == nil || code.Expires.Int64 <= now() || code.Tries >= otpMaxTries {
		return errf(http.StatusGone, "that code has expired, request a new one")
	}
	if !equal(a.otpHash(uid, strings.TrimSpace(req.Code)), code.Hash) {
		if err := a.db.CountCodeTry(uid); err != nil {
			return err
		}
		return errf(http.StatusUnauthorized, "that code is not right")
	}
	if err := a.db.MarkVerified(uid); err != nil {
		return err
	}
	return a.writeMe(w, uid)
}

func (a *App) handleResendCode(w http.ResponseWriter, r *http.Request) error {
	uid, err := a.requireUser(r)
	if err != nil {
		return err
	}
	to, err := a.db.CodeRecipient(uid)
	if err != nil {
		return err
	}
	if to.Verified || a.mail == nil {
		return errf(http.StatusConflict, "this email is already confirmed")
	}
	if now()-to.SentAt.Int64 < int64(otpCooldown.Seconds()) || !a.mailLimit.Allow(uid) {
		return errf(http.StatusTooManyRequests, "wait a minute before asking for another code")
	}
	if err := a.sendCode(r.Context(), uid, to.Email, to.Lang.String); err != nil {
		log.Printf("mail: code: %v", err)
		return errf(http.StatusBadGateway, "the code could not be sent, try again shortly")
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

// ---------------------------------------------------------------- Google

const (
	oauthStateCookie = "coffer_oauth"
	googleCookie     = "coffer_google"
	googleTicketTTL  = 15 * time.Minute
)

// googleTicket is proof, held in a signed cookie, that the browser just
// signed in to Google with this address and has no Coffer account yet.
type googleTicket struct {
	Email string `json:"email"`
	Sub   string `json:"sub"`
	Exp   int64  `json:"exp"`
}

func (a *App) signTicket(t googleTicket) string {
	b, _ := json.Marshal(t)
	body := base64.RawURLEncoding.EncodeToString(b)
	return body + "." + hex.EncodeToString(hmacSHA(a.secret, []byte("google:"+body)))
}

func (a *App) readTicket(r *http.Request) *googleTicket {
	c, err := r.Cookie(googleCookie)
	if err != nil {
		return nil
	}
	body, sig, ok := strings.Cut(c.Value, ".")
	got, _ := hex.DecodeString(sig)
	if !ok || !equal(got, hmacSHA(a.secret, []byte("google:"+body))) {
		return nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(body)
	var t googleTicket
	if err != nil || json.Unmarshal(raw, &t) != nil || t.Exp <= now() {
		return nil
	}
	return &t
}

func (a *App) authCookie(r *http.Request, name, value string, ttl time.Duration) *http.Cookie {
	c := &http.Cookie{
		Name: name, Value: value, Path: "/api/auth/", MaxAge: int(ttl.Seconds()),
		// Lax: these are set and read around a top-level redirect to Google and back.
		HttpOnly: true, Secure: a.isSecure(r), SameSite: http.SameSiteLaxMode,
	}
	if value == "" {
		c.MaxAge = -1
	}
	return c
}

func (a *App) origin(r *http.Request) string {
	if a.cfg.PublicURL != "" {
		return a.cfg.PublicURL
	}
	if a.isSecure(r) {
		return "https://" + r.Host
	}
	return "http://" + r.Host
}

func (a *App) googleRedirect(r *http.Request) string {
	return a.origin(r) + "/api/auth/google/callback"
}

func (a *App) handleGoogleStart(w http.ResponseWriter, r *http.Request) error {
	state := randomToken()
	http.SetCookie(w, a.authCookie(r, oauthStateCookie, state, 10*time.Minute))
	q := url.Values{
		"client_id":     {a.cfg.GoogleClientID},
		"redirect_uri":  {a.googleRedirect(r)},
		"response_type": {"code"},
		"scope":         {"openid email"},
		"state":         {state},
		"prompt":        {"select_account"},
	}
	http.Redirect(w, r, "https://accounts.google.com/o/oauth2/v2/auth?"+q.Encode(), http.StatusFound)
	return nil
}

func (a *App) handleGoogleCallback(w http.ResponseWriter, r *http.Request) error {
	back := func(path string) error {
		http.Redirect(w, r, path, http.StatusFound)
		return nil
	}
	c, err := r.Cookie(oauthStateCookie)
	http.SetCookie(w, a.authCookie(r, oauthStateCookie, "", 0))
	q := r.URL.Query()
	if err != nil || c.Value == "" || !equal([]byte(c.Value), []byte(q.Get("state"))) || q.Get("code") == "" {
		return back("/login?google=failed")
	}
	id, err := a.googleIdentity(r.Context(), q.Get("code"), a.googleRedirect(r))
	if err != nil {
		log.Printf("google: %v", err)
		return back("/login?google=failed")
	}
	email := normEmail(id.Email)

	acct, err := a.db.GoogleAccount(id.Sub, email)
	uid := acct.ID
	switch {
	case errors.Is(err, store.ErrNotFound):
	case err != nil:
		return err
	case acct.Sub.Valid && acct.Sub.String != id.Sub:
		// The address belongs to an account tied to a different Google identity.
		return back("/login?google=failed")
	case !acct.Verified:
		// Someone signed up with this address but never proved it was theirs.
		// It must not become the real owner's account, password and all.
		if err := a.db.DeleteUnverified(uid); err != nil {
			return err
		}
	default:
		if a.refuseSuspended(uid) != nil {
			return back("/login?google=suspended")
		}
		if err := a.db.SetGoogleSub(uid, id.Sub); err != nil {
			return err
		}
		if err := a.startSession(w, r, uid); err != nil {
			return err
		}
		return back("/drive")
	}
	if !a.cfg.AllowRegistration {
		return back("/login?google=closed")
	}
	ticket := a.signTicket(googleTicket{Email: email, Sub: id.Sub, Exp: time.Now().Add(googleTicketTTL).Unix()})
	http.SetCookie(w, a.authCookie(r, googleCookie, ticket, googleTicketTTL))
	return back("/register?google=1")
}

// handleGooglePending tells the sign-up page which address Google vouched for.
func (a *App) handleGooglePending(w http.ResponseWriter, r *http.Request) error {
	t := a.readTicket(r)
	if t == nil {
		return errNotFound
	}
	writeJSON(w, 200, map[string]string{"email": t.Email})
	return nil
}

type googleID struct {
	Iss           string `json:"iss"`
	Aud           string `json:"aud"`
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Exp           int64  `json:"exp"`
}

// googleIdentity trades an authorization code for the signed-in identity.
// The ID token arrives straight from Google over TLS, which is what vouches
// for it; its claims are still checked against this client.
func (a *App) googleIdentity(ctx context.Context, code, redirect string) (*googleID, error) {
	form := url.Values{
		"code": {code}, "client_id": {a.cfg.GoogleClientID}, "client_secret": {a.cfg.GoogleSecret},
		"redirect_uri": {redirect}, "grant_type": {"authorization_code"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://oauth2.googleapis.com/token", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	var tok struct {
		IDToken string `json:"id_token"`
		Error   string `json:"error"`
		Detail  string `json:"error_description"`
	}
	if err := json.NewDecoder(res.Body).Decode(&tok); err != nil {
		return nil, err
	}
	parts := strings.Split(tok.IDToken, ".")
	if res.StatusCode != http.StatusOK || len(parts) != 3 {
		return nil, fmt.Errorf("token exchange: %d %s %s", res.StatusCode, tok.Error, tok.Detail)
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}
	var id googleID
	if err := json.Unmarshal(raw, &id); err != nil {
		return nil, err
	}
	if (id.Iss != "https://accounts.google.com" && id.Iss != "accounts.google.com") || id.Aud != a.cfg.GoogleClientID ||
		id.Sub == "" || id.Email == "" || !id.EmailVerified || id.Exp <= now() {
		return nil, errors.New("id token rejected")
	}
	return &id, nil
}

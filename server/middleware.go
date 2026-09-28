package main

import (
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const sessionCookie = "coffer_session"

func (a *App) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()")
		if a.cfg.HSTS {
			h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		}
		next.ServeHTTP(w, r)
	})
}

// csrf rejects state-changing API requests that could have been forged by
// another origin: they must carry a custom header (which forces a CORS
// preflight we never approve) and, when present, a same-origin Origin header.
func (a *App) csrf(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") && r.Method != http.MethodGet && r.Method != http.MethodHead {
			if r.Header.Get("X-Coffer") != "1" {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "missing request header"})
				return
			}
			if o := r.Header.Get("Origin"); o != "" {
				u, err := url.Parse(o)
				if err != nil || u.Host != r.Host {
					writeJSON(w, http.StatusForbidden, map[string]string{"error": "cross-origin request"})
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (a *App) limitAuth(next handler) handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		if !a.authLimit.allow(clientIP(r, a.cfg.TrustProxy)) {
			return errf(http.StatusTooManyRequests, "too many attempts, slow down")
		}
		return next(w, r)
	}
}

// currentUser returns the signed-in user id, or "" when anonymous.
func (a *App) currentUser(r *http.Request) (string, error) {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		return "", nil
	}
	var uid string
	err = a.db.QueryRow(`SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?`,
		sha([]byte(c.Value)), now()).Scan(&uid)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return uid, err
}

func (a *App) requireUser(r *http.Request) (string, error) {
	uid, err := a.currentUser(r)
	if err != nil {
		return "", err
	}
	if uid == "" {
		return "", errUnauthorized
	}
	return uid, nil
}

func (a *App) startSession(w http.ResponseWriter, r *http.Request, userID string) error {
	token := randomToken()
	exp := time.Now().Add(a.cfg.SessionTTL)
	if _, err := a.db.Exec(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
		sha([]byte(token)), userID, now(), exp.Unix()); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/api/",
		Expires:  exp,
		HttpOnly: true,
		Secure:   a.isSecure(r),
		SameSite: http.SameSiteStrictMode,
	})
	return nil
}

func (a *App) clearSession(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		_, _ = a.db.Exec(`DELETE FROM sessions WHERE token_hash = ?`, sha([]byte(c.Value)))
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: "", Path: "/api/", MaxAge: -1,
		HttpOnly: true, Secure: a.isSecure(r), SameSite: http.SameSiteStrictMode,
	})
}

func (a *App) isSecure(r *http.Request) bool {
	return r.TLS != nil || (a.cfg.TrustProxy && r.Header.Get("X-Forwarded-Proto") == "https")
}

// ticketStore holds short-lived download tickets issued when a share link is
// opened, so a burn-after-read link can still stream its single download.
type ticketStore struct {
	mu sync.Mutex
	m  map[string]ticket
}

type ticket struct {
	shareID string
	itemID  string
	exp     time.Time
}

const ticketTTL = 30 * time.Minute

func newTicketStore() *ticketStore {
	t := &ticketStore{m: map[string]ticket{}}
	go func() {
		for range time.Tick(time.Minute) {
			t.mu.Lock()
			for k, v := range t.m {
				if time.Now().After(v.exp) {
					delete(t.m, k)
				}
			}
			t.mu.Unlock()
		}
	}()
	return t
}

func (t *ticketStore) issue(shareID, itemID string) string {
	tok := randomToken()
	t.mu.Lock()
	t.m[string(sha([]byte(tok)))] = ticket{shareID, itemID, time.Now().Add(ticketTTL)}
	t.mu.Unlock()
	return tok
}

func (t *ticketStore) get(tok string) (ticket, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	v, ok := t.m[string(sha([]byte(tok)))]
	if !ok || time.Now().After(v.exp) {
		return ticket{}, false
	}
	return v, true
}

func (t *ticketStore) revokeShare(shareID string) {
	t.mu.Lock()
	for k, v := range t.m {
		if v.shareID == shareID {
			delete(t.m, k)
		}
	}
	t.mu.Unlock()
}

func (t *ticketStore) revokeItem(itemID string) {
	t.mu.Lock()
	for k, v := range t.m {
		if v.itemID == itemID {
			delete(t.m, k)
		}
	}
	t.mu.Unlock()
}

// keyedMutex serialises work per key (e.g. chunk writes to one item).
type keyedMutex struct{ m sync.Map }

func (k *keyedMutex) lock(key string) func() {
	v, _ := k.m.LoadOrStore(key, &sync.Mutex{})
	mu := v.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

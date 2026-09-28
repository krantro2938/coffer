package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type apiError struct {
	Status  int
	Message string
}

func (e *apiError) Error() string { return e.Message }

func errf(status int, msg string) error { return &apiError{status, msg} }

var (
	errNotFound     = errf(http.StatusNotFound, "not found")
	errUnauthorized = errf(http.StatusUnauthorized, "not signed in")
	errForbidden    = errf(http.StatusForbidden, "forbidden")
)

// handler adapts error-returning handlers to http.HandlerFunc.
type handler func(w http.ResponseWriter, r *http.Request) error

func (h handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	err := h(w, r)
	if err == nil {
		return
	}
	var ae *apiError
	if errors.As(err, &ae) {
		writeJSON(w, ae.Status, map[string]string{"error": ae.Message})
		return
	}
	var mbe *http.MaxBytesError
	if errors.As(err, &mbe) {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "request too large"})
		return
	}
	log.Printf("error: %s %s: %v", r.Method, r.URL.Path, err)
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return err
		}
		return errf(http.StatusBadRequest, "invalid request body")
	}
	if dec.More() {
		return errf(http.StatusBadRequest, "invalid request body")
	}
	return nil
}

// Crockford base32, lowercase. Excludes i, l, o, u to stay unambiguous when typed.
const crockford = "0123456789abcdefghjkmnpqrstvwxyz"

func randomID(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	out := make([]byte, n)
	for i, v := range b {
		out[i] = crockford[v&31]
	}
	return string(out)
}

func randomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func sha(b []byte) []byte {
	s := sha256.Sum256(b)
	return s[:]
}

func hmacSHA(key, msg []byte) []byte {
	m := hmac.New(sha256.New, key)
	m.Write(msg)
	return m.Sum(nil)
}

func equal(a, b []byte) bool { return subtle.ConstantTimeCompare(a, b) == 1 }

var (
	itemIDRe  = regexp.MustCompile(`^[0-9a-hjkmnp-tv-z]{26}$`)
	shareIDRe = regexp.MustCompile(`^[0-9a-hjkmnp-tv-z]{7}$`)
	emailRe   = regexp.MustCompile(`^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$`)
)

// normalizeShareID folds the characters people commonly mistype.
func normalizeShareID(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	return strings.NewReplacer("o", "0", "i", "1", "l", "1").Replace(s)
}

func now() int64 { return time.Now().Unix() }

func clientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			// The right-most entry is the one appended by our own (trusted) proxy.
			parts := strings.Split(xff, ",")
			return strings.TrimSpace(parts[len(parts)-1])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func drain(r io.Reader) { _, _ = io.Copy(io.Discard, io.LimitReader(r, 1<<20)) }

func nullInt(v *int64) any {
	if v == nil {
		return nil
	}
	return *v
}

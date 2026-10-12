package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func cspFor(t *testing.T, analytics, path string) string {
	t.Helper()
	dir := t.TempDir()
	shell := `<!DOCTYPE html><html><head><title>Coffer</title><meta name="description" content="x"/></head><body><script>boot()</script></body></html>`
	if err := os.WriteFile(filepath.Join(dir, "_shell.html"), []byte(shell), 0o600); err != nil {
		t.Fatal(err)
	}
	h, err := newStaticHandler(dir, func(*http.Request) string { return "https://coffer.test" }, analytics)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
	return rec.Header().Get("Content-Security-Policy")
}

func directive(csp, name string) string {
	for _, d := range strings.Split(csp, "; ") {
		if strings.HasPrefix(d, name+" ") {
			return d
		}
	}
	return ""
}

func TestPolicyWithAnalyticsOff(t *testing.T) {
	for _, p := range []string{"/", "/security", "/s/abc1234", "/drive"} {
		csp := cspFor(t, "", p)
		if got := directive(csp, "connect-src"); got != "connect-src 'self'" {
			t.Errorf("%s: %s", p, got)
		}
	}
}

func TestPolicyWithAnalyticsOn(t *testing.T) {
	const origin = "https://stats.example.com"
	base := cspFor(t, "", "/")
	for _, p := range []string{"/", "/security", "/terms", "/privacy", "/s/abc1234", "/r/abc1234", "/receive", "/login", "/register", "/drive", "/settings"} {
		csp := cspFor(t, origin, p)
		if got := directive(csp, "connect-src"); got != "connect-src 'self' "+origin {
			t.Errorf("%s: %s", p, got)
		}
		// Only connect-src differs: scripts, frames and the rest are exactly as before.
		if strings.Replace(csp, " "+origin, "", 1) != base {
			t.Errorf("%s: policy differs from the default by more than connect-src:\n%s\n%s", p, csp, base)
		}
	}
	// The admin console never reports.
	for _, p := range []string{"/admin", "/admin/"} {
		if csp := cspFor(t, origin, p); csp != base {
			t.Errorf("%s: policy names the analytics server: %s", p, csp)
		}
	}
}

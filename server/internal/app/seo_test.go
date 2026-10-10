package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPagesDescribeThemselves(t *testing.T) {
	dir := t.TempDir()
	shell := `<!DOCTYPE html><html lang="en"><head><title>Coffer</title><meta name="description" content="old"/></head><body class="x"><script>boot()</script></body></html>`
	if err := os.WriteFile(filepath.Join(dir, "_shell.html"), []byte(shell), 0o600); err != nil {
		t.Fatal(err)
	}
	h, err := newStaticHandler(dir, func(*http.Request) string { return "https://coffer.test" })
	if err != nil {
		t.Fatal(err)
	}
	get := func(path string) (*httptest.ResponseRecorder, string) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		return rec, rec.Body.String()
	}

	_, home := get("/")
	for _, want := range []string{
		"<title>Coffer — send and request private files, no account needed</title>",
		`<link rel="canonical" href="https://coffer.test/"/>`,
		`<meta property="og:image" content="https://coffer.test/og.png"/>`,
		`<meta name="twitter:card" content="summary_large_image"/>`,
		`<body class="x"><noscript>`,
		"<script>boot()</script>", // the bootstrap script is untouched, so its hash in the policy still matches
	} {
		if !strings.Contains(home, want) {
			t.Errorf("the home page lacks %q", want)
		}
	}
	if strings.Contains(home, "noindex") {
		t.Error("the home page asks not to be indexed")
	}

	_, security := get("/security")
	if !strings.Contains(security, "<title>Security model — Coffer</title>") || !strings.Contains(security, `href="https://coffer.test/security"`) {
		t.Error("the security page does not carry its own title and address")
	}
	if strings.Contains(security, "<noscript>") {
		t.Error("the home page's text is on another page")
	}

	// Someone's link is nobody else's business.
	for _, path := range []string{"/s/k7m3xq2", "/r/0123456789abcdefghjk", "/drive", "/settings"} {
		rec, body := get(path)
		if rec.Header().Get("X-Robots-Tag") == "" || !strings.Contains(body, `content="noindex, nofollow"`) || strings.Contains(body, "og:image") {
			t.Errorf("%s is not marked as not to be indexed", path)
		}
	}

	_, robots := get("/robots.txt")
	if !strings.Contains(robots, "Disallow: /s/") || !strings.Contains(robots, "Sitemap: https://coffer.test/sitemap.xml") {
		t.Errorf("robots.txt = %q", robots)
	}
	_, sitemap := get("/sitemap.xml")
	if !strings.Contains(sitemap, "<loc>https://coffer.test/security</loc>") || strings.Contains(sitemap, "/drive") {
		t.Errorf("sitemap.xml = %q", sitemap)
	}
}

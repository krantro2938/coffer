package app

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

// staticHandler serves the built single-page app. Unknown paths fall back to
// the SPA shell so client-side routes like /s/abc1234 work on reload.
type staticHandler struct {
	dir   string
	shell []byte
	csp   string
	files http.Handler
	// origin is the site's own address as this request reached it.
	origin func(*http.Request) string
}

var inlineScriptRe = regexp.MustCompile(`(?s)<script(?:\s[^>]*)?>(.*?)</script>`)

func newStaticHandler(dir string, origin func(*http.Request) string) (*staticHandler, error) {
	shell, err := os.ReadFile(filepath.Join(dir, "_shell.html"))
	if err != nil {
		return nil, err
	}
	// The router's bootstrap script embeds a raw NUL inside a JS string
	// literal. HTML parsers turn NUL into U+FFFD before hashing and executing,
	// so the CSP hash would never match. Rewrite it as the equivalent JS escape.
	shell = bytes.ReplaceAll(shell, []byte{0}, []byte(`\u0000`))

	// Allow exactly the inline bootstrap scripts baked into the shell, by hash.
	var hashes []string
	for _, m := range inlineScriptRe.FindAllSubmatch(shell, -1) {
		if len(m[1]) == 0 {
			continue
		}
		sum := sha256.Sum256(m[1])
		hashes = append(hashes, fmt.Sprintf("'sha256-%s'", base64.StdEncoding.EncodeToString(sum[:])))
	}
	csp := strings.Join([]string{
		"default-src 'self'",
		"script-src 'self' 'wasm-unsafe-eval' " + strings.Join(hashes, " "),
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' blob: data:",
		"media-src 'self' blob:",
		"font-src 'self' data:",
		"connect-src 'self'",
		"worker-src 'self' blob:",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	}, "; ")
	return &staticHandler{dir: dir, shell: shell, csp: csp, files: http.FileServer(http.Dir(dir)), origin: origin}, nil
}

func (s *staticHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	p := path.Clean("/" + r.URL.Path)
	switch p {
	case "/robots.txt":
		s.robots(w, r)
		return
	case "/sitemap.xml":
		s.sitemap(w, r)
		return
	}
	if p != "/" && !strings.HasSuffix(p, ".html") {
		if st, err := os.Stat(filepath.Join(s.dir, filepath.FromSlash(p))); err == nil && !st.IsDir() {
			if strings.HasPrefix(p, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				w.Header().Set("Cache-Control", "public, max-age=3600")
			}
			s.files.ServeHTTP(w, r)
			return
		}
		if strings.HasPrefix(p, "/assets/") {
			http.NotFound(w, r)
			return
		}
	}
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "no-cache")
	h.Set("Content-Security-Policy", s.csp)
	if _, public := publicPages[p]; !public {
		h.Set("X-Robots-Tag", "noindex, nofollow")
	}
	_, _ = w.Write(s.page(p, s.origin(r)))
}

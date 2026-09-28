// Coffer is an end-to-end encrypted file and text drop.
//
// The server never sees plaintext or keys: browsers encrypt everything with
// AES-256-GCM before upload and only ciphertext, wrapped keys and hashes of
// high-entropy access tokens are stored here.
package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

type App struct {
	cfg    Config
	db     *sql.DB
	secret []byte // server-side pepper, never leaves the data dir
	blobs  string

	authLimit      *limiter // per IP, auth endpoints
	loginFailLimit *limiter // per email, failed logins
	shareOpenLimit *limiter // per IP, share opens
	shareFailLimit *limiter // per share, wrong access tokens
	anonLimit      *limiter // per IP, anonymous uploads

	tickets *ticketStore
	locks   *keyedMutex
}

func main() {
	cfg := loadConfig()
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck(cfg.ListenAddr))
	}
	if err := os.MkdirAll(filepath.Join(cfg.DataDir, "blobs"), 0o700); err != nil {
		log.Fatal(err)
	}
	db, err := openDB(cfg.DataDir)
	if err != nil {
		log.Fatal(err)
	}
	secret, err := loadSecret(filepath.Join(cfg.DataDir, "server.key"))
	if err != nil {
		log.Fatal(err)
	}

	app := &App{
		cfg:            cfg,
		db:             db,
		secret:         secret,
		blobs:          filepath.Join(cfg.DataDir, "blobs"),
		authLimit:      newLimiter(30, time.Minute),
		loginFailLimit: newLimiter(10, 15*time.Minute),
		shareOpenLimit: newLimiter(60, time.Minute),
		shareFailLimit: newLimiter(10, 15*time.Minute),
		anonLimit:      newLimiter(30, time.Hour),
		tickets:        newTicketStore(),
		locks:          &keyedMutex{},
	}

	static, err := newStaticHandler(cfg.StaticDir)
	if err != nil {
		log.Printf("static: %v (API only)", err)
	}

	srv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           app.routes(static),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go app.janitor(ctx)

	go func() {
		log.Printf("coffer listening on %s", cfg.ListenAddr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdown)
	_ = db.Close()
}

func (a *App) routes(static http.Handler) http.Handler {
	mux := http.NewServeMux()
	h := func(pattern string, fn handler) { mux.Handle(pattern, fn) }

	h("GET /api/config", a.handleConfig)
	h("GET /api/health", func(w http.ResponseWriter, r *http.Request) error {
		writeJSON(w, 200, map[string]bool{"ok": true})
		return nil
	})

	// Accounts
	h("POST /api/auth/params", a.limitAuth(a.handleParams))
	h("POST /api/auth/register", a.limitAuth(a.handleRegister))
	h("POST /api/auth/login", a.limitAuth(a.handleLogin))
	h("POST /api/auth/logout", a.handleLogout)
	h("GET /api/auth/me", a.handleMe)
	h("POST /api/auth/password", a.limitAuth(a.handleChangePassword))
	h("POST /api/auth/recover/start", a.limitAuth(a.handleRecoverStart))
	h("POST /api/auth/recover/finish", a.limitAuth(a.handleRecoverFinish))
	h("POST /api/auth/delete", a.limitAuth(a.handleDeleteAccount))

	// Drive
	h("GET /api/drive", a.handleDrive)
	h("POST /api/folders", a.handleCreateFolder)
	h("PATCH /api/folders/{id}", a.handleUpdateFolder)
	h("DELETE /api/folders/{id}", a.handleDeleteFolder)
	h("POST /api/items", a.handleCreateItem)
	h("PUT /api/items/{id}/chunks/{n}", a.handleUploadChunk)
	h("POST /api/items/{id}/complete", a.handleCompleteItem)
	h("PATCH /api/items/{id}", a.handleUpdateItem)
	h("DELETE /api/items/{id}", a.handleDeleteItem)
	h("GET /api/items/{id}/blob", a.handleItemBlob)

	// Share links (owner side)
	h("POST /api/shares", a.handleCreateShare)
	h("GET /api/shares", a.handleListShares)
	h("DELETE /api/shares/{id}", a.handleDeleteShare)

	// Share links (recipient side)
	h("GET /api/s/{id}", a.handleShareInfo)
	h("POST /api/s/{id}/open", a.handleShareOpen)
	h("GET /api/s/{id}/blob", a.handleShareBlob)

	mux.Handle("/api/", handler(func(w http.ResponseWriter, r *http.Request) error { return errNotFound }))
	if static != nil {
		mux.Handle("/", static)
	}
	return a.securityHeaders(a.csrf(mux))
}

func (a *App) handleConfig(w http.ResponseWriter, r *http.Request) error {
	writeJSON(w, 200, map[string]any{
		"allowRegistration": a.cfg.AllowRegistration,
		"allowAnonymous":    a.cfg.AllowAnonymous,
		"maxFileSize":       a.cfg.MaxFileSize,
		"anonMaxFileSize":   a.cfg.AnonMaxFileSize,
		"anonMaxExpiry":     int64(a.cfg.AnonMaxExpiry.Seconds()),
	})
	return nil
}

// healthcheck lets the container probe itself without shipping curl.
func healthcheck(addr string) int {
	if addr != "" && addr[0] == ':' {
		addr = "127.0.0.1" + addr
	}
	c := http.Client{Timeout: 3 * time.Second}
	res, err := c.Get("http://" + addr + "/api/health")
	if err != nil || res.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

func loadSecret(path string) ([]byte, error) {
	b, err := os.ReadFile(path)
	if err == nil {
		if len(b) != 32 {
			return nil, errors.New("server.key is corrupt; refusing to overwrite it")
		}
		return b, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	b = make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, b, 0o600); err != nil {
		return nil, err
	}
	return b, nil
}

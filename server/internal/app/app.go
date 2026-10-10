// Package app is the Coffer server: the HTTP API, the admin console and the
// janitor that clears out what has expired.
//
// The server never sees plaintext or keys: browsers encrypt everything with
// AES-256-GCM before upload and only ciphertext, wrapped keys and hashes of
// high-entropy access tokens are stored here.
package app

import (
	"context"
	"errors"
	"log"
	"net/http"
	"sync/atomic"
	"time"

	"golang.org/x/sync/semaphore"

	"coffer/internal/config"
	"coffer/internal/mail"
	"coffer/internal/paddle"
	"coffer/internal/ratelimit"
	"coffer/internal/storage"
	"coffer/internal/store"
)

type App struct {
	cfg     config.Config
	db      *store.Store
	secret  []byte         // server-side pepper, never leaves the data dir
	blobs   storage.Store  // the ciphertext of uploads
	billing *paddle.Client // nil when drives are free
	payPage string         // the checkout page, rendered once
	mail    *mail.Mailer   // nil when emails are not verified
	static  http.Handler   // the built web app; nil when it is not there (API only)

	removing   chan struct{} // bounds concurrent blob deletions
	hourlyBusy atomic.Bool
	lastBackup time.Time

	authLimit      *ratelimit.Limiter  // per IP, auth endpoints
	loginFailLimit *ratelimit.Limiter  // per email, failed logins
	shareOpenLimit *ratelimit.Limiter  // per IP, share opens
	shareFailLimit *ratelimit.Limiter  // per share, wrong access tokens
	anonLimit      *ratelimit.Limiter  // per IP, anonymous uploads
	mailLimit      *ratelimit.Limiter  // per account, emailed codes
	reportLimit    *ratelimit.Limiter  // per IP, abuse reports
	requestLimit   *ratelimit.Limiter  // per IP, uploads through file requests
	trialLimit     *ratelimit.Limiter  // per IP, requests for a trial
	chunks         *semaphore.Weighted // bounds the upload chunks held in memory at once
	adminLimit     *ratelimit.Limiter  // per IP, failed admin sign-ins
	admins         *adminSessions

	tickets *ticketStore
	locks   *keyedMutex
}

// New wires the server up. secret is the server-side pepper: 32 random bytes
// that must stay the same for as long as the database does.
func New(cfg config.Config, db *store.Store, blobs storage.Store, secret []byte) *App {
	a := &App{
		cfg:            cfg,
		db:             db,
		secret:         secret,
		blobs:          blobs,
		removing:       make(chan struct{}, 8),
		authLimit:      ratelimit.New(30, time.Minute),
		loginFailLimit: ratelimit.New(10, 15*time.Minute),
		shareOpenLimit: ratelimit.New(60, time.Minute),
		shareFailLimit: ratelimit.New(10, 15*time.Minute),
		anonLimit:      ratelimit.New(30, time.Hour),
		mailLimit:      ratelimit.New(8, time.Hour),
		reportLimit:    ratelimit.New(5, time.Hour),
		requestLimit:   ratelimit.New(300, time.Hour),
		trialLimit:     ratelimit.New(5, time.Hour),
		chunks:         semaphore.NewWeighted(chunkMemory),
		adminLimit:     ratelimit.New(8, 15*time.Minute),
		admins:         &adminSessions{m: map[string]time.Time{}},
		mail:           mail.New(cfg.ResendKey, cfg.MailFrom),
		tickets:        newTicketStore(),
		locks:          newKeyedMutex(),
	}
	if a.mail == nil {
		log.Print("mail: RESEND_API_KEY or MAIL_FROM is not set, email addresses are not verified")
	}
	if cfg.PaddleKey != "" {
		a.billing = paddle.New(cfg.PaddleKey, cfg.PaddleClientToken, cfg.PaddleWebhookSecret)
		a.payPage = renderPayPage()
		mode := "live"
		if a.billing.Sandbox {
			mode = "sandbox"
		}
		log.Printf("billing: Paddle (%s)", mode)
		if cfg.PaddleClientToken == "" {
			log.Print("billing: PADDLE_CLIENT_TOKEN is not set, the checkout cannot open; run `coffer paddle-setup`")
		}
		if cfg.PaddleWebhookSecret == "" {
			log.Print("billing: PADDLE_WEBHOOK_SECRET is not set, subscriptions are polled instead of pushed")
		}
	}
	if sh, err := newStaticHandler(cfg.StaticDir, a.origin); err != nil {
		log.Printf("static: %v (API only)", err)
	} else {
		a.static = sh
	}
	return a
}

// Handler serves the public site.
func (a *App) Handler() http.Handler { return a.routes() }

// AdminHandler serves the admin console, which belongs on a listener of its own.
func (a *App) AdminHandler() http.Handler { return a.adminRoutes() }

// Run serves until ctx is done: the public site on cfg.ListenAddr, the admin
// console on cfg.AdminAddr when an admin token is set, and the janitor.
func (a *App) Run(ctx context.Context) error {
	servers := []*http.Server{{Addr: a.cfg.ListenAddr, Handler: a.Handler()}}
	log.Printf("coffer listening on %s", a.cfg.ListenAddr)
	if a.cfg.AdminToken != "" {
		servers = append(servers, &http.Server{Addr: a.cfg.AdminAddr, Handler: a.AdminHandler()})
		log.Printf("admin console listening on %s", a.cfg.AdminAddr)
	}
	go a.janitor(ctx)

	failed := make(chan error, len(servers))
	for _, srv := range servers {
		srv.ReadHeaderTimeout = 10 * time.Second
		srv.IdleTimeout = 120 * time.Second
		go func() {
			if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
				failed <- err
			}
		}()
	}
	var err error
	select {
	case <-ctx.Done():
	case err = <-failed:
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	for _, srv := range servers {
		_ = srv.Shutdown(shutdown)
	}
	return err
}

// routes is the public site: the API and, behind it, the single-page app.
func (a *App) routes() http.Handler {
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
	h("GET /api/auth/sessions", a.handleSessions)
	h("DELETE /api/auth/sessions/{id}", a.handleEndSession)
	h("POST /api/auth/sessions/end-others", a.handleEndOtherSessions)
	h("POST /api/auth/verify", a.limitAuth(a.handleVerify))
	h("POST /api/auth/verify/resend", a.limitAuth(a.handleResendCode))
	if a.cfg.GoogleClientID != "" && a.cfg.GoogleSecret != "" {
		h("GET /api/auth/google/start", a.limitAuth(a.handleGoogleStart))
		h("GET /api/auth/google/callback", a.limitAuth(a.handleGoogleCallback))
		h("GET /api/auth/google/pending", a.handleGooglePending)
	}

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
	h("GET /api/items/{id}/status", a.handleItemStatus)
	h("POST /api/items/{id}/adopt", a.handleAdoptItem)

	// File requests (owner side)
	h("POST /api/requests", a.handleCreateRequest)
	h("GET /api/requests", a.handleListRequests)
	h("POST /api/requests/{id}/revoke", a.handleRevokeRequest)
	h("DELETE /api/requests/{id}", a.handleDeleteRequest)

	// File requests (uploader side); uploads themselves go through /api/items
	h("GET /api/r/{id}", a.handleRequestInfo)

	// Share links (owner side)
	h("POST /api/shares", a.handleCreateShare)
	h("GET /api/shares", a.handleListShares)
	h("PUT /api/shares/{id}/item", a.handleRetargetShare)
	h("DELETE /api/shares/{id}", a.handleDeleteShare)

	// Share links (recipient side)
	h("GET /api/s/{id}", a.handleShareInfo)
	h("POST /api/s/{id}/open", a.handleShareOpen)
	h("GET /api/s/{id}/blob", a.handleShareBlob)
	h("GET /api/s/{id}/added", a.handleShareAdded)
	h("POST /api/s/{id}/report", a.handleReport)
	h("GET /api/invites/{token}", a.handleInvite)
	h("POST /api/trial", a.handleTrialRequest)

	if a.billing != nil {
		h("POST /api/billing/checkout", a.handleCheckout)
		h("POST /api/billing/sync", a.handleBillingSync)
		h("POST /api/billing/plan", a.handleChangePlan)
		h("POST /api/billing/portal", a.handlePortal)
		h("POST "+paddle.WebhookPath, a.handleWebhook)
		h("GET /pay", a.handlePayPage)
		h("GET /pay.js", a.handlePayScript)
	}

	mux.Handle("/api/", handler(func(w http.ResponseWriter, r *http.Request) error { return errNotFound }))
	if a.static != nil {
		mux.Handle("/", a.static)
	}
	return a.securityHeaders(a.csrf(mux))
}

func (a *App) handleConfig(w http.ResponseWriter, r *http.Request) error {
	cfg := map[string]any{
		"allowRegistration": a.cfg.AllowRegistration,
		"allowAnonymous":    a.cfg.AllowAnonymous,
		"maxFileSize":       a.cfg.MaxFileSize,
		"anonMaxShareSize":  a.cfg.AnonMaxShareSize,
		"anonMaxFiles":      a.cfg.AnonMaxFiles,
		"anonMaxExpiry":     int64(a.cfg.AnonMaxExpiry.Seconds()),
		"plans":             nil, // null: drives are free on this server
		"google":            a.cfg.GoogleClientID != "" && a.cfg.GoogleSecret != "",
	}
	if a.billing != nil {
		cfg["plans"] = a.plansJSON(r.Context())
	}
	writeJSON(w, 200, cfg)
	return nil
}

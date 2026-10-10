package config

import (
	"bufio"
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	ListenAddr        string
	DataDir           string
	StaticDir         string
	PublicURL         string // e.g. https://coffer.example; where the checkout page returns to when it is hosted elsewhere
	AllowRegistration bool
	AllowAnonymous    bool
	MaxFileSize       int64 // plaintext bytes per file, drive uploads
	AnonMaxShareSize  int64 // plaintext bytes per quick share, all files together
	AnonMaxFiles      int64 // files per quick share
	UserQuota         int64 // bytes of ciphertext per user when billing is off
	AnonMaxExpiry     time.Duration
	SessionTTL        time.Duration
	TrustProxy        bool
	HSTS              bool

	// S3-compatible object storage. Blobs stay on local disk when S3Bucket is empty.
	S3KeyID    string
	S3Secret   string
	S3Bucket   string
	S3Endpoint string
	S3Region   string // taken from the endpoint's host when empty
	S3Prefix   string // keeps several deployments apart in one bucket, e.g. "prod/"

	// Paddle Billing. Drives are free and sized by UserQuota when PaddleKey is empty.
	PaddleKey           string
	PaddleClientToken   string
	PaddleWebhookSecret string
	LapseGrace          time.Duration // how long a lapsed drive is kept before it is emptied
	PaddleCheckoutURL   string        // overrides the account's default payment link, e.g. a /pay page on its own subdomain

	// Resend, for sign-up codes and lapse warnings. Emails are not verified when ResendKey is empty.
	ResendKey string
	MailFrom  string

	// The admin console: its own listener, meant for its own hostname. Off when AdminToken is empty.
	AdminAddr   string
	AdminToken  string
	AdminNotify string // address that hears about new abuse reports

	// Google sign-in (optional).
	GoogleClientID string
	GoogleSecret   string
}

// Load reads the configuration from the environment, and from a .env file if
// there is one.
func Load() Config {
	loadDotEnv(".env", "../.env")
	c := Config{
		ListenAddr:        env("LISTEN_ADDR", ":8080"),
		DataDir:           env("DATA_DIR", "./data"),
		StaticDir:         env("STATIC_DIR", "../web/dist/client"),
		PublicURL:         strings.TrimRight(env("PUBLIC_URL", ""), "/"),
		AllowRegistration: envBool("ALLOW_REGISTRATION", true),
		AllowAnonymous:    envBool("ALLOW_ANONYMOUS", true),
		MaxFileSize:       envInt("MAX_FILE_MB", 1024) << 20,
		AnonMaxShareSize:  envInt("ANON_MAX_SHARE_MB", 100) << 20,
		AnonMaxFiles:      envInt("ANON_MAX_FILES", 5),
		UserQuota:         envInt("USER_QUOTA_MB", 10240) << 20,
		AnonMaxExpiry:     time.Duration(envInt("ANON_MAX_EXPIRY_HOURS", 168)) * time.Hour,
		SessionTTL:        time.Duration(envInt("SESSION_DAYS", 14)) * 24 * time.Hour,
		TrustProxy:        envBool("TRUST_PROXY", false),
		HSTS:              envBool("HSTS", false),

		S3KeyID:    env("S3_ACCESS_KEY_ID", ""),
		S3Secret:   env("S3_SECRET_ACCESS_KEY", ""),
		S3Bucket:   env("S3_BUCKET", ""),
		S3Endpoint: strings.TrimRight(env("S3_ENDPOINT", ""), "/"),
		S3Region:   env("S3_REGION", ""),
		S3Prefix:   strings.TrimLeft(env("S3_PREFIX", ""), "/"),

		PaddleKey:           env("PADDLE_API_KEY", ""),
		PaddleClientToken:   env("PADDLE_CLIENT_TOKEN", ""),
		PaddleWebhookSecret: env("PADDLE_WEBHOOK_SECRET", ""),
		PaddleCheckoutURL:   env("PADDLE_CHECKOUT_URL", ""),
		LapseGrace:          time.Duration(envInt("LAPSE_GRACE_DAYS", 30)) * 24 * time.Hour,

		ResendKey:      env("RESEND_API_KEY", ""),
		MailFrom:       env("MAIL_FROM", ""),
		AdminAddr:      env("ADMIN_ADDR", ":8081"),
		AdminToken:     env("ADMIN_TOKEN", ""),
		AdminNotify:    env("ADMIN_NOTIFY_EMAIL", ""),
		GoogleClientID: env("GOOGLE_CLIENT_ID", ""),
		GoogleSecret:   env("GOOGLE_CLIENT_SECRET", ""),
	}
	if c.AdminToken != "" && len(c.AdminToken) < 24 {
		log.Fatal("config: ADMIN_TOKEN must be at least 24 characters")
	}
	if c.S3Bucket != "" && (c.S3KeyID == "" || c.S3Secret == "" || c.S3Endpoint == "") {
		log.Fatal("config: S3_BUCKET needs S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_ENDPOINT")
	}
	return c
}

// loadDotEnv reads KEY=VALUE lines from the first file that exists. Variables
// already present in the environment win, so containers are unaffected.
func loadDotEnv(paths ...string) {
	for _, p := range paths {
		f, err := os.Open(p)
		if err != nil {
			continue
		}
		defer f.Close()
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			k, v, ok := strings.Cut(line, "=")
			if !ok || strings.HasPrefix(line, "#") {
				continue
			}
			k = strings.TrimSpace(strings.TrimPrefix(k, "export "))
			v = strings.Trim(strings.TrimSpace(v), `"'`)
			if _, set := os.LookupEnv(k); !set && k != "" {
				os.Setenv(k, v)
			}
		}
		return
	}
}

func env(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func envBool(key string, def bool) bool {
	v := strings.ToLower(env(key, ""))
	switch v {
	case "":
		return def
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	}
	log.Fatalf("config: %s must be a boolean, got %q", key, v)
	return def
}

func envInt(key string, def int64) int64 {
	v := env(key, "")
	if v == "" {
		return def
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n <= 0 {
		log.Fatalf("config: %s must be a positive integer, got %q", key, v)
	}
	return n
}

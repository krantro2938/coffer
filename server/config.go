package main

import (
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
	AllowRegistration bool
	AllowAnonymous    bool
	MaxFileSize       int64 // plaintext bytes, signed-in users
	AnonMaxFileSize   int64 // plaintext bytes, anonymous drops
	UserQuota         int64 // bytes of ciphertext per user
	AnonMaxExpiry     time.Duration
	SessionTTL        time.Duration
	TrustProxy        bool
	HSTS              bool
}

func loadConfig() Config {
	c := Config{
		ListenAddr:        env("LISTEN_ADDR", ":8080"),
		DataDir:           env("DATA_DIR", "./data"),
		StaticDir:         env("STATIC_DIR", "../web/dist/client"),
		AllowRegistration: envBool("ALLOW_REGISTRATION", true),
		AllowAnonymous:    envBool("ALLOW_ANONYMOUS", true),
		MaxFileSize:       envInt("MAX_FILE_MB", 5120) << 20,
		AnonMaxFileSize:   envInt("ANON_MAX_FILE_MB", 100) << 20,
		UserQuota:         envInt("USER_QUOTA_MB", 10240) << 20,
		AnonMaxExpiry:     time.Duration(envInt("ANON_MAX_EXPIRY_HOURS", 168)) * time.Hour,
		SessionTTL:        time.Duration(envInt("SESSION_DAYS", 14)) * 24 * time.Hour,
		TrustProxy:        envBool("TRUST_PROXY", false),
		HSTS:              envBool("HSTS", false),
	}
	return c
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

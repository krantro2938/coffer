// Coffer is an end-to-end encrypted file and text drop.
//
//	coffer                     serve
//	coffer healthcheck         probe a running server; for the container
//	coffer paddle-setup [url]  create the Paddle products, prices and webhook
package main

import (
	"context"
	"crypto/rand"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"coffer/internal/app"
	"coffer/internal/config"
	"coffer/internal/paddle"
	"coffer/internal/storage"
	"coffer/internal/store"
)

func main() {
	cfg := config.Load()
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "healthcheck":
			os.Exit(healthcheck(cfg.ListenAddr))
		case "paddle-setup":
			os.Exit(paddle.Setup(cfg.PaddleKey, cfg.PaddleClientToken, cfg.PaddleWebhookSecret, os.Args[2:]))
		}
	}
	if err := os.MkdirAll(cfg.DataDir, 0o700); err != nil {
		log.Fatal(err)
	}
	var blobs storage.Store
	var err error
	if cfg.S3Bucket != "" {
		blobs, err = storage.NewS3(storage.S3Options{
			Endpoint: cfg.S3Endpoint, Region: cfg.S3Region, Bucket: cfg.S3Bucket, KeyID: cfg.S3KeyID, Key: cfg.S3Secret,
			Prefix: cfg.S3Prefix,
		})
		log.Printf("storage: S3 bucket %q, prefix %q", cfg.S3Bucket, cfg.S3Prefix)
	} else {
		blobs, err = storage.NewLocal(cfg.DataDir)
		log.Printf("storage: local disk under %s", cfg.DataDir)
	}
	if err != nil {
		log.Fatal(err)
	}
	db, err := store.Open(cfg.DataDir)
	if err != nil {
		log.Fatal(err)
	}
	secret, err := loadSecret(filepath.Join(cfg.DataDir, "server.key"))
	if err != nil {
		log.Fatal(err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	err = app.New(cfg, db, blobs, secret).Run(ctx)
	_ = db.Close()
	if err != nil {
		log.Fatal(err)
	}
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

// loadSecret reads the server-side pepper, creating it on first start.
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

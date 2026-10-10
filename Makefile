# Coffer: common tasks. `make` lists them.

E2E_PORT ?= 18080

.DEFAULT_GOAL := help
.PHONY: help install server web build test e2e lint fmt check docker clean

help: ## List the targets
	@awk -F ':.*## ' '/^[a-z0-9-]+:.*## / { printf "  %-10s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

install: ## Install the web app's dependencies
	cd web && npm ci --no-audit --no-fund

server: ## Run the API on :8080 (reads .env)
	cd server && DATA_DIR=./data go run ./cmd/coffer

web: ## Run the web app on :3000, proxying /api to the server
	cd web && npm run dev

build: ## Build the web app and the server binary (server/coffer)
	cd web && npm run build
	cd server && CGO_ENABLED=0 go build -trimpath -o coffer ./cmd/coffer

test: ## Run the Go tests
	cd server && go test -race ./...

e2e: ## Run the web app's end-to-end tests against a throwaway server
	cd server && go build -o coffer ./cmd/coffer
	@tmp=$$(mktemp -d); bin=$$PWD/server/coffer; \
	( cd $$tmp && LISTEN_ADDR=127.0.0.1:$(E2E_PORT) DATA_DIR=$$tmp/data STATIC_DIR=$$tmp/none exec $$bin ) >$$tmp/server.log 2>&1 & pid=$$!; \
	trap 'kill $$pid 2>/dev/null; rm -rf $$tmp' EXIT; \
	for _ in $$(seq 30); do LISTEN_ADDR=127.0.0.1:$(E2E_PORT) $$bin healthcheck && break; sleep 0.5; done; \
	cd web && COFFER_URL=http://127.0.0.1:$(E2E_PORT) npx vitest run tests/integration.test.ts --environment node

lint: ## Lint both halves: go vet, oxlint, tsc
	cd server && go vet ./...
	cd web && npm run -s lint && npm run -s typecheck

fmt: ## Format both halves: gofmt, oxfmt
	cd server && gofmt -w .
	cd web && npm run -s format

check: ## Everything CI checks, short of the end-to-end tests
	@cd server && test -z "$$(gofmt -l .)" || { echo "not gofmt-ed:"; gofmt -l .; exit 1; }
	cd web && npm run -s check
	$(MAKE) lint test

docker: ## Build the container image
	docker build -t coffer:latest .

clean: ## Remove build output
	rm -rf server/coffer web/dist

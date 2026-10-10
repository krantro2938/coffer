# syntax=docker/dockerfile:1

# ---- frontend: TanStack Start (SPA mode) + shadcn/ui
FROM node:24-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json web/.npmrc ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- backend: Go, pure-Go SQLite so the binary is fully static
FROM golang:1.27-alpine AS server
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /coffer ./cmd/coffer && mkdir -p /data

# ---- runtime: distroless, non-root, no shell
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=server /coffer /app/coffer
COPY --from=web /web/dist/client /app/public
COPY --from=server --chown=65532:65532 /data /data
ENV LISTEN_ADDR=:8080 DATA_DIR=/data STATIC_DIR=/app/public
EXPOSE 8080
VOLUME ["/data"]
USER 65532:65532
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD ["/app/coffer", "healthcheck"]
ENTRYPOINT ["/app/coffer"]

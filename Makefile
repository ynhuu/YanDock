.DEFAULT_GOAL := build

GO ?= go
PNPM ?= pnpm
OUT_DIR ?= bin
VERSION ?= dev
RELEASE_ZIPS = yandock-linux-armv7.zip yandock-linux-arm64.zip yandock-linux-amd64.zip yandock-darwin-arm64.zip yandock-darwin-amd64.zip

.PHONY: help frontend build release linux-armv7 linux-arm64 linux-amd64 darwin-arm64 darwin-amd64

help:
	@printf '%s\n' \
	  'make build         构建当前平台：bin/yandock（默认目标）' \
	  'make release       构建五个平台 ZIP 资产及 SHA256SUMS' \
	  'make linux-armv7   构建 Linux ARMv7 ZIP' \
	  'make linux-arm64   构建 Linux arm64 ZIP' \
	  'make linux-amd64   构建 Linux amd64 ZIP' \
	  'make darwin-arm64  构建 macOS arm64（Apple Silicon）ZIP' \
	  'make darwin-amd64  构建 macOS amd64（Intel）ZIP' \
	  'make frontend      构建并同步前端嵌入资源' \
	  '可覆盖变量：GO、PNPM、OUT_DIR（默认 bin）、VERSION（默认 dev）'

# Shared prerequisite: even make -j release builds embedded assets only once.
frontend:
	$(PNPM) --dir web build

$(OUT_DIR):
	mkdir -p "$@"

build: frontend | $(OUT_DIR)
	$(GO) build -trimpath -ldflags="-s -w -X main.version=$(VERSION)" -o "$(OUT_DIR)/yandock" ./cmd/yandock

release: linux-armv7 linux-arm64 linux-amd64 darwin-arm64 darwin-amd64
	@cd "$(OUT_DIR)" && { \
	  if command -v shasum >/dev/null 2>&1; then shasum -a 256 $(RELEASE_ZIPS); \
	  elif command -v sha256sum >/dev/null 2>&1; then sha256sum $(RELEASE_ZIPS); \
	  else printf '%s\n' '需要 shasum 或 sha256sum' >&2; exit 1; fi; \
	} > SHA256SUMS

linux-armv7: frontend | $(OUT_DIR)
	CGO_ENABLED=0 GOOS=linux GOARCH=arm GOARM=7 $(GO) build -trimpath -ldflags="-s -w -X main.version=$(VERSION)" -o "$(OUT_DIR)/yandock-linux-armv7" ./cmd/yandock
	zip -q -j "$(OUT_DIR)/yandock-linux-armv7.zip" "$(OUT_DIR)/yandock-linux-armv7"

linux-arm64: frontend | $(OUT_DIR)
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 $(GO) build -trimpath -ldflags="-s -w -X main.version=$(VERSION)" -o "$(OUT_DIR)/yandock-linux-arm64" ./cmd/yandock
	zip -q -j "$(OUT_DIR)/yandock-linux-arm64.zip" "$(OUT_DIR)/yandock-linux-arm64"

linux-amd64: frontend | $(OUT_DIR)
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 $(GO) build -trimpath -ldflags="-s -w -X main.version=$(VERSION)" -o "$(OUT_DIR)/yandock-linux-amd64" ./cmd/yandock
	zip -q -j "$(OUT_DIR)/yandock-linux-amd64.zip" "$(OUT_DIR)/yandock-linux-amd64"

darwin-arm64: frontend | $(OUT_DIR)
	CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 $(GO) build -trimpath -ldflags="-s -w -X main.version=$(VERSION)" -o "$(OUT_DIR)/yandock-darwin-arm64" ./cmd/yandock
	zip -q -j "$(OUT_DIR)/yandock-darwin-arm64.zip" "$(OUT_DIR)/yandock-darwin-arm64"

darwin-amd64: frontend | $(OUT_DIR)
	CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 $(GO) build -trimpath -ldflags="-s -w -X main.version=$(VERSION)" -o "$(OUT_DIR)/yandock-darwin-amd64" ./cmd/yandock
	zip -q -j "$(OUT_DIR)/yandock-darwin-amd64.zip" "$(OUT_DIR)/yandock-darwin-amd64"

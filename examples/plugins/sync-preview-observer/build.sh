#!/usr/bin/env sh
# Reproducibly build plugin.wasm using a pinned TinyGo image. This needs no
# local Go/TinyGo toolchain — only Docker. For a native build (if you already
# have TinyGo installed) see README.md.
set -eu

TINYGO_IMAGE="tinygo/tinygo:0.41.1"

exec docker run --rm -v "$PWD":/src -w /src "$TINYGO_IMAGE" \
	tinygo build -target wasi -o plugin.wasm main.go

# Sync Preview Observer (example plugin)

A minimal, observe-only Praxrr plugin that targets the
`sync.previewComputed.observe` extension point. It is written in Go and compiled
to WebAssembly with the [Extism Go PDK](https://github.com/extism/go-pdk) via
[TinyGo](https://tinygo.org/).

The full authoring walkthrough lives in the docs:
<https://docs.praxrr.dev/plugins/example-observer/>.

> **Phase-1 status — read this first.** Praxrr can **discover, validate, and
> register** this plugin today (when plugins are enabled in the UI), but it does **not run
> WebAssembly yet**: the default executor rejects every dispatch with
> `wasm runtime not yet available`, so a registered plugin is **never
> observed/executed**. The runtime is a documented NO-GO for the evaluated
> Extism JavaScript SDK on Deno (issue #262) and stays deferred. Building and
> installing this plugin lets you confirm discovery/validation/registration —
> the "observed" step waits for the Phase-2 runtime. The guest export name and
> its argument encoding in `main.go` are therefore **provisional**, not a stable
> contract.

## Files

| File                 | Purpose                                                         |
| -------------------- | --------------------------------------------------------------- |
| `praxrr.plugin.json` | The plugin manifest Praxrr discovers, validates, and registers. |
| `main.go`            | The Extism Go PDK guest (illustrative; not invoked yet).        |
| `go.mod`             | Standalone module pinning `github.com/extism/go-pdk`.           |
| `build.sh`           | Pinned-Docker TinyGo build of `plugin.wasm`.                    |
| `Makefile`           | `make build` / `make install` / `make clean`.                   |

## Build

`plugin.wasm` is a build artifact — it is git-ignored and never committed.

**Docker (no local toolchain required):**

```sh
make build
# runs: docker run --rm -v "$PWD":/src -w /src tinygo/tinygo:0.41.1 \
#         tinygo build -target wasi -o plugin.wasm main.go
```

**Native (if you already have TinyGo installed):** TinyGo is a **distinct
compiler** from the repository's stock `go build`.

```sh
tinygo build -target wasi -o plugin.wasm main.go
```

## Install locally

Praxrr scans `PLUGINS_DIR` (default `<APP_BASE_PATH>/plugins`) for plugin
directories when plugins are enabled in the UI. The directory is **never
auto-created**.

```sh
# Enable plugins via Apps → Plugins in the UI, then optionally:
export PLUGINS_DIR="/path/to/praxrr/dist/dev/plugins"

make install PLUGINS_DIR="$PLUGINS_DIR"
```

Restart Praxrr. On boot the host discovers the manifest, validates it, and
registers the plugin. Because no runtime exists yet, any observe dispatch
no-ops (logged at debug: `Plugin runtime unavailable; observe dispatch
skipped`) — the plugin is registered, not observed.

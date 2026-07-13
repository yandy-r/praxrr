---
title: 'Build & Install the Example Plugin'
description: 'Build, install, and confirm discovery of the shipped sync.previewComputed.observe example plugin.'
---

Praxrr ships a runnable example plugin at
`examples/plugins/sync-preview-observer/` — a Go plugin built with the
Extism Go PDK and compiled to WASM with TinyGo. It targets the wired
`sync.previewComputed.observe` extension point. This page is the
copy-paste walkthrough to build it, install it into `PLUGINS_DIR`, and
confirm the host discovers, validates, and registers its manifest.

:::caution[Not executed yet]
Today you can build, install, and confirm _discovery, validation, and
registration_ of this plugin. The plugin is **not** observed or executed
until the Phase-2 WASM runtime lands
([issue #262](https://github.com/yandy-r/praxrr/issues/262)). The guest
export in `main.go` is a **provisional ABI**, not a stable contract — so
the provable win here is that the JSON manifest is discovered, validated,
and registered, which is independent of that ABI.
:::

Its `praxrr.plugin.json` is the minimal valid manifest for the wired
preview point. See the [Manifest reference](/plugins/manifest/) for the
full validation rules; the example declares:

| Field             | Value                                       |
| ----------------- | ------------------------------------------- |
| `apiVersion`      | `"1"`                                       |
| `id`              | `dev.praxrr.examples.sync-preview-observer` |
| `name`            | `Sync Preview Observer (Example)`           |
| `version`         | `1.0.0`                                     |
| `runtime`         | `wasm`                                      |
| `entry`           | `plugin.wasm`                               |
| `extensionPoints` | `["sync.previewComputed.observe"]`          |
| `capabilities`    | `["read:sync-preview"]`                     |
| `description`     | a short human-readable string (optional)    |

## Prerequisites

You need one of:

- **Docker** — to run the pinned TinyGo image (recommended; reproducible).
- **TinyGo** installed locally — for the native fallback build.

:::note
TinyGo is a _distinct_ compiler from stock `go build`. The example targets
`wasi`, which stock `go build` does not produce, so use TinyGo — directly
or via the Docker image — to get a `plugin.wasm`.
:::

## Build

From the example directory, `make build` runs the pinned Docker build:

```sh
docker run --rm -v "$PWD":/src -w /src \
  tinygo/tinygo:0.41.1 \
  tinygo build -target wasi -o plugin.wasm main.go
```

If you have TinyGo installed locally, the native fallback is the same
compile without Docker:

```sh
tinygo build -target wasi -o plugin.wasm main.go
```

Either path writes `plugin.wasm` next to the manifest. That artifact is
git-ignored and never committed — you rebuild it locally.

## Install into PLUGINS_DIR

The plugin subsystem is off by default. Enable it and point it at an
_existing_ directory:

```sh
# Enable plugins in the UI (Apps → Plugins), then optionally:
mkdir -p /path/to/praxrr-plugins
export PLUGINS_DIR=/path/to/praxrr-plugins
```

`PLUGINS_ENABLED` accepts `1`, `true`, `yes`, or `on`. `PLUGINS_DIR` is
never auto-created — you must `mkdir` it yourself. (When unset it defaults
to `<APP_BASE_PATH>/plugins`, but the host still will not create it.)

Then copy the plugin directory — the manifest plus the built `plugin.wasm`
— into `PLUGINS_DIR`:

```sh
make install PLUGINS_DIR=/path/to/praxrr-plugins
```

Restart Praxrr so the host re-scans `PLUGINS_DIR` on the next boot.

## Confirm it worked

On boot the host scans each immediate subdirectory of `PLUGINS_DIR` for a
`praxrr.plugin.json` manifest, then _discovers → validates → registers_
the example. Confirm success **only** through the discovery and
registration lines in the logs — the registry stores the plugin in state
`registered`.

Do not expect any output from the plugin itself. Because no WASM runtime
exists yet, an observe dispatch no-ops and logs, at debug level:

```
Plugin runtime unavailable; observe dispatch skipped
```

There is never a log line or side effect implying the guest ran. If you
see the registration in the logs, the walkthrough succeeded.

## What the plugin would observe

Once the Phase-2 runtime lands, a plugin registered for
`sync.previewComputed.observe` would receive a redacted, JSON-safe
snapshot with exactly four fields:

```json
{
  "arrType": "radarr",
  "instanceId": 3,
  "summary": {},
  "sections": []
}
```

This is the `read:sync-preview` allow-list projection over the internal
preview result; every other field is dropped before a plugin could ever
see it. See the [observe snapshot reference](/plugins/observe-snapshot/)
for the exact shape and its guarantees.

## Related

- [Plugin SDK overview](/plugins/)
- [Manifest reference](/plugins/manifest/)
- [Observe snapshot reference](/plugins/observe-snapshot/)
- [WASM Plugin System status in the ROADMAP](https://github.com/yandy-r/praxrr/blob/main/ROADMAP.md)
- [Phase-2 runtime — issue #262](https://github.com/yandy-r/praxrr/issues/262)

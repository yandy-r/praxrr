---
title: 'Plugin SDK'
description: 'Authoring a Praxrr plugin means shipping a praxrr.plugin.json manifest and a WASM module, observe-only in Phase-1.'
---

The Praxrr Plugin SDK lets you package an _observe-only_ extension as a
directory containing a `praxrr.plugin.json` manifest and a WebAssembly
module. This page is the map for the SDK: what a plugin is, what the host
proves today, and where the contract is (and is not) stable.

:::caution[Phase-1 status]
In Phase-1 the host **discovers, validates, and registers** a manifest, and
this works today only when the feature flag `PLUGINS_ENABLED` is set (it is
**off by default**).

**No WebAssembly executes.** The only executor shipped,
`UnavailablePluginExecutor`, rejects every dispatch with
`wasm runtime not yet available`, and observe dispatch no-ops (a debug log,
`Plugin runtime unavailable; observe dispatch skipped`). A registered plugin
is discovered, validated, and registered — but it is **not observed or
executed** until the Phase-2 runtime (issue #262) ships. Everywhere below,
read "would receive (once the Phase-2 runtime lands)", never "receives".
:::

## What a plugin is

A plugin is a directory placed directly under `PLUGINS_DIR`. Each immediate
subdirectory holds exactly one `praxrr.plugin.json` manifest plus the `.wasm`
module named by the manifest's `entry` field. The manifest declares which
extension points the plugin subscribes to and which capabilities it needs.

Plugins are **observe-only** and **deny-by-construction**: the capability
union is closed and read-only, so there is no capability id for credentials,
auth or sessions, secrets, network or HTTP, filesystem, database, or
environment access, nor any write or mutate action. Those grants are
structurally unrepresentable — you cannot even name them in the manifest.

A minimal, valid manifest for the wired preview point looks like this:

```json
{
  "apiVersion": "1",
  "id": "com.example.observer",
  "name": "Example Observer",
  "version": "1.0.0",
  "runtime": "wasm",
  "entry": "plugin.wasm",
  "extensionPoints": ["sync.previewComputed.observe"],
  "capabilities": ["read:sync-preview"]
}
```

See the [Manifest Reference](/plugins/manifest/) for every field, allowed
value, and error code.

## What works today vs. what is pending

Phase-1 reaches only the first three lifecycle stages. The registry only ever
stores plugins in the `registered` state; the later states exist for the
future runtime.

| Stage               | Status                                 |
| ------------------- | -------------------------------------- |
| Discovered          | Works today (behind `PLUGINS_ENABLED`) |
| Validated           | Works today (behind `PLUGINS_ENABLED`) |
| Registered          | Works today (behind `PLUGINS_ENABLED`) |
| Observed (executed) | Pending Phase-2 (#262)                 |

The Phase-2 runtime is a documented, reasoned deferral — not an omission and
not a "never". The evaluated Extism JavaScript SDK on Deno is a no-go for
Praxrr's isolation requirements: it offers no active cancellation, no
fuel/instruction limit, and `memory.maxPages` is not a total-guest-memory cap
(a worker timeout is not fuel). Execution stays deferred until a compliant
backend lands.

## Feature flag and directory

The whole subsystem is off unless you opt in.

- `PLUGINS_ENABLED` — accepts `1`, `true`, `yes`, or `on`; **default off**.
  When off, the host is a hard no-op: `host.initialize` returns immediately
  and never stats `PLUGINS_DIR`.
- `PLUGINS_DIR` — the directory scanned for `praxrr.plugin.json` manifests;
  default `<APP_BASE_PATH>/plugins`. It is **never auto-created**. When
  plugins are enabled but the directory is missing, the host warns and
  degrades to an empty registry rather than failing boot.

Malformed or invalid manifests are skipped and logged; they never abort boot.
The registry is rebuilt from a fresh scan each boot (no database), so an
enable, disable, rollback, or upgrade cannot resurrect a plugin validated
under an incompatible contract version.

## The stable public surface

Some parts of the SDK are stable contract you can build against now; others
are explicitly provisional.

Stable in Phase-1:

- The manifest contract — the exact allowed keys, value rules, and error
  codes accepted by the hand-written validator.
- The two **wired** observe points, `config.profileCompiled.observe` and
  `sync.previewComputed.observe`.
- The capabilities those points consume and the allow-list snapshot shapes
  they would project (once the Phase-2 runtime lands).

Not yet stable:

- The seven declared-but-unwired extension points and any
  capabilities/snapshots tied to them. Dispatching an unwired point throws
  `PluginPointNotWiredError`.
- The host-to-guest ABI. The example's guest export name and its
  argument/return encoding are **provisional** because no runtime ABI is
  finalized. The provable win — discover, validate, and register of the JSON
  manifest — is independent of that ABI.

## Where to go next

Start with the worked example, then drill into each part of the contract:

- [Build and Install the Example](/plugins/example-observer/) — build the
  shipped `sync-preview-observer` with TinyGo and install it locally.
- [Manifest Reference](/plugins/manifest/) — the 11 allowed keys, value
  rules, and every rejection code.
- [Capabilities](/plugins/capabilities/) — the closed, observe-only,
  credential-free capability union.
- [Extension Points](/plugins/extension-points/) — all nine points, their
  kinds, and which two are wired.
- [Observe Snapshots](/plugins/observe-snapshot/) — the allow-list
  projection and the redacted shapes plugins would receive.
- [Lifecycle and Registry](/plugins/lifecycle/) — discovery, validation,
  registration, and graceful degradation.
- [API Versioning](/plugins/versioning/) — single-version support and the
  registry namespace.

These pages must not contradict the authoritative contract mirror, the
internal architecture note at
[docs/architecture/plugins.md](https://github.com/yandy-r/praxrr/blob/main/docs/architecture/plugins.md).
For broader context, see the
[architecture hub](/app/architecture/), the
[configuration guide](/guides/configuration/), and the _WASM Plugin System_
status section of the
[ROADMAP](https://github.com/yandy-r/praxrr/blob/main/ROADMAP.md).

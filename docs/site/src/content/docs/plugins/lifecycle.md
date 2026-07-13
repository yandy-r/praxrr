---
title: 'Lifecycle & Registry'
description: 'How Praxrr discovers, validates, and registers plugins at boot, and how the registry degrades gracefully when plugins are absent or invalid.'
---

Praxrr treats a plugin as a small state machine. In Phase-1 the machine
only ever runs its front half: a plugin is _discovered_ on disk,
_validated_ against the hand-written manifest validator, and then either
_registered_ into an in-memory registry or _rejected_ and skipped. No
plugin code executes yet.

:::caution[Phase-1 status]
Praxrr discovers, validates, and registers plugins today, but it runs
none of them. Phase-1 ships no WASM runtime, so a registered plugin is
never executed — the only executor, `UnavailablePluginExecutor`, rejects
every dispatch with `wasm runtime not yet available`. Read this page as
the contract the future runtime will honor, not as a description of code
executing now.
:::

## Lifecycle states

`PluginLifecycleState` is a closed union of seven values. Phase-1 reaches
only the first four, and the registry only ever _stores_ the
`registered` state. The remaining three — `activated`, `failed`, and
`unloaded` — are declared now so the contract is stable, but they belong
to the future runtime phase and are unreachable today.

| State        | Reached in Phase-1? | Meaning                                             |
| ------------ | ------------------- | --------------------------------------------------- |
| `discovered` | Yes                 | Manifest found and parsed from disk.                |
| `validated`  | Yes                 | Manifest passed the fail-fast validator.            |
| `registered` | Yes (stored)        | Accepted into the registry namespace.               |
| `rejected`   | Yes (terminal)      | Bad or malformed manifest; skipped and logged.      |
| `activated`  | No — Phase-2        | Declared for the future runtime; not reachable yet. |
| `failed`     | No — Phase-2        | Declared for the future runtime; not reachable yet. |
| `unloaded`   | No — Phase-2        | Declared for the future runtime; not reachable yet. |

The Phase-1 path is a straight line with one branch:

```text
discovered -> validated -> registered
                      \--> rejected
```

Each Phase-1 step is deliberately narrow:

- **`discovered`** — The boot-time scan reads each
  `praxrr.plugin.json` from the immediate subdirectories of
  `PLUGINS_DIR`. This scan is the _only_ filesystem boundary the plugin
  host crosses. The manifest's declared `entry` (a `.wasm` path) is
  validated as a string and is never read or executed during discovery.
  See [Manifest](/plugins/manifest/) for the file format.
- **`validated`** — `validatePluginManifest` runs a hand-written,
  fail-fast, multi-error check (no Zod, no JSON Schema). It collects
  every problem for a manifest and returns them together, so an author
  fixes all issues in one pass rather than one at a time.
- **`registered`** — A valid manifest is handed to
  `pluginRegistry.register`, which places it in the registry under its
  `apiVersion` namespace keyed by lowercased id.
- **`rejected`** — A bad or malformed manifest is a _terminal_ outcome:
  the plugin is skipped and the reason is logged. Rejection never aborts
  boot; the scan moves on to the next candidate.

:::note[Two `registered`/`rejected` types]
The host also has an internal `EntryOutcome` of `'registered' |
'rejected'` that reports the result of processing one directory entry.
It is a separate type from `PluginLifecycleState` — do not conflate the
per-entry outcome with the stored lifecycle state.
:::

## The registry

The dispatch registry is an in-memory, `apiVersion`-namespaced map —
conceptually `Map<apiVersion, Map<lowercased-id, RegisteredPlugin>>`. It is the
snapshot the host reads when dispatching an observe point, and it is rebuilt
from a fresh scan on every boot (each scan atomically replaces the previous
snapshot).

A separate durable store (App SQLite, added by the management backend) records
validated-manifest metadata and enablement intent and is reconciled against on
each scan, so an operator's enable/disable decision survives restarts. That
durable layer and its management API are outside the authoring contract this
guide covers; nothing you write in a manifest depends on it. What matters for
authoring is unchanged: your plugin is discovered, validated, and registered
into the in-memory dispatch snapshot described here.

Key properties of the dispatch registry:

- **Namespaced by `apiVersion`.** The outer map is keyed by the
  manifest's `apiVersion` (the string `'1'` in Phase-1). Because the
  namespace _is_ the contract version, an enable, disable, rollback, or
  upgrade can never resurrect a plugin validated under an incompatible
  version. See [Versioning](/plugins/versioning/).
- **Case-insensitive id uniqueness within a namespace.** Ids are stored
  lowercased, so two plugins whose ids differ only in case collide. A
  duplicate id inside a namespace is rejected and logged — it never
  aborts boot; the first registration wins and the later one is dropped.
- **`listForPoint(apiVersion, point)`** returns the registered plugins in
  that namespace whose declared `extensionPoints` include the requested
  point. The host uses this to find observers for a wired dispatch site.
  See [Extension points](/plugins/extension-points/) for the point ids
  and their wiring status.

## Graceful degradation

The plugin subsystem is off by default and is engineered so that a bad
plugin, a missing directory, or a disabled flag can never destabilize
boot or affect another plugin.

- **Disabled — a hard no-op.** When plugins are disabled in the UI (or not
  one of `1`, `true`, `yes`, `on`), `host.initialize` returns
  immediately. It never even stats `PLUGINS_DIR`.
- **Enabled but the directory is missing.** The host warns and degrades
  to an empty registry. `PLUGINS_DIR` (default
  `<APP_BASE_PATH>/plugins`) is never auto-created.
- **Invalid manifests are skipped.** A malformed or invalid manifest is
  logged and skipped; the scan continues. One broken manifest cannot
  block the others or fail app startup.
- **Bounded, isolated dispatch.** Once a Phase-2 runtime exists, each
  per-plugin dispatch is bounded by a finite `AbortSignal` timeout,
  `OBSERVE_DISPATCH_TIMEOUT_MS = 5000` ms. Dispatch failures never
  propagate: a runtime-unavailable result is logged at debug, and any
  other throw is logged at warn. One plugin can never destabilize boot
  or another plugin.

Today, because there is no runtime, every observe dispatch resolves to
the runtime-unavailable path. A registered plugin _would_ receive a
redacted, allow-listed snapshot once the Phase-2 runtime lands — it does
not receive anything now.

:::note[Runtime is deferred by design]
No plugin code executes in Phase-1, so `activated`, `failed`, and
`unloaded` are unreachable — they exist only to keep the lifecycle
contract stable for the future runtime. The Phase-2 WASM runtime is a
reasoned deferral, not an omission: the evaluated Extism JavaScript SDK
on Deno offers no active cancellation, no fuel or instruction limit, and
`memory.maxPages` is not a total-guest-memory cap (a worker timeout is
not fuel). The runtime stays deferred until a compliant backend lands.
:::

---
title: 'Extension Points'
description: 'How Praxrr declares nine plugin extension points but wires only a safe, observe-only subset at the host dispatch seam.'
---

The plugin contract _declares_ all nine extension points as a closed union, but
Phase-1 _wires_ only a small, observe-only subset at the host dispatch seam.
Wiring is what connects a declared point to a real producer inside Praxrr: an
unwired point has a descriptor but no call site that ever reaches it.

## Wired vs declared

The host entry, `notifyObservers(point, buildInput)`, throws
`PluginPointNotWiredError` unless the point's descriptor is both `wired` and
`kind === 'observe'`. Dispatching a declared-but-unwired point therefore throws
before it can reach a plugin — there is no silent fallback.

Registration is independent of wiring. A plugin that declares an unwired point
still discovers, validates, and registers fine; the point simply never
dispatches. Wiring is a host-side concern, so widening the wired set is a
deliberate change, not something a manifest can opt into.

## Catalog

All nine points in stable order. Exactly `config.profileCompiled.observe` and
`sync.previewComputed.observe` are wired in Phase-1; the other seven are
declared but unwired and throw `PluginPointNotWiredError` if dispatched.

| Extension point                   | Kind      | Wired (Phase-1) | Grantable capability     | Notes                                                                                         |
| --------------------------------- | --------- | --------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| `config.profileCompiled.observe`  | observe   | Yes             | `read:resolved-profile`  | Fires at quality-profile compile.                                                             |
| `sync.previewComputed.observe`    | observe   | Yes             | `read:sync-preview`      | Fires in the sync-preview create handler, after the preview is built and before apply.        |
| `config.validation.observe`       | observe   | No              | `read:config-validation` | Declared only; dispatch throws `PluginPointNotWiredError`.                                    |
| `sync.beforeApply.observe`        | observe   | No              | `read:sync-preview`      | Declared only; dispatch throws `PluginPointNotWiredError`.                                    |
| `sync.afterApply.observe`         | observe   | No              | `read:sync-preview`      | Declared only; dispatch throws `PluginPointNotWiredError`.                                    |
| `parser.releaseTitle.transform`   | transform | No              | —                        | Mutates output; no grantable Phase-1 capability.                                              |
| `customFormat.condition.evaluate` | provider  | No              | `read:custom-format`     | Declared only; dispatch throws `PluginPointNotWiredError`.                                    |
| `notification.dispatch.observe`   | provider  | No              | —                        | Kind `provider` despite the `.observe` suffix — not an observe hook; no grantable capability. |
| `importExport.adapter`            | provider  | No              | —                        | Mutates output; no grantable Phase-1 capability.                                              |

Two catalog details are easy to misread:

- `notification.dispatch.observe` is kind `provider` even though its id ends in
  `.observe`. It is _not_ an observe hook: `notifyObservers` rejects it on the
  `kind === 'observe'` check, so it would never dispatch as an observer even if
  it were wired.
- The transform and provider points — `parser.releaseTitle.transform`,
  `importExport.adapter` (both mutating), and `notification.dispatch.observe` —
  have **no** grantable Phase-1 capability (`requiredCapability` is `null`).
  There is no capability string a manifest can declare to consume them.

## The wired observe points

Exactly two points are wired in Phase-1, both observe-only:

- `config.profileCompiled.observe` fires in the quality-profile syncer at
  compile time. A granted plugin _would receive_ (once the Phase-2 runtime
  lands) a redacted `read:resolved-profile` snapshot of the freshly compiled
  profile.
- `sync.previewComputed.observe` fires in the API sync-preview create handler,
  after the preview is built and before any apply. A granted plugin _would
  receive_ (once the Phase-2 runtime lands) a redacted `read:sync-preview`
  snapshot of the computed preview.

Both wire sites are guarded by `if (config.pluginsEnabled)` and wrap the
dispatch in an inner `try`/`catch` that fails open. A plugin throw or timeout is
swallowed and logged, never re-raised, so a plugin can never alter the compiled
output, mutate the preview, or block an apply. Observation is strictly a side
channel off the real code path.

:::note[Phase-1 executes no plugin code]
Even the two wired points run no plugin code in Phase-1. The only executor,
`UnavailablePluginExecutor`, rejects every dispatch with `wasm runtime not yet
available`, so each wired site no-ops (debug log `Plugin runtime unavailable;
observe dispatch skipped`). A registered plugin _would receive_ its redacted
snapshot only once the Phase-2 runtime lands. See
[capabilities](/plugins/capabilities/) for what each grant projects, the
[observe snapshot](/plugins/observe-snapshot/) for the exact shape crossing the
seam, and the [lifecycle](/plugins/lifecycle/) for how a plugin reaches the
`registered` state that wiring dispatches to.
:::

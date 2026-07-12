---
title: 'Observe Snapshots'
description: 'How Praxrr projects an allow-listed, JSON-safe snapshot for observe plugins, and what the sync.previewComputed hook would expose.'
---

Observe plugins never touch Praxrr's live domain objects. At each wired
observe point the host builds a small, JSON-safe _snapshot_ by copying
only allow-listed fields, then hands that snapshot across the plugin
seam. This page defines the snapshot value type, the two layers that
protect it, and the exact shape the `sync.previewComputed.observe` point
would expose.

:::caution[Phase-1 status: no runtime executes]

Praxrr Phase-1 ships **no WASM runtime**. The only executor,
`UnavailablePluginExecutor`, rejects every dispatch with
`wasm runtime not yet available`. A registered plugin is discovered,
validated, and registered but is **never executed**. Everything below
describes what a plugin _would receive_ once the Phase-2 runtime lands —
a runtime that stays deliberately deferred (see the
[architecture note](https://github.com/yandy-r/praxrr/blob/main/docs/architecture/plugins.md)
and issue #262). The whole subsystem is off unless `PLUGINS_ENABLED` is
set.

:::

## PluginJsonValue

`PluginJsonValue` is the **only** shape allowed to cross the plugin
seam. It is recursive and structured-clone / JSON-safe by construction —
no functions, class instances, `Date`s, or cyclic references survive.

```ts
type PluginJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly PluginJsonValue[]
  | { readonly [key: string]: PluginJsonValue };
```

Every snapshot the host produces, and every value a plugin returns, must
conform to this type.

## Two layers of protection

Two independent mechanisms guard the seam, applied **in this order**.

1. **Allow-list projection (`buildCapabilityInput`) — the primary,
   structural guarantee.** This runs first. It copies **only** the
   allow-listed top-level fields that are actually present on the source
   into a fresh, JSON-safe snapshot. Because the projection copies field
   by field, plugins **never** receive live domain objects, DB rows,
   config, environment values, or any credential-bearing value — those
   fields simply are not on any allow-list, so they are never copied. The
   projection returns `null` when the capability has no allow-list, the
   source is not a plain object, or none of the allow-listed fields are
   present.

2. **`scrubPluginBoundary` (== `redactSecrets`) — defense-in-depth
   _only_.** After projection, the host runs a key-suffix heuristic over
   the snapshot. It replaces **only string values** whose key ends in a
   secret-shaped suffix — `api_key`, `token`, `secret`,
   `password`/`passwd` (including `password_hash`), `credential`, or
   `authorization` — with `[REDACTED]`.

:::caution[Do not rely on redaction]

`scrubPluginBoundary` is a heuristic backstop, not a data-access control.
It **cannot** catch a secret stored in a benign-named field, and it
**cannot** catch a secret embedded in a URL query string. The allow-list
projection is what actually keeps secrets off the seam; redaction only
scrubs a narrow, well-named residue.

:::

## The sync.previewComputed snapshot

The `sync.previewComputed.observe` point is wired: it fires in the API
sync-preview create handler after the preview is built and before any
apply. A plugin that declares `read:sync-preview` **would receive**
(once the Phase-2 runtime lands) exactly the `read:sync-preview`
projection over the internal `GeneratePreviewResult` — that is, exactly
these four fields:

```json
{
  "arrType": "radarr",
  "instanceId": 3,
  "summary": {
    "totalChanges": 4,
    "creates": 2,
    "updates": 2,
    "deletes": 0
  },
  "sections": [
    {
      "kind": "customFormats",
      "label": "Custom Formats",
      "changes": [
        { "op": "create", "name": "HDR10+" },
        { "op": "update", "name": "Dolby Vision" }
      ]
    }
  ]
}
```

Every other `GeneratePreviewResult` field is **dropped** because it is
not on the allow-list:

- `instanceName`
- `status`
- `createdAtMs`
- `sectionOutcomes`
- `qualityProfiles`
- `delayProfiles`
- `mediaManagement`
- `metadataProfiles`

## Capability field allow-lists

`CAPABILITY_FIELD_ALLOWLIST` maps each capability to the top-level fields
its projection may copy. Capabilities marked _provisional_ back
extension points that are declared but not yet wired.

| Capability               | Allow-listed top-level fields                         | Status                |
| ------------------------ | ----------------------------------------------------- | --------------------- |
| `read:resolved-profile`  | `arrType`, `id`, `name`, `qualities`, `customFormats` | wired                 |
| `read:sync-preview`      | `arrType`, `instanceId`, `summary`, `sections`        | wired                 |
| `read:custom-format`     | `formatId`, `name`, `specifications`                  | provisional (unwired) |
| `read:config-validation` | `valid`, `issues`, `entity`                           | provisional (unwired) |

See [/plugins/capabilities/](/plugins/capabilities/) for the full
capability descriptors and
[/plugins/extension-points/](/plugins/extension-points/) for which points
each capability may attach to.

## Dispatch guarantees

Every per-plugin dispatch is bounded by a finite `AbortSignal` timeout,
`OBSERVE_DISPATCH_TIMEOUT_MS = 5000` (5000 ms). Observe dispatch is
strictly fire-and-observe: a plugin throw, rejection, or timeout **never
propagates** and can never alter host output or block an apply. Both wire
sites are guarded by `if (config.pluginsEnabled)` with an inner
`try`/`catch`.

In Phase-1, because no runtime is present, **every** dispatch settles as
runtime-unavailable and is swallowed (logged at debug:
`Plugin runtime unavailable; observe dispatch skipped`). Any other throw
is logged at warn. No snapshot is ever actually delivered today — the
projection and scrub logic are exercised only once the Phase-2 runtime
lands.

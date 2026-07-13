---
title: 'Capabilities & Least Privilege'
description: 'How Praxrr plugins declare a closed set of four observe-only, credential-free read capabilities enforced by least privilege.'
---

Capabilities are the data-access contract for a Praxrr plugin. Each id a
manifest declares authorizes exactly one redacted, structured-clone-safe
snapshot and nothing else. The set is closed and deny-by-construction:
there is no capability id that could grant credentials, network access,
or a write, so those grants cannot even be spelled.

:::caution[No plugin runs in Phase-1]
Phase-1 ships no WASM runtime. A discovered plugin is validated and
registered but never executed — the only executor,
`UnavailablePluginExecutor`, rejects every dispatch with
`wasm runtime not yet available`. Capabilities describe what a plugin
_would_ receive once the Phase-2 runtime lands, not data any plugin
observes today. The subsystem is also off by default: set
the UI **Enable plugins** control to enable discovery and
registration.
:::

## The capability model

Capabilities are a closed set of **four** observe-only, credential-free
reads. Every capability descriptor pins `mutates: false` and
`touchesSecrets: false` as literals — a plugin can never mutate the data
it is handed, and no capability touches secret-bearing values.

There is deliberately **no** capability for credentials, auth/session,
secrets, network/HTTP, filesystem, database access, environment, or any
write/mutate action. Those grants are structurally unrepresentable: the
union has no id to name them, so a manifest cannot request them. An
unknown capability string is not silently ignored — the validator
rejects it with code `unknown_capability`.

Deny-by-construction reaches the extension points too. The transform and
mutating provider points (`parser.releaseTitle.transform`,
`notification.dispatch.observe`, `importExport.adapter`) carry
`requiredCapability: null` — there is no grantable capability that
authorizes them, so no capability string can unlock a write path. See
[Extension points](/plugins/extension-points/) for the full point
catalog.

## Catalog

Exactly four capabilities exist. Only the first two are consumed by a
wired extension point today; the other two are placeholders for points
that are declared but not yet wired.

| Capability               | Label                  | What it observes                                                                                        | Compatible extension point(s)                                                         | Wired?                                        |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------- |
| `read:resolved-profile`  | Read resolved profile  | Observe a redacted, structured-clone-safe snapshot of a freshly compiled quality/custom-format profile. | `config.profileCompiled.observe`                                                      | Yes                                           |
| `read:sync-preview`      | Read sync preview      | Observe a redacted sync-preview/intent/summary snapshot; never mutates the preview or apply.            | `sync.previewComputed.observe`, `sync.beforeApply.observe`, `sync.afterApply.observe` | Yes — only via `sync.previewComputed.observe` |
| `read:custom-format`     | Read custom format     | Observe a redacted custom-format condition snapshot for evaluation.                                     | `customFormat.condition.evaluate`                                                     | No (placeholder)                              |
| `read:config-validation` | Read config validation | Observe a redacted config-validation result snapshot.                                                   | `config.validation.observe`                                                           | No (placeholder)                              |

`read:sync-preview` lists three compatible points, but only
`sync.previewComputed.observe` is wired; the `beforeApply` and
`afterApply` points are declared-but-unwired and would throw
`PluginPointNotWiredError` if dispatched.

The projection a plugin would receive per capability — for example the
`read:sync-preview` snapshot of exactly `{ arrType, instanceId,
summary, sections }` — is documented on the
[Observe snapshot](/plugins/observe-snapshot/) page. That allow-list
projection is the primary, structural data-access guarantee; a
key-suffix redaction pass runs afterward only as defense-in-depth.

## Least privilege

Every declared capability must be consumable by at least one extension
point **also declared in the same manifest**. If a capability has no
matching point in the manifest, validation fails with code
`least_privilege` and the message _capability &lt;id&gt; is not
consumable by any declared extension point_.

This blocks over-broad grants: you cannot request read access to data
that none of your declared hooks would ever be handed.

A concrete rejection — declaring `read:custom-format` alongside only
`config.profileCompiled.observe`:

```json
{
  "extensionPoints": ["config.profileCompiled.observe"],
  "capabilities": ["read:custom-format"]
}
```

`read:custom-format` is only consumable by
`customFormat.condition.evaluate`, which this manifest does not declare,
so the whole manifest is rejected with `least_privilege`. Pairing the
capability with its consuming point (or dropping the unused capability)
resolves it.

## Declaring capabilities

`capabilities` is a top-level manifest array. It **may be empty** — a
plugin can declare extension points and request no data — but every
entry it does contain must be a known capability id from the catalog
above. An unrecognized id is rejected `unknown_capability`; an empty
capabilities array trivially satisfies least privilege.

A minimal valid manifest for the wired preview point pairs one point
with its one consuming capability:

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

See [Manifest reference](/plugins/manifest/) for the full set of
allowed keys and validation codes, and
[Extension points](/plugins/extension-points/) for which points consume
which capability.

:::note[Placeholder allow-lists are provisional]
The runtime field allow-lists for the two unwired capabilities
(`read:custom-format` and `read:config-validation`) are provisional and
may change before their extension points are wired. Only
`read:resolved-profile` and `read:sync-preview` back a wired point today.
:::

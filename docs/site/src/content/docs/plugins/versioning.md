---
title: 'API Versioning & Stability'
description: 'How Praxrr pins the plugin contract to PLUGIN_API_VERSION 1, what is stable today, and why the Phase-2 runtime stays deferred.'
---

The plugin contract is versioned so that a manifest is only ever registered
against a contract it was actually validated for. Phase-1 ships a single,
strict version — there is no negotiation, no runtime, and no way for a
rollback or upgrade to smuggle a plugin across an incompatible contract line.

## PLUGIN_API_VERSION

`PLUGIN_API_VERSION` is the string `'1'`, declared once as the canonical
contract version. `SUPPORTED_PLUGIN_API_VERSIONS` is the list `['1']`.

Phase-1 is strict single-version support: the host never negotiates a
version. A manifest whose `apiVersion` is not exactly the string `'1'` — for
example the number `1` or the string `'2'` — is a hard reject with error code
`unsupported_api_version` (message `apiVersion must be one of: 1`). There is
no coercion from a numeric `1`; the value must be the string `'1'`.

## Namespacing & rollback safety

`apiVersion` is not only validated — it is also the registry _namespace key_.
The registry is an `apiVersion`-namespaced in-memory map, so a plugin that was
validated under one contract version can never appear in the namespace of
another. This is what makes enable, disable, rollback, and upgrade safe: none
of those operations can resurrect a plugin that was validated under an
incompatible contract version, because its registration lives under a
different `apiVersion` key entirely.

The same rule extends forward. Any future result cache is namespaced by the
pair `(apiVersion, plugin.version)`, so a contract bump or a plugin version
change cannot reuse cached output produced under different assumptions.

## engines.praxrr

`engines.praxrr` is an optional advisory host-version constraint. When
present it must be a non-empty string, and it is recorded on the registered
plugin — but it is **not** enforced in Phase-1. Despite any "semver range"
phrasing, no semver parsing happens; the host reads and stores the value and
takes no action on it. Treat it as documentation of intent, not a gate.

## Stability promise

What is stable today is exactly the surface the hand-written validator accepts
and the two extension points that are wired to real producers. Everything else
is explicitly provisional and may change without a version bump — until it is
promoted, at which point promotion itself is a version bump.

### Stable today

| Surface                          | Detail                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Manifest contract                | The `praxrr.plugin.json` shape validated on discovery.                                                                  |
| `config.profileCompiled.observe` | Wired observe point, capability `read:resolved-profile`, snapshot fields `arrType, id, name, qualities, customFormats`. |
| `sync.previewComputed.observe`   | Wired observe point, capability `read:sync-preview`, snapshot fields `arrType, instanceId, summary, sections`.          |

These two points are wired to real producers, so a registered plugin _would
receive_ the projected snapshot shown above once the Phase-2 runtime lands.
Nothing executes today.

### Not yet stable

- The 7 declared-but-unwired extension points. They are part of the closed
  union for planning, but dispatching them throws `PluginPointNotWiredError`.
- The two unwired capabilities and their provisional field allow-lists:
  `read:custom-format` (`formatId, name, specifications`) and
  `read:config-validation` (`valid, issues, entity`).
- The host-to-guest invocation ABI. No WASM runtime exists yet, so the guest
  export name and its argument/return encoding are not finalized.

Adding a grantable capability — or otherwise widening the contract — is a
deliberate, test-guarded change that bumps `PLUGIN_API_VERSION`. The version
string is the signal that the projected snapshots, capability set, or
extension-point surface a plugin can rely on has changed.

:::caution[Phase-2 runtime status]
Phase-1 ships **no** WASM runtime, so no plugin executes. The Phase-2 runtime
is a documented NO-GO for the evaluated Extism JavaScript SDK on Deno
([issue #262](https://github.com/yandy-r/praxrr/issues/262)): no active
cancellation, no fuel or instruction limit, and `memory.maxPages` is not a
total-guest-memory cap (a worker timeout is not fuel). It stays deferred until
a compliant backend lands — a reasoned decision, not an omission. Track it via
the WASM Plugin System status section in the repo `ROADMAP.md`. For the shape
of the subsystem that _is_ shipped, see the [plugin SDK overview](/plugins/)
and the [example observer](/plugins/example-observer/).
:::

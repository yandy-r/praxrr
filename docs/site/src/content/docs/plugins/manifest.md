---
title: 'Plugin Manifest Reference'
description: 'Reference for praxrr.plugin.json: its 11-key schema, validation rules, and error codes.'
---

Every Praxrr plugin is described by a single `praxrr.plugin.json` file. The
host reads this manifest, validates it against a closed contract, and — when it
passes — registers the plugin under its declared API version. The manifest is
the entire Phase-1 contract surface: it is discovered, validated, and
registered by a pure, hand-written validator (no Zod, no JSON Schema).

:::note[Phase-1 status]
A registered plugin is discovered, validated, and registered, but it is
_never_ executed. Phase-1 ships no WASM runtime — the only executor,
`UnavailablePluginExecutor`, rejects every dispatch with `wasm runtime not yet
available`. A valid manifest means the plugin _would_ receive observe input
once the Phase-2 runtime lands, not that anything runs today. The subsystem is
also off by default: enable plugins in the UI (Apps → Plugins), or
`on`) to enable it. See [/plugins/lifecycle/](/plugins/lifecycle/) and
[/plugins/versioning/](/plugins/versioning/) for the surrounding model.
:::

## Location

Place exactly one `praxrr.plugin.json` in each immediate subdirectory of
`PLUGINS_DIR` (default `<APP_BASE_PATH>/plugins`, never auto-created).

## Fields

There are exactly 11 allowed top-level keys: 8 required and 3 optional.

| Key               | Required | Type   | Rules                                                                                                                                                                                                                                        |
| ----------------- | -------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiVersion`      | Yes      | string | Must equal the string `'1'` (the only supported value). Numeric `1` or a string `'2'` are rejected. Missing → `missing`; any other value → `unsupported_api_version`.                                                                        |
| `id`              | Yes      | string | Reverse-DNS slug matching `^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$`: lowercase, dot-separated segments, each starting and ending alphanumeric, internal hyphens allowed. e.g. `com.example.observer`.              |
| `name`            | Yes      | string | Non-empty. Persisted _untrimmed_ (surrounding whitespace is preserved).                                                                                                                                                                      |
| `version`         | Yes      | string | Non-empty. _Not_ semver-checked — any non-empty string passes.                                                                                                                                                                               |
| `runtime`         | Yes      | string | Must equal the literal `'wasm'`.                                                                                                                                                                                                             |
| `entry`           | Yes      | string | Non-empty _relative_ path ending in `.wasm`. Absolute paths (leading `/`), Windows drive paths (`^[A-Za-z]:`), backslashes, and any `..` segment are rejected. The file is validated as a string — never read or executed during validation. |
| `extensionPoints` | Yes      | array  | Non-empty array of known [extension-point](/plugins/extension-points/) ids.                                                                                                                                                                  |
| `capabilities`    | Yes      | array  | Array of known [capability](/plugins/capabilities/) ids. May be empty.                                                                                                                                                                       |
| `description`     | No       | string | Optional free-form string. Wrong type → `invalid_type`.                                                                                                                                                                                      |
| `author`          | No       | string | Optional free-form string. Wrong type → `invalid_type`.                                                                                                                                                                                      |
| `engines`         | No       | object | Optional object with an optional `engines.praxrr` non-empty string. Advisory only — recorded, not enforced (no semver parsing happens).                                                                                                      |

:::note
Unknown top-level keys are rejected with `unknown_key`. There are no
`license`, `homepage`, or `keywords` fields — anything outside the 11 keys
above fails validation.
:::

## Minimal valid manifest

This is the smallest manifest the validator accepts, targeting the wired
sync-preview observe point:

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

See [/plugins/example-observer/](/plugins/example-observer/) for a shipped
plugin built on exactly this shape.

## Validation & error codes

The validator is pure and multi-error fail-fast: a single pass accumulates
_all_ field errors rather than stopping at the first, so one run reports every
problem in the manifest at once.

| Code                      | Meaning                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `invalid_type`            | A value has the wrong JSON type — including a whole non-object manifest (field `''`).              |
| `unknown_key`             | A top-level key that is not one of the 11 allowed keys.                                            |
| `missing`                 | A required key is absent.                                                                          |
| `empty`                   | A required string is present but empty.                                                            |
| `unsupported_api_version` | `apiVersion` is present but not exactly the string `'1'`.                                          |
| `invalid_format`          | A value fails its format rule (`id` regex, `runtime` not `'wasm'`, or `entry` not ending `.wasm`). |
| `unsafe_entry`            | `entry` is absolute, a Windows drive path, contains backslashes, or has a `..` segment.            |
| `unknown_extension_point` | An `extensionPoints[i]` is not a known extension-point id.                                         |
| `unknown_capability`      | A `capabilities[i]` is not a known capability id.                                                  |
| `least_privilege`         | A declared capability is not consumable by any declared extension point (see below).               |
| `too_long`                | A string field exceeds its length cap (see below).                                                 |
| `too_many_items`          | `extensionPoints` or `capabilities` has more entries than the catalog defines.                     |

Each string field has a finite length cap, and the two arrays are bounded by
the size of their catalogs: `apiVersion` ≤ 32, `id` ≤ 253, `name` ≤ 256,
`version` ≤ 128, `entry` ≤ 1024, `description` ≤ 2048, `author` ≤ 256,
`engines.praxrr` ≤ 256 characters; `extensionPoints` ≤ 9 and `capabilities` ≤ 4
items. Over-length values are rejected with `too_long`, and over-long arrays
with `too_many_items`.

## Least privilege

Every declared capability must be consumable by at least one extension point
_also declared in the same manifest_. If a manifest grants a capability that
none of its extension points can use, validation fails with `least_privilege`
("capability `<id>` is not consumable by any declared extension point"). This
keeps grants minimal — a plugin cannot request access it has no wired point to
consume. See [/plugins/capabilities/](/plugins/capabilities/) for the closed
capability union and which extension points consume each one.

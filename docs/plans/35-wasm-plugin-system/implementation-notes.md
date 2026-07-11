# Implementation Notes — Plugin System Phase-1 (issue #35)

Authoritative, binding implementation spec for the coding agents. Read this together
with `plan.md` (batch table + pinned mapping) and the design JSON. Everything here
overrides any looser wording elsewhere.

## Global rules

- Feature-flagged (`PLUGINS_ENABLED`, default **OFF**), fully decoupled foundation.
  **No** Extism/WASM dependency, **no** WASM execution, **zero** call-sites in the
  sync/compile/parser pipeline.
- Strict typing — no `any`, no unchecked `unknown` leaking past a validated boundary.
- Formatting: match `.prettierrc` (2-space indent, single quotes, semicolons). Do
  **not** trust CLAUDE.md's tabs/100-width note.
- File doc-comment header style like `packages/praxrr-app/src/lib/server/mcp/types.ts`
  (short module purpose, reference the design doc).
- ~500-line soft cap per file. DRY, single-responsibility.

## Binding TypeScript gotchas (from the adversarial critique)

1. **`.includes()` literal-union narrowing (TS2345).** Calling `.includes(someString)`
   on a `readonly CapabilityId[]` / `readonly ExtensionPointId[]` / `readonly ['1']`
   fails `deno check` because the parameter type is the literal-union element, not
   `string`. Use the repo idiom from `mcp/protocol.ts`: assign the readonly-literal
   array to a `readonly string[]` local, then call `.includes(raw)` — or a
   `(x): x is CapabilityId` type guard. Apply in the validator for
   `SUPPORTED_PLUGIN_API_VERSIONS`, `CAPABILITY_IDS`, and `EXTENSION_POINT_IDS`.
2. **Catalog literal widening.** Declare `export const CAPABILITY_CATALOG: readonly CapabilityDescriptor[] = [...]`
   and `export const EXTENSION_POINTS: readonly ExtensionPointDescriptor[] = [...]`
   **with the explicit interface annotation** so the literal `mutates: false` /
   `touchesSecrets: false` fields do not widen to `boolean`.
3. `export const PLUGIN_API_VERSION = '1'` (bare, type `'1'`);
   `export const SUPPORTED_PLUGIN_API_VERSIONS = ['1'] as const`.

## Pinned capability to extension-point mapping (both files MUST agree; a test enforces it)

Capabilities (4, all observe/read-only, every descriptor `{ mutates: false, touchesSecrets: false }`):

| CapabilityId             | compatiblePoints                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `read:resolved-profile`  | `config.profileCompiled.observe`                                                      |
| `read:sync-preview`      | `sync.previewComputed.observe`, `sync.beforeApply.observe`, `sync.afterApply.observe` |
| `read:custom-format`     | `customFormat.condition.evaluate`                                                     |
| `read:config-validation` | `config.validation.observe`                                                           |

Extension points (9):

| id                                | kind      | wired    | mutates | requiredCapability       |
| --------------------------------- | --------- | -------- | ------- | ------------------------ |
| `config.profileCompiled.observe`  | observe   | **true** | false   | `read:resolved-profile`  |
| `sync.previewComputed.observe`    | observe   | **true** | false   | `read:sync-preview`      |
| `config.validation.observe`       | observe   | false    | false   | `read:config-validation` |
| `sync.beforeApply.observe`        | observe   | false    | false   | `read:sync-preview`      |
| `sync.afterApply.observe`         | observe   | false    | false   | `read:sync-preview`      |
| `parser.releaseTitle.transform`   | transform | false    | true    | `null`                   |
| `customFormat.condition.evaluate` | provider  | false    | false   | `read:custom-format`     |
| `notification.dispatch.observe`   | provider  | false    | false   | `null`                   |
| `importExport.adapter`            | provider  | false    | true    | `null`                   |

- `checkCapabilityGrant(point, cap) = getCapability(cap)?.compatiblePoints.includes(point) ?? false`.
  It lives in `capabilities.ts`, which is the **sole** source of the map — do **not**
  import `extensionPoints.ts` into `capabilities.ts` (avoids a cycle).
- No read capability lists a `mutates: true` (transform) point — that structural fact
  is asserted by a test.
- Least-privilege: each requested capability `C` must be consumable by at least one
  declared point `P` (`checkCapabilityGrant(P, C)`), else the manifest is rejected. A
  manifest declaring `parser.releaseTitle.transform` + `read:sync-preview` is therefore
  **rejected**. A plugin may declare a point with zero capabilities (allowed, never
  dispatched).
- Each extension point stamps `apiVersion = PLUGIN_API_VERSION` and `interfaceVersion = '1'`.

## Manifest schema + validator

Manifest file per plugin subdir: `praxrr.plugin.json`.

Fields: `apiVersion` (must be in `SUPPORTED_PLUGIN_API_VERSIONS`, strict, no
negotiation), `id` (reverse-dns slug, non-empty, case-insensitive-unique within an
apiVersion namespace), `name` (non-empty, persisted untrimmed), `version` (non-empty
semver-ish), `runtime` (`'wasm'` only), `entry` (must end `.wasm`; reject absolute
paths, Windows drive `C:\`, and `..` traversal — never read/execute in Phase-1),
`extensionPoints` (non-empty, every id in `EXTENSION_POINT_IDS`), `capabilities`
(every id in `CAPABILITY_IDS` + least-privilege check), optional `description`,
`author` (no trust semantics), `engines.praxrr`.

- Reject **unknown top-level keys** (fail-closed).
- `validatePluginManifest(raw: unknown): ManifestValidationResult` is **pure**
  (no I/O, no `Deno.env`), accumulates **all** `PluginManifestIssue` errors in one
  pass, returns `{ ok: true, manifest } | { ok: false, errors }`.

## Server modules

- `errors.ts` — mirror `mcp/errors.ts`. Classes (each sets `this.name`):
  `PluginManifestError` (carries `readonly issues: PluginManifestIssue[]`),
  `PluginValidationError`, `PluginCapabilityDeniedError`, `PluginPointNotWiredError`,
  `PluginRuntimeUnavailableError` (constructor defaults message to
  `'wasm runtime not yet available'`), `PluginExecutionError`. Doc: SKIP (manifest)
  vs THROW (execution) errors are never conflated.
- `registry.ts` — `RegisteredPlugin { manifest, sourceDir, state, registeredAt, lastError? }`
  - `PluginRegistry` over nested `Map<apiVersion, Map<lowercased id, RegisteredPlugin>>`:
    `register` (throws on case-insensitive duplicate id within a namespace),
    `unregister`, `get`, `listByApiVersion`, `listForPoint`, `clear`; `pluginRegistry`
    singleton. Imports nothing from executor/host. `registeredAt = new Date().toISOString()`.
- `executor.ts` — the swappable seam. `PluginInvocationMeta`, `PluginExecutionRequest`
  `{ plugin (import type from ./registry.ts), point, input: PluginJsonValue, signal: AbortSignal }`,
  `PluginExecutor.execute(req): Promise<PluginJsonValue>`, and
  `UnavailablePluginExecutor` whose `execute` rejects with `PluginRuntimeUnavailableError`.
  **No** Extism/WASM import anywhere. The `RegisteredPlugin` import is `import type` only.
- `hostContext.ts` — sole domain-data projection.
  `buildCapabilityInput(capability, source): PluginJsonValue` copies only a minimal
  JSON-safe allow-list of top-level fields per capability
  (`read:resolved-profile` -> `[profileId, name, qualities, customFormatScores]`,
  `read:sync-preview` -> `[summary, changeCount, entities, instanceId]`,
  `read:custom-format` -> `[formatId, name, specifications]`,
  `read:config-validation` -> `[valid, issues, entity]` — illustrative/minimal, no live
  producer in Phase-1). `scrubPluginBoundary(value)` runs `redactSecrets` (import
  `redactSecrets`, `SECRET_KEY_PATTERN` from `../mcp/redact.ts`). Doc: the allow-list
  is the **primary** guarantee; redaction is defense-in-depth (redactSecrets is
  heuristic — key-suffix only).
- `scan.ts` — isolated fs boundary. `RawManifestEntry { dir, raw?, parseError? }`,
  `ScanDeps { readDir, readTextFile }` defaulting to Deno's (dependency injection so
  the rethrow test can inject a thrower). `scanPluginDir(dir, deps?)` reads each
  immediate subdir's `praxrr.plugin.json`, JSON-parses into `raw`, captures
  `parseError` on bad JSON, skips subdirs with no manifest, rethrows only **unexpected**
  fs errors (not `Deno.errors.NotFound`). `const MAX_PLUGIN_DIRS = 256` truncates +
  `logger.warn` when exceeded, never throws.
- `host.ts` — `PluginHost` (constructor executor injection default
  `new UnavailablePluginExecutor()`, `setExecutor`, `initialize`, `notifyObservers`,
  `reset`) + `pluginHost` singleton.
  - `initialize()`: no-op + info-log when `!config.pluginsEnabled`; else stat
    `config.paths.plugins` (warn + degrade to empty registry on `Deno.errors.NotFound`),
    scan -> validate -> register valid / skip + log invalid, end with a `logger.info`
    summary `{ enabled, discovered, registered, rejected }`. Never throws to abort boot.
  - `notifyObservers(point, buildInput)`: dispatch only **wired** observe points (else
    throw `PluginPointNotWiredError`); the host runs `scrubPluginBoundary(buildInput())`
    at the seam **before** `executor.execute`; per-plugin `try/catch` + finite
    `AbortSignal` timeout; `PluginRuntimeUnavailableError` -> `logger.debug`, other
    throws -> `logger.warn`; never propagates.
  - `reset()`: `pluginRegistry.clear()`.
- `index.ts` (server barrel) — re-export `pluginHost`/`PluginHost`,
  `pluginRegistry`/`PluginRegistry`/`type RegisteredPlugin`,
  `type PluginExecutor`/`UnavailablePluginExecutor`/`type PluginExecutionRequest`/`type PluginInvocationMeta`,
  and `* from './errors.ts'`.

## Shared-file edits

- `config.ts`: add `public readonly pluginsEnabled: boolean;` beside `mcpEnabled`;
  assign `this.pluginsEnabled = Config.parseBooleanEnv(Deno.env.get('PLUGINS_ENABLED'));`
  (non-throwing default-OFF, like `pullOnStart`, **not** `mcpEnabled`); add a
  `get plugins(): string` getter to the `paths` object returning
  `Deno.env.get('PLUGINS_DIR')?.trim() || ${config.basePath}/plugins` (template literal).
  Do **not** mkdir it in `init()`.
- `hooks.server.ts`: import `pluginHost` from `$server/plugins/index.ts`; immediately
  after line 58 `await trashGuideManager.initialize();` add an `if (config.pluginsEnabled)`
  try/catch(warn+continue) / else info-log guard, mirroring the `pullOnStart` if/else
  style (lines 156-184). Never throws to abort boot.
- `scripts/test.ts`: add alias
  `plugins: 'packages/praxrr-app/src/tests/shared/plugins,packages/praxrr-app/src/tests/plugins'`.
- `ROADMAP.md`, `CLAUDE.md` env docs — handled by the orchestrator.

## Tests (from the design test plan + critique)

- `tests/shared/plugins/validator.test.ts`, `capabilities.test.ts`,
  `extensionPoints.test.ts`, `apiVersion.test.ts`.
  - `capabilities.test`: every `CapabilityId` grants at least one **declared** point
    (any kind) via `checkCapabilityGrant` (NOT "observer"); separately, for every
    `CapabilityId` none of its `compatiblePoints` maps to a `mutates === true` point;
    the 4 ids match only read-only shapes (none matches
    `/credential|secret|auth|token|api.?key|net|http|fs|file|write|mutate|db/`).
  - `validator.test`: includes the least-privilege denial
    (`parser.releaseTitle.transform` + `read:sync-preview` -> rejected), plus accept
    minimal-valid, reject each missing/empty field, reject bad apiVersion, reject
    unknown/credential/network/fs/write-shaped capability, reject unknown point,
    reject entry traversal/absolute/drive/non-.wasm, reject unknown top-level key,
    accumulate multiple errors.
- `tests/plugins/registry.test.ts`, `executor.test.ts`, `hostContext.test.ts`,
  `scan.test.ts`, `host.test.ts`.
  - `host.test`: flip `config.pluginsEnabled` via readonly-cast + finally-restore
    (see `tests/mcp/*.test.ts` around the `mcpEnabled` override); set the dir via
    `Deno.env.set('PLUGINS_DIR', tmp)` (lazy getter) + `Deno.env.delete` in finally;
    cover disabled no-op, enabled+missing-dir degrade, enabled+mixed-manifests,
    wired-point swallows `PluginRuntimeUnavailableError`, injected fake executor sees a
    projected secret-free (`[REDACTED]`) input, unwired-point throws
    `PluginPointNotWiredError`.
- `tests/server/utils/config/pluginsConfig.test.ts`: default-false, lazy
  `paths.plugins` override, non-throwing on invalid.

## Verification (orchestrator runs)

- `deno task check` (server `deno check` + client svelte-check)
- `deno task test plugins`
- `deno task test security-posture` (covers `pluginsConfig.test.ts` via its alias)
- `deno task lint` (prettier + eslint)

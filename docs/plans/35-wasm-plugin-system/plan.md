# Issue #35 — WASM Plugin System (Phase 1 Foundation): Implementation Plan

> Internal planning document. Commit as `docs(internal): …` (lives under `docs/plans`).

## Overview

Phase 1 ships a **feature-flagged (`PLUGINS_ENABLED` default OFF), fully-decoupled
foundation** for a future WASM plugin system — **no WASM/Extism dependency, no WASM
execution, and zero call-sites** in the sync/compile/parser/notification pipeline.

What lands:

- A pure, versioned `$shared/plugins` contract (client + server safe, mirroring
  `$shared/security`): a single `PLUGIN_API_VERSION`, closed unions for extension
  points / capabilities / runtime / lifecycle, a deny-by-construction capability
  catalog, a fully-declared 9-point extension-point catalog (only an observe-only
  subset wired), and a pure fail-fast manifest validator.
- **Deny-by-construction capability model**: no credential/auth/secret/network/fs/write
  capability is even _representable_ in the `CapabilityId` union. The 4 Phase-1
  capabilities are all observe-only `{mutates: false, touchesSecrets: false}`.
- An **apiVersion-namespaced in-memory registry** (nested `Map<apiVersion, Map<id, …>>`)
  with case-insensitive per-namespace id uniqueness.
- A **`PluginExecutor` seam** whose default `UnavailablePluginExecutor` rejects with
  `PluginRuntimeUnavailableError('wasm runtime not yet available')` — the swappable
  point where a real WASM runtime plugs in later.
- An **optional-subsystem `PluginHost`** that scans `PLUGINS_DIR`, validates + registers
  valid manifests, skips + logs invalid ones, and **never aborts boot**. `notifyObservers`
  dispatches only _wired_ observe points, projects + redacts input at the seam, wraps every
  executor call per-plugin in try/catch + a finite `AbortSignal` timeout, and never propagates.
- Wiring: a non-throwing `config.pluginsEnabled` flag + lazy `config.paths.plugins`
  getter, a `hooks.server.ts` warn-and-continue guard after `trashGuideManager.initialize()`,
  and a `plugins` test alias.

Architectural invariants (binding):

- **Sole I/O mediator**: `scan.ts` is the only filesystem user; `hostContext.ts` is the
  only domain-data projection + redaction path; `host.ts` is the only orchestration point.
- **No runtime import cycle**: `executor.ts → registry.ts` is `import type` only;
  `registry.ts` imports nothing from `executor/host`; `host.ts` is the sole convergence point.
- **Cache safety by apiVersion**: registry (and any future cache) is namespaced by
  `apiVersion`; the validator hard-rejects any `apiVersion` outside
  `SUPPORTED_PLUGIN_API_VERSIONS`.

---

## Dependency Batch Table

Batches execute in order. Batch 1 (the contract) and Batch 3 (host + server barrel) are
authored by a single owner because their files are tightly interdependent; the rest are
parallel-safe.

### Batch 1 — `$shared/plugins` contract (parallel-safe: **NO**, single owner)

_Rationale:_ the pure contract is the single source of truth every other file imports. All
closed unions, the pinned capability↔point map, and the validator must agree; nothing can
type-check until this exists. Zero I/O, zero `Deno.env`, client + server safe.

| File                                                            | Kind | dependsOn                                                           | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ---- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/shared/plugins/types.ts`           | new  | none                                                                | Single home of `PLUGIN_API_VERSION='1'`, `SUPPORTED_PLUGIN_API_VERSIONS=['1']`, the closed `ExtensionPointId` (9) / `ExtensionPointKind` / `CapabilityId` (4) / `PluginRuntime='wasm'` / `PluginLifecycleState` unions, recursive `PluginJsonValue`, and readonly `PluginManifest` / `PluginManifestIssue` / `ManifestValidationResult` interfaces.                                                                                    |
| `packages/praxrr-app/src/lib/shared/plugins/capabilities.ts`    | new  | `types.ts`                                                          | `CAPABILITY_IDS` + `CAPABILITY_CATALOG` (4 observe-only `{mutates:false,touchesSecrets:false}` descriptors with the PINNED `compatiblePoints` from decision #4), `getCapability(id)`, and `checkCapabilityGrant(point, cap) = getCapability(cap)?.compatiblePoints.includes(point) ?? false` — the single source of the capability↔point map (no import from `extensionPoints.ts`, avoiding a cycle).                                  |
| `packages/praxrr-app/src/lib/shared/plugins/extensionPoints.ts` | new  | `types.ts`                                                          | `EXTENSION_POINT_IDS` + `EXTENSION_POINTS` (all 9 descriptors in stable order, each stamping `apiVersion=PLUGIN_API_VERSION` + `interfaceVersion='1'`, `wired:true` only for `config.profileCompiled.observe` + `sync.previewComputed.observe`, `requiredCapability` matching decision #4), plus `listExtensionPoints` / `getExtensionPoint` / `wiredObservePoints`.                                                                   |
| `packages/praxrr-app/src/lib/shared/plugins/validator.ts`       | new  | `types.ts`, `capabilities.ts`, `extensionPoints.ts`                 | Pure fail-fast `validatePluginManifest(raw: unknown): ManifestValidationResult` accumulating ALL `PluginManifestIssue` errors in one pass: strict `apiVersion` membership, id slug + non-empty name/version, `runtime==='wasm'`, entry `.wasm` shape + path-traversal/absolute/drive guard, unknown-top-level-key rejection, unknown/forbidden capability + unknown point fail-closed, and least-privilege via `checkCapabilityGrant`. |
| `packages/praxrr-app/src/lib/shared/plugins/index.ts`           | new  | `types.ts`, `capabilities.ts`, `extensionPoints.ts`, `validator.ts` | Pure barrel: `export * from types.ts` plus the named capability/extension-point/validator exports — one client + server-safe import surface mirroring `$shared/security/index.ts`.                                                                                                                                                                                                                                                     |

### Batch 2 — server leaf files (parallel-safe: **YES**)

_Rationale:_ server leaves whose only cross-batch dependency is the Batch-1 barrel. Each is a
distinct new file with a design-pinned interface, so separate agents can author concurrently.
`executor.ts` type-only-imports `RegisteredPlugin` (registry) + `PluginRuntimeUnavailableError`
(errors); `hostContext.ts` imports `redactSecrets`/`SECRET_KEY_PATTERN` from `$server/mcp/redact.ts` —
all against already-pinned shapes, so no build-order coupling and **no runtime import cycle**
(registry never imports executor).

| File                                                        | Kind | dependsOn                                                                                                                 | Summary                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/lib/server/plugins/errors.ts`      | new  | `$shared/plugins` (batch 1)                                                                                               | Typed error taxonomy (mirrors `mcp/errors.ts`): `PluginManifestError` (carries `readonly issues: PluginManifestIssue[]`), `PluginValidationError`, `PluginCapabilityDeniedError`, `PluginPointNotWiredError`, `PluginRuntimeUnavailableError` (name + message `'wasm runtime not yet available'`), `PluginExecutionError` — each sets `this.name`; SKIP vs THROW never conflated. |
| `packages/praxrr-app/src/lib/server/plugins/registry.ts`    | new  | `$shared/plugins` (batch 1)                                                                                               | `RegisteredPlugin` interface + `PluginRegistry` over nested `Map<apiVersion, Map<lowercased id, RegisteredPlugin>>` with `register`/`unregister`/`get`/`listByApiVersion`/`listForPoint`/`clear` (case-insensitive per-namespace id uniqueness, throws on duplicate) and the `pluginRegistry` singleton. No DB; imports NOTHING from executor/host (cycle-free).                  |
| `packages/praxrr-app/src/lib/server/plugins/executor.ts`    | new  | `$shared/plugins` (batch 1); TYPE-ONLY: `registry.ts` (`RegisteredPlugin`), `errors.ts` (`PluginRuntimeUnavailableError`) | Swappable seam: `PluginInvocationMeta`, `PluginExecutionRequest {plugin, point, input: PluginJsonValue, signal}`, `PluginExecutor.execute` interface, and inert `UnavailablePluginExecutor` whose `execute` rejects `PluginRuntimeUnavailableError`. Import of `RegisteredPlugin` is `import type` only (no runtime cycle); NO Extism/WASM import.                                |
| `packages/praxrr-app/src/lib/server/plugins/hostContext.ts` | new  | `$shared/plugins` (batch 1); `$server/mcp/redact.ts` (`redactSecrets`, `SECRET_KEY_PATTERN`)                              | Sole domain-data projection: `buildCapabilityInput(capability, source)` copies ONLY allow-listed fields per granted capability, then `scrubPluginBoundary` runs `redactSecrets` as defense-in-depth, yielding a structured-clone-safe secret-free `PluginJsonValue` snapshot for the seam.                                                                                        |
| `packages/praxrr-app/src/lib/server/plugins/scan.ts`        | new  | `$shared/plugins` (batch 1); `$logger` (warn)                                                                             | Isolated fs boundary (only `Deno.readDir`/`readTextFile` user): `scanPluginDir(dir)` reads each immediate subdir's `praxrr.plugin.json`, JSON-parses into `RawManifestEntry` (collecting `parseError`, never throwing on bad manifests; rethrows only unexpected fs errors); internal `const MAX_PLUGIN_DIRS = 256` truncates + `logs.warn` when exceeded and NEVER throws.       |

### Batch 3 — host + server barrel (parallel-safe: **NO**, single owner)

_Rationale:_ `host.ts` consumes every Batch-2 leaf plus config + logger; the server `index.ts`
barrel re-exports host and the rest, so index depends on host. Authored together; not internally
parallel.

| File                                                  | Kind | dependsOn                                                                                           | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/praxrr-app/src/lib/server/plugins/host.ts`  | new  | batch 2 (scan, executor, registry, errors, hostContext) + `$shared/plugins` + `$config` + `$logger` | Optional-subsystem `PluginHost` (constructor executor injection default `UnavailablePluginExecutor`, `setExecutor` seam) + singleton: `initialize()` NO-OPs when `!config.pluginsEnabled` else stats `config.paths.plugins` (warn + degrade on `Deno.errors.NotFound`), scan → validate → register valid / skip + log invalid, `logger.info` summary `{enabled, discovered, registered, rejected}`; `notifyObservers` dispatches ONLY wired observe points (else throws `PluginPointNotWiredError`) per-plugin via executor inside try/catch + finite `AbortSignal` timeout, never propagating; `reset()` clears registry. Never throws to abort boot. |
| `packages/praxrr-app/src/lib/server/plugins/index.ts` | new  | `host.ts`, `registry.ts`, `executor.ts`, `errors.ts`                                                | Server barrel (trashguide `index.ts` pattern): `export { pluginHost, PluginHost }`, `{ pluginRegistry, PluginRegistry, type RegisteredPlugin }`, `{ type PluginExecutor, UnavailablePluginExecutor, type PluginExecutionRequest }`, and `* from errors.ts` — the `$server/plugins/index.ts` surface `hooks.server.ts` imports.                                                                                                                                                                                                                                                                                                                         |

### Batch 4 — shared wiring edits (parallel-safe: **YES**)

_Rationale:_ three distinct shared edits, single small hunk each. `hooks.server.ts` needs
Batch-3 `index.ts`; `config.ts` and `scripts/test.ts` have no code dependency but are grouped
so the flag/dir/alias land together. Each reuses existing non-throwing helpers/conventions.

| File                                                        | Kind | dependsOn                                                                         | Summary                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | ---- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/praxrr-app/src/lib/server/utils/config/config.ts` | edit | none (reuses existing `Config.parseBooleanEnv`)                                   | Add `public readonly pluginsEnabled: boolean;` beside `mcpEnabled` (~line 28) assigned `Config.parseBooleanEnv(Deno.env.get('PLUGINS_ENABLED'))` (~line 83, non-throwing default false like `pullOnStart`), and add a `get plugins(): string` getter to the readonly `paths` object returning ``Deno.env.get('PLUGINS_DIR')?.trim()                                                  |     | `${config.basePath}/plugins` ``. Do NOT mkdir it in `init()`. |
| `packages/praxrr-app/src/hooks.server.ts`                   | edit | batch 3 (`$server/plugins/index.ts` `pluginHost`); `config.ts` (`pluginsEnabled`) | Add `import { pluginHost } from '$server/plugins/index.ts';` and, immediately after `await trashGuideManager.initialize();` (line 58), a `pullOnStart`-style guard: `if (config.pluginsEnabled) { try { await pluginHost.initialize(); } catch (error) { logger.warn(…'continuing startup') } } else { logger.info('Plugins disabled via PLUGINS_ENABLED', …) }`. Never aborts boot. |
| `scripts/test.ts`                                           | edit | none                                                                              | Add to the aliases map: `plugins: 'packages/praxrr-app/src/tests/shared/plugins,packages/praxrr-app/src/tests/plugins'` so `deno task test plugins` runs both suites (the config-parse test also stays covered by the existing `security-posture` alias's `tests/server/utils/config` entry).                                                                                        |

### Batch 5 — tests (parallel-safe: **YES**)

_Rationale:_ distinct new test files. `shared/plugins/*` need Batch 1; `plugins/*` need Batches 2–3;
the config test needs Batch-4 `config.ts`. Author after the code so red/green is meaningful; the
host test toggles `config.pluginsEnabled` via readonly-cast + finally-restore (`mcp.test.ts:570` pattern).

| File                                                                      | Kind | dependsOn                                                   | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------- | ---- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/praxrr-app/src/tests/shared/plugins/validator.test.ts`          | new  | batch 1 (validator, types)                                  | `validatePluginManifest`: accept minimal well-formed; reject missing/empty id/name/version/entry/apiVersion, non-member apiVersion, unknown + credential/net/fs/write-shaped capabilities fail-closed, least-privilege violation, unknown point, entry traversal/absolute/drive/non-`.wasm`, unknown top-level key; accumulate MULTIPLE errors in one result. **Plus (coverage gap):** a manifest declaring a mutating/transform point (`parser.releaseTitle.transform`) together with a read capability (e.g. `read:sync-preview`) is REJECTED — proves a plugin cannot gain read data via a mutating point.                                                                                                                         |
| `packages/praxrr-app/src/tests/shared/plugins/capabilities.test.ts`       | new  | batch 1 (capabilities)                                      | `CAPABILITY_IDS` = exactly the 4 read ids and NONE matches `/credential\|secret\|auth\|token\|api.?key\|net\|http\|fs\|file\|write\|mutate\|db/`; **every `CapabilityId` grants ≥1 DECLARED point (any kind) via `checkCapabilityGrant`** (no orphan capability — see ADDRESSED #1); **and for every `CapabilityId`, NO point in `getCapability(id).compatiblePoints` has `mutates===true`**; `CAPABILITY_CATALOG` covers each id once as `{mutates:false,touchesSecrets:false}`; `checkCapabilityGrant` false for an incompatible pair.                                                                                                                                                                                              |
| `packages/praxrr-app/src/tests/shared/plugins/extensionPoints.test.ts`    | new  | batch 1 (extensionPoints, capabilities — cross-consistency) | `EXTENSION_POINTS`↔`EXTENSION_POINT_IDS` bijection in stable order; exactly `config.profileCompiled.observe` + `sync.previewComputed.observe` `wired:true` and both kind `observe`; no transform/provider wired; every point stamps `PLUGIN_API_VERSION` + `interfaceVersion`; `requiredCapability` agrees with `capabilities.ts` `compatiblePoints` (pinned decision #4 cross-check, both directions); getter round-trips.                                                                                                                                                                                                                                                                                                           |
| `packages/praxrr-app/src/tests/shared/plugins/apiVersion.test.ts`         | new  | batch 1 (types, validator)                                  | `PLUGIN_API_VERSION` is a member of `SUPPORTED_PLUGIN_API_VERSIONS`; a manifest whose `apiVersion` is outside the set is rejected — pins the cache-safety/namespacing contract and guards the constant against silent drift.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `packages/praxrr-app/src/tests/plugins/registry.test.ts`                  | new  | batch 2 (registry)                                          | `register`/`get`/`unregister`; same id under two apiVersions coexist + isolated and wrong-namespace `get` returns `undefined`; case-insensitive duplicate id within one apiVersion rejected; `listForPoint` returns only in-namespace plugins declaring that point; `clear()` empties all.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `packages/praxrr-app/src/tests/plugins/executor.test.ts`                  | new  | batch 2 (executor, errors)                                  | `UnavailablePluginExecutor.execute()` rejects with `PluginRuntimeUnavailableError`; assert exact `.name` and message `'wasm runtime not yet available'`; assert `instanceof`-distinct from `PluginManifestError`/`PluginValidationError`/`PluginPointNotWiredError`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `packages/praxrr-app/src/tests/plugins/hostContext.test.ts`               | new  | batch 2 (hostContext)                                       | `buildCapabilityInput` includes ONLY allow-listed fields per granted capability; a planted `api_key`/`token` key is scrubbed to `[REDACTED]`; a capability with no grant yields no snapshot; output is structured-clone-safe (JSON round-trips).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `packages/praxrr-app/src/tests/plugins/scan.test.ts`                      | new  | batch 2 (scan)                                              | Temp `PLUGINS_DIR`: one `RawManifestEntry` per subdir with `praxrr.plugin.json`; `parseError` entry for malformed JSON (not thrown); skips subdirs without a manifest; tolerates empty dir; **rethrows an unexpected fs error via an injected fs reader / non-`NotFound` surfaced error rather than an actual permission failure** (see ADDRESSED coverage gap).                                                                                                                                                                                                                                                                                                                                                                      |
| `packages/praxrr-app/src/tests/plugins/host.test.ts`                      | new  | batch 3 (host) + batch 2                                    | Disabled (`pluginsEnabled=false` via readonly-cast + finally-restore): `initialize()` hard NO-OP, registry empty, `PLUGINS_DIR` never statted. Enabled + missing dir (via `Deno.env.set('PLUGINS_DIR', tmp)`, lazy getter): warns, empty registry, no throw. Enabled + temp dir mixing valid + invalid: valid registers, invalid skipped + logged, completes. `notifyObservers` on a wired point swallows `PluginRuntimeUnavailableError` per-plugin; with a resolving fake executor via `setExecutor` the input reaching `execute()` is a **projected secret-free snapshot** (plant a real secret-shaped key, assert `[REDACTED]` at the seam); `notifyObservers` on a declared-but-unwired point throws `PluginPointNotWiredError`. |
| `packages/praxrr-app/src/tests/server/utils/config/pluginsConfig.test.ts` | new  | batch 4 (config.ts)                                         | `config.pluginsEnabled` defaults false when unset, true for `1`/`true`/`yes`/`on`, invalid/empty ⇒ false and no throw at construction; `config.paths.plugins` returns default under `basePath` and honors a trimmed `PLUGINS_DIR` override. Covered by both the existing `security-posture` alias (`tests/server/utils/config`) and the new `plugins` alias's config path.                                                                                                                                                                                                                                                                                                                                                            |

### Batch 6 — docs (parallel-safe: **YES**)

_Rationale:_ docs handled separately from code, no code dependency. Two NEW internal/architecture
docs plus three doc edits. Commit `docs/plans` + `docs/architecture` files as `docs(internal)`;
`CLAUDE.md`/`ROADMAP.md` as `docs`. Kept out of code batches so they never block type-check/test.

| File                                                     | Kind | dependsOn | Summary                                                                                                                                                                                                                  |
| -------------------------------------------------------- | ---- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/plans/35-wasm-plugin-system/phase-1-foundation.md` | new  | none      | Internal design doc: contract, 3-layer capability model, wired-vs-declared extension-point table, executor seam, Extism evaluation + Phase-2 Deno-WASM spike gate, non-goals, risk register. Commit as `docs(internal)`. |
| `docs/architecture/plugins.md`                           | new  | none      | Architecture note: extension-point catalog, apiVersion semantics, lifecycle states, capability projection/redaction boundary, and the sole-I/O-mediator invariant. Commit as `docs(internal)`.                           |
| `CLAUDE.md`                                              | edit | none      | Add `PLUGINS_ENABLED` (default OFF) and `PLUGINS_DIR` (default `${basePath}/plugins`) to the Environment Variables section.                                                                                              |
| `ROADMAP.md`                                             | edit | none      | Add the Phase-1-shipped / Phase-2-deferred entry under Deferred/Extensibility per `design.roadmapNote`; use the concurrent-PR unique-string append convention to avoid ROADMAP merge conflicts.                          |

---

## Pinned Capability ↔ Extension-Point Mapping (Orchestrator Decision #4)

Both `capabilities.ts` (`compatiblePoints` per descriptor) and `extensionPoints.ts`
(`requiredCapability` per descriptor) MUST encode this mapping identically. A
cross-consistency test (`extensionPoints.test.ts`) asserts agreement in both directions.

### Capabilities (4, all observe-only, `{mutates: false, touchesSecrets: false}`)

| CapabilityId             | compatiblePoints                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `read:resolved-profile`  | `config.profileCompiled.observe`                                                      |
| `read:sync-preview`      | `sync.previewComputed.observe`, `sync.beforeApply.observe`, `sync.afterApply.observe` |
| `read:custom-format`     | `customFormat.condition.evaluate`                                                     |
| `read:config-validation` | `config.validation.observe`                                                           |

### Extension Points (9)

Each point carries `interfaceVersion='1'` and `apiVersion = PLUGIN_API_VERSION`.
`requiredCapability` MUST match the mapping above.

| #   | Extension Point                   | kind      | wired    | mutates | requiredCapability                               |
| --- | --------------------------------- | --------- | -------- | ------- | ------------------------------------------------ |
| 1   | `config.profileCompiled.observe`  | observe   | **TRUE** | false   | `read:resolved-profile`                          |
| 2   | `sync.previewComputed.observe`    | observe   | **TRUE** | false   | `read:sync-preview`                              |
| 3   | `config.validation.observe`       | observe   | false    | false   | `read:config-validation`                         |
| 4   | `sync.beforeApply.observe`        | observe   | false    | false   | `read:sync-preview`                              |
| 5   | `sync.afterApply.observe`         | observe   | false    | false   | `read:sync-preview`                              |
| 6   | `parser.releaseTitle.transform`   | transform | false    | true    | `null` (structurally ungrantable in Phase-1)     |
| 7   | `customFormat.condition.evaluate` | provider  | false    | false   | `read:custom-format`                             |
| 8   | `notification.dispatch.observe`   | provider  | false    | false   | `null` (needs a network cap that does not exist) |
| 9   | `importExport.adapter`            | provider  | false    | true    | `null`                                           |

**Invariants:**

- No read capability may list a transform/mutating point in `compatiblePoints` (prevents a
  plugin gaining read data via a mutating point).
- Least-privilege: each requested capability `C` must be consumable by ≥1 declared point `P`
  (`checkCapabilityGrant(P, C)`).
- A plugin may declare a point with zero capabilities (allowed, never dispatched).

---

## Orchestrator Decisions (Verbatim, Binding)

The following decisions are already resolved and override the design's open questions.

> You are working in the praxrr repo worktree: `/home/yandy/Projects/github.com/yandy-r/praxrr/.claude/worktrees/plugin-system-35` (Deno 2.x + SvelteKit, Svelte 5 no runes).
> The AUTHORITATIVE design spec for issue #35 Phase-1 (WASM plugin system foundation) is on disk as JSON at `/home/yandy/.claude/jobs/a2d487c7/tmp/design.json` (keys: design, judgment, exploreDigest). READ IT FIRST — it contains goals, nonGoals, extensionPoints, manifestSchema, capabilityModel, lifecycle, runtimeSeam, extismEvaluation, configFlags, fileContract (exact paths + exports + ownedBy), testPlan, roadmapNote.
>
> The design ships a FEATURE-FLAGGED (PLUGINS_ENABLED default OFF), FULLY DECOUPLED foundation: pure versioned $shared/plugins contract, deny-by-construction capability model (no credential/auth/secret/network/fs/write capability is even representable), fully-declared extension-point catalog with only an observe-only subset wired at the host seam, apiVersion-namespaced in-memory registry, and a PluginExecutor seam whose default throws PluginRuntimeUnavailableError('wasm runtime not yet available'). NO WASM/Extism dependency, NO WASM execution, ZERO call-sites in the sync/compile/parser pipeline.
>
> ORCHESTRATOR DECISIONS (already resolved — treat as binding, they override the design's open questions):
>
> 1. Manifest filename: each plugin subdir of PLUGINS_DIR contains 'praxrr.plugin.json'.
> 2. Finite scan limit: scan.ts holds an internal const MAX_PLUGIN_DIRS = 256; it truncates+logs.warn when exceeded and NEVER throws (honors 'keep limits finite' without adding a throwing env parser / module-eval boot risk). No PLUGINS_MAX_MANIFESTS env in Phase-1.
> 3. checkCapabilityGrant(point, capability) is defined in capabilities.ts as: getCapability(capability)?.compatiblePoints.includes(point) ?? false — capabilities.ts is the single source of the capability<->point map (no import cycle with extensionPoints.ts).
> 4. PINNED capability<->extension-point mapping (both files MUST agree; add a cross-consistency test):
>    Capabilities (4, all observe-only, {mutates:false, touchesSecrets:false}):
>    - read:resolved-profile compatiblePoints: [config.profileCompiled.observe]
>    - read:sync-preview compatiblePoints: [sync.previewComputed.observe, sync.beforeApply.observe, sync.afterApply.observe]
>    - read:custom-format compatiblePoints: [customFormat.condition.evaluate]
>    - read:config-validation compatiblePoints: [config.validation.observe]
>      Extension points (9; requiredCapability MUST match the mapping above; wired only where noted; interfaceVersion '1'; apiVersion = PLUGIN_API_VERSION):
>      1 config.profileCompiled.observe kind observe wired TRUE mutates false requiredCapability read:resolved-profile
>      2 sync.previewComputed.observe kind observe wired TRUE mutates false requiredCapability read:sync-preview
>      3 config.validation.observe kind observe wired false mutates false requiredCapability read:config-validation
>      4 sync.beforeApply.observe kind observe wired false mutates false requiredCapability read:sync-preview
>      5 sync.afterApply.observe kind observe wired false mutates false requiredCapability read:sync-preview
>      6 parser.releaseTitle.transform kind transform wired false mutates true requiredCapability null (structurally ungrantable in Phase-1)
>      7 customFormat.condition.evaluate kind provider wired false mutates false requiredCapability read:custom-format
>      8 notification.dispatch.observe kind provider wired false mutates false requiredCapability null (needs a network cap that does not exist)
>      9 importExport.adapter kind provider wired false mutates true requiredCapability null
>      NOTE: no read capability may list a transform/mutating point in compatiblePoints (prevents a plugin gaining read data via a mutating point). Least-privilege validation: each requested capability C must be consumable by >=1 declared point P (checkCapabilityGrant(P,C)); a plugin may declare a point with zero capabilities (allowed, never dispatched).
> 5. Reuse redactSecrets<T>(value) and SECRET_KEY_PATTERN from $server/mcp/redact.ts inside hostContext.ts (both are server-side; no client bundle leakage).
> 6. Global PLUGIN_API_VERSION='1' (single declaration in $shared/plugins/types.ts); SUPPORTED_PLUGIN_API_VERSIONS = ['1']; each extension point carries interfaceVersion '1'. Manifests do NOT pin per-point interfaceVersion in Phase-1.
> 7. Config: add public readonly pluginsEnabled = Config.parseBooleanEnv(Deno.env.get('PLUGINS_ENABLED')) (NON-throwing, default false, like pullOnStart NOT mcpEnabled) beside mcpEnabled; add a get plugins() getter to config.paths returning Deno.env.get('PLUGINS_DIR')?.trim() || `${config.basePath}/plugins`; do NOT mkdir it in init().
> 8. hooks.server.ts: after 'await trashGuideManager.initialize();', add an if(config.pluginsEnabled){ try { await pluginHost.initialize() } catch(warn+continue) } else { info-log disabled } guard. Never abort boot.
> 9. Test alias: add plugins: 'packages/praxrr-app/src/tests/shared/plugins,packages/praxrr-app/src/tests/plugins' to scripts/test.ts.
> 10. Conventions: strict typing (NO any/unknown-catch-all leaks past validated boundaries), fail-fast, ~500-line soft cap, DRY, single-responsibility, conventional commits. Prettier config governs formatting (2-space, single quotes, semicolons — match the repo; do NOT trust the tabs/100w note in CLAUDE.md). Server code is type-checked by 'deno check --quiet packages/praxrr-app/src/lib/server/**/*.ts'; client by svelte-check.

---

## Cross-File Import Graph

**Contract layer (leaf → root):** `$shared/plugins/index.ts` (barrel over
types + capabilities + extensionPoints + validator) is the ONLY contract surface; all server
files import via it. Within the contract, `types.ts` is the root leaf; `capabilities.ts` and
`extensionPoints.ts` each import `types.ts` **only** (they do NOT import each other —
`checkCapabilityGrant` lives in `capabilities.ts` as the single capability↔point source, so
`extensionPoints.ts` referencing a `requiredCapability` is just a `CapabilityId` _literal_, no
code import = no cycle); `validator.ts` imports all three.

**Server layer cycle-avoidance:** `registry.ts` imports the contract only and imports NOTHING
from `executor/host`. `executor.ts` imports `RegisteredPlugin` from `registry.ts` with
`import type` ONLY (erased at compile, zero runtime edge) plus `PluginRuntimeUnavailableError`
from `errors.ts` — so the registry↔executor pair has exactly one type-only edge and no runtime
cycle. `host.ts` is the convergence point importing scan + validator(contract) + registry +
hostContext + executor + errors + `$config` + `$logger`. Server `index.ts` re-exports
host + registry + executor + errors (host must exist first).

**Type-check reach:** `deno task check:server` globs `lib/server/**/*.ts` and type-checks the
shared contract _transitively_ via server imports; `deno task check:client` (svelte-check over
tsconfig) covers `lib/shared/plugins` directly; `deno test` type-checks the test files (which
import both contract and server code). The config test is reachable via BOTH the existing
`security-posture` alias (includes `tests/server/utils/config`) and the new `plugins` alias.

---

## Resolved Critique

Critique verdict: **GO (with fixes)**. The plan is architecturally sound and faithful to
verified repo precedents. One blocking spec contradiction and several non-blocking hazards
are resolved below.

### Blocking Issue — ADDRESSED

**#1 — `capabilities.test` contradiction with the PINNED capability↔point map.**
_Problem:_ Decision #4 makes `read:custom-format`'s ONLY `compatiblePoint`
`customFormat.condition.evaluate`, whose kind is `provider` (not `observe`). But the original
test wording asserted "every `CapabilityId` maps to ≥1 **observer** point," which would be RED
for `read:custom-format` even though the two contract files are internally consistent — the
defect is the test wording on the load-bearing least-privilege invariant.

**ADDRESSED:** Relax the `capabilities.test` assertion to "every `CapabilityId` grants ≥1
**DECLARED extension point (any kind)** via `checkCapabilityGrant`" (no orphan capability), and
assert the real security invariant separately: for every `CapabilityId`, NO point in
`getCapability(id).compatiblePoints` has `mutates===true` (no read capability can consume a
mutating/transform point). Decision #4's mapping is kept as-is. Reflected in the Batch-5
`capabilities.test.ts` row.

### Non-blocking hazards — ADDRESSED

- **Projection must run _at_ the seam.** `notifyObservers` MUST run `scrubPluginBoundary(...)`
  over the projected input **before** calling `executor.execute`, so the "input reaching
  `execute()` is projected + secret-free" guarantee actually holds. `host.test.ts` plants a
  real secret-shaped key and asserts `[REDACTED]` at the seam. **ADDRESSED** in the host contract
  and Batch-5 host test.
- **`redactSecrets` is heuristic (defense-in-depth only).** It only redacts STRING values whose
  KEY matches the anchored secret-suffix pattern; it will NOT catch a token in a benign-named
  field or a URL query string. The **allow-list projection** in `buildCapabilityInput` is the
  primary guarantee. Docs/design must not present `redactSecrets` as the primary guarantee.
  **ADDRESSED** in the risk register and doc scope.
- **Per-capability field allow-lists are unresolved (design openQuestion #6).** The implementer
  defines **minimal, observe-only, JSON-safe** allow-lists for the 4 capabilities so
  `buildCapabilityInput` and `hostContext.test` are meaningful; keep them intentionally minimal
  until real resolved-profile/sync-preview types finalize. **ADDRESSED** as an implementation note.
- **`host.test` "enabled + temp dir" env timing.** Point the host via
  `Deno.env.set('PLUGINS_DIR', tmpDir)` — the `config.paths.plugins` getter reads env **lazily**
  per access, so env mutation after import works for the DIR (unlike `pluginsEnabled`, which is
  constructor-cached and must be flipped via readonly-cast + finally-restore from
  `mcp.test.ts:570`). Do not cast/override the getter. **ADDRESSED** in the Batch-5 host test row.

### Type-check hazards — ADDRESSED

- **`Array.prototype.includes` narrowing (TS2345).** The validator's membership checks
  (`CAPABILITY_IDS.includes(rawCap)`, `EXTENSION_POINT_IDS.includes(rawPoint)`,
  `SUPPORTED_PLUGIN_API_VERSIONS.includes(rawApiVersion)`) call `.includes(string)` on arrays
  whose element type is a literal union, not `string`. Use the repo idiom from
  `mcp/protocol.ts:14` (`const SUPPORTED: readonly string[] = SUPPORTED_…;` then `.includes`) or
  an `(x): x is CapabilityId` type guard. `checkCapabilityGrant` itself is fine (params already
  typed). **ADDRESSED.**
- **Descriptor literal fields `mutates:false` / `touchesSecrets:false`.** Declare
  `CAPABILITY_CATALOG` with an explicit `: readonly CapabilityDescriptor[]` annotation so
  contextual typing preserves the `false` literal — avoid a widened intermediate or plain
  `as const` that could widen `false` to `boolean` and fail assignability. **ADDRESSED.**
- **`PLUGIN_API_VERSION` declaration.** Declare as a bare `export const PLUGIN_API_VERSION = '1'`
  (type `'1'`), assignable to `ExtensionPointDescriptor.apiVersion: string` and to the
  `SUPPORTED_PLUGIN_API_VERSIONS` element type; apply the widen-to-`readonly string[]` idiom if a
  test stores it in a `string`-typed variable before `.includes`. **ADDRESSED.**

### Coverage gaps — ADDRESSED

- **`scan.test` unexpected-fs rethrow is flaky under `--allow-read/--allow-write`.** Inject the
  fs reader into `scanPluginDir` (keep it testable) or assert the rethrow path via a
  non-`NotFound` surfaced error rather than a real permission failure. **ADDRESSED** in the
  Batch-5 `scan.test.ts` row.
- **Strongest least-privilege denial untested.** Add a `validator.test` case: a manifest
  declaring a mutating/transform point (`parser.releaseTitle.transform`) with a read capability
  (e.g. `read:sync-preview`) MUST be REJECTED — proves a plugin cannot gain read data via a
  mutating point. **ADDRESSED** in the Batch-5 `validator.test.ts` row.
- **`deno task test plugins` does not cover `pluginsConfig.test.ts`.** The new `plugins` alias
  points only at `tests/shared/plugins` + `tests/plugins`, not `tests/server/utils/config`. The
  config test is covered only by the `security-posture` alias — so verification runs BOTH
  `deno task test plugins` AND `deno task test security-posture`. **ADDRESSED** in the
  verification steps (nobody should assume the `plugins` alias is self-complete).

---

## Verification Steps (Exact Commands)

Run from the worktree root. Deno is **not** on `PATH` in a non-interactive shell — prepend it first.

1. **Prepend Deno to PATH:**

   ```bash
   export PATH="$HOME/.deno/bin:$PATH"
   ```

2. **Type-check server + transitive contract** (globs `lib/server/**/*.ts`; follows imports into `$shared/plugins`). Expect zero errors.

   ```bash
   deno task check:server
   ```

3. **Type-check client + shared directly** (svelte-check over tsconfig covering `lib/shared/plugins`). If it reports phantom `$types` errors after the `hooks.server.ts` edit, run `npx svelte-kit sync` first, then re-run.

   ```bash
   deno task check:client
   ```

4. **Run both new suites** (new alias → `tests/shared/plugins` + `tests/plugins`). Expect all green.

   ```bash
   deno task test plugins
   ```

5. **Run the config suite via the existing alias** (covers `tests/server/utils/config/pluginsConfig.test.ts` — NOT reached by the `plugins` alias). Expect all green.

   ```bash
   deno task test security-posture
   ```

6. **Prove the flag default is OFF and boot is untouched.** Start dev with `PLUGINS_ENABLED` unset and confirm the `Plugins disabled via PLUGINS_ENABLED` info log and that `PLUGINS_DIR` is never created; then start with `PLUGINS_ENABLED=1` + an empty/missing `PLUGINS_DIR` and confirm it warns, degrades to an empty registry, and boot completes (never aborts).
7. **Grep-assert decoupling.** Confirm ZERO call-sites in the pipeline and NO WASM/Extism dep:

   ```bash
   grep -rn 'pluginHost\|notifyObservers' packages/praxrr-app/src/lib/server/{sync,pcd,parser,notifications}   # expect nothing
   grep -rni 'extism' packages/ deno.json                                                                       # expect nothing
   ```

8. **Format + lint gate.** Match the repo Prettier config (2-space, single quotes, semicolons) — do NOT trust CLAUDE.md's tabs/100w note. Run `prettier --write` on the new `.md` docs before committing (the `*.md` `printWidth:80` override rewraps fences).

   ```bash
   deno task format
   deno task lint
   ```

---

## Risk Register

| #   | Risk                                                                                                                                                                              | Mitigation                                                                                                                                                                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Import cycle between `registry.ts` and `executor.ts` (executor needs `RegisteredPlugin`; a runtime import would cycle since host imports both).                                   | `executor.ts` imports `RegisteredPlugin` with `import type { RegisteredPlugin }` ONLY (type-erased, zero runtime edge); `registry.ts` imports nothing from executor. Verified by `check:server` passing and by grepping `executor.ts` for a value-level registry import.                                                                                                               |
| 2   | Capability↔point map drifts between `capabilities.ts` (`compatiblePoints`) and `extensionPoints.ts` (`requiredCapability`), silently weakening least-privilege.                   | `extensionPoints.test.ts` asserts bidirectional cross-consistency against the pinned decision-#4 table AND that no read capability's `compatiblePoints` contains a transform/mutating point; `capabilities.test.ts` asserts the 4-id closed set and forbidden-shape regex.                                                                                                             |
| 3   | A `PLUGINS_ENABLED` typo or bad env brings down module-eval boot (config fields populate in the constructor BEFORE any try/catch exists).                                         | Use the non-throwing `Config.parseBooleanEnv` (invalid/empty ⇒ false), never a throwing parser; `scan.ts` uses an internal `const MAX_PLUGIN_DIRS=256` that truncates + `logs.warn` and NEVER throws (no throwing env parser at module eval); `host.initialize()` rethrows only unexpected errors and `hooks.server.ts` wraps it in warn-and-continue.                                 |
| 4   | apiVersion cache/registry reuse across an upgrade or rollback resurrects a plugin validated under an incompatible contract.                                                       | Registry is namespaced by `apiVersion` (nested `Map`); `get` under the wrong `apiVersion` returns `undefined`; validator hard-rejects `apiVersion` not in `SUPPORTED_PLUGIN_API_VERSIONS`. `registry.test.ts` + `apiVersion.test.ts` pin this.                                                                                                                                         |
| 5   | "Wired-but-seam-throws" ambiguity: a wired observe point dispatches to `UnavailablePluginExecutor` and a `PluginRuntimeUnavailableError` leaks to the caller / aborts a pipeline. | `notifyObservers` wraps every executor call per-plugin in try/catch + finite `AbortSignal` timeout, logs `PluginRuntimeUnavailableError` at debug and other throws at warn, and NEVER propagates; `host.test.ts` asserts the caller sees no throw and one plugin's failure does not block another. No production call-site is wired in Phase-1.                                        |
| 6   | Projection regression leaks a credential/secret across the seam.                                                                                                                  | `hostContext.buildCapabilityInput` copies ONLY allow-listed fields per granted capability, then `scrubPluginBoundary` runs `redactSecrets`/`SECRET_KEY_PATTERN` from `$server/mcp/redact.ts` as defense-in-depth; `CapabilityId` has NO credential/network/fs/write member (structurally unrepresentable). `hostContext.test.ts` plants an `api_key`/`token` and asserts `[REDACTED]`. |
| 7   | Concurrent PRs conflict on `ROADMAP.md` and (if touched) shared append points; migration-version-style collisions.                                                                | Append the ROADMAP entry via a unique-string insertion (take main's version, re-apply the addition) per the repo's concurrent-PR convention; this change adds NO DB migration, avoiding date-version collisions.                                                                                                                                                                       |
| 8   | svelte-check reports stale `$types` after the `hooks.server.ts` load-path edit.                                                                                                   | Run `npx svelte-kit sync` before `check:client` (documented lesson: phantom `$types` errors after touching a server load/startup file).                                                                                                                                                                                                                                                |

---

## Conventions Checklist

- [ ] **Formatting:** repo Prettier config (2-space indent, single quotes, semicolons, ~120w) — IGNORE CLAUDE.md's tabs/100w note; run `prettier --write` on new `.md` docs (`printWidth:80` fence rewrap).
- [ ] **Strict typing:** no `any` / no unknown-catch-all leaks past validated boundaries; validator boundary narrows `unknown` → `PluginManifest` via `ManifestValidationResult`; executor seam is typed over `PluginJsonValue` only (no Extism/WASM type leak).
- [ ] **Fail-fast at boundaries:** validator accumulates ALL field errors and rejects fail-closed; `scan.ts` rethrows only unexpected fs errors; host rethrows only unexpected errors; every other path degrades (warn + continue), never silently swallows without a log.
- [ ] **Deny-by-construction:** `CapabilityId` closed union has NO credential/auth/secret/network/fs/db/env/write member; adding a grantable capability must bump `PLUGIN_API_VERSION` (test-guarded).
- [ ] **Single `PLUGIN_API_VERSION` declaration** in `$shared/plugins/types.ts`; extension points stamp `apiVersion=PLUGIN_API_VERSION` + `interfaceVersion='1'`; registry + any future cache namespaced by `apiVersion` (parser cache-safety analog).
- [ ] **Optional-subsystem degradation** (parser convention): app boot NEVER aborts when plugins are disabled, dir is absent, a manifest is invalid, or the runtime is unavailable.
- [ ] **~500-line soft cap** per file; single-responsibility (`scan.ts` = only fs I/O; `hostContext.ts` = only projection + redaction; `host.ts` = only orchestration); DRY — reuse `Config.parseBooleanEnv` and `redactSecrets`/`SECRET_KEY_PATTERN` rather than re-implementing.
- [ ] **Entity-name convention:** case-insensitive uniqueness for plugin id within an `apiVersion` namespace; validate non-empty name but persist as authored (not trimmed) per Portable Contract Fidelity.
- [ ] **Barrels mirror precedents:** `$shared/plugins/index.ts` follows `$shared/security/index.ts`; `$server/plugins/index.ts` follows `$trashguide/index.ts`.
- [ ] **Conventional commits:** `feat(plugins)` for code, `docs(internal)` for `docs/plans` + `docs/architecture`, `docs` for `CLAUDE.md`/`ROADMAP.md`; keep the diff scoped to the file contract (no unrelated churn, no committed local `v1.d.ts`/`openapi` regen).
- [ ] **Zero pipeline coupling:** no call-site added in sync/compile/parser/notification; no WASM/Extism dependency added to `deno.json`.

# Context Analysis: resolved-config-viewer

## Executive Summary

Issue #25 adds a read-only viewer for the PCD-resolved configuration state. `PCDCache` (in-memory SQLite built by `loadAllOperations()` schema→base→tweaks→user replay) already **is** the resolved state, and `pcd/entities/serialize.ts` already reads it into arr-agnostic `Portable*` shapes — so 90% of this feature is a thin read/compare surface over existing machinery. The one genuinely new server primitive is `PCDCache.buildReadOnly({ layers })`: a side-effect-free variant of `build()` that must skip value-guard evaluation, `pcd_op_history` writes, `pcd_ops.state` mutation, and `disableDatabaseInstance()` — because `build()` today interleaves all of those into a single ~250-line op-execution loop (cache.ts L98-274) that the read-only path must not share. Everything else (diff engine, live-Arr fetch, namespace matching, rate limiting, UI diff language) is direct reuse from `sync/preview/*` and the Cross-Arr Parity Map (PR #14). The plan carries one CRITICAL security finding (C1: do not copy `FieldDiffTable.svelte`'s unsanitized `marked.parse()`+`{@html}` pattern) and five WARNINGs (W1-W5), all with existing-primitive mitigations, no new architecture.

## Architecture Context

### System Structure

```text
pcd_ops / pcd_op_history (app DB, SQLite)
        │ loadAllOperations() — schema → base(published+draft) → tweaks → user(published)
        ▼
PCDCache.build() [mutating, compiler.ts#compile() only caller] ──► registry.ts (setCache)
PCDCache.buildReadOnly({layers}) [NEW, ephemeral, never setCache'd]
        │
        ▼
$pcd/resolved/*  (NEW read-only service, sibling to entities/, database/, ops/)
  readers.ts   → (entityType, arrType) → serialize*() dispatch table [no dispatcher exists today]
  layers.ts    → base-only ephemeral buildReadOnly() wrapper
  layerDiff.ts → diffToFieldChanges(baseOnly, resolved)   [reuse $sync/preview/diff.ts]
  liveDiff.ts  → generatePreview() filtered client-side to one entity [reuse $sync/preview]
  compare.ts   → per-instance desired payloads, arr_type-gated
  limits.ts    → instance-count cap (8) + fan-out rate window
        │
        ▼
/api/v1/pcd/{databaseId}/resolved/**  (contract-first, mirrors compatibility.yaml)
        │
        ▼
/resolved-config/[databaseId]  (parity-map page idiom + SyncPreviewEntityDiff visual language)
```

Two pre-existing, fully separate pipelines are being composed, not merged:

1. **PCD cache build path** (`compiler.ts#compile()` → `PCDCache.build()`) — the only mutating, registered path. `buildReadOnly` must be architecturally parallel to this, never inside it.
2. **Sync preview path** (`sync/preview/orchestrator.ts#generatePreview()`) — already read-only, already fetches live Arr state + diffs it. Zero dependency on `PCDCache`. Reused verbatim for live diff/compare.

Accepted one-directional dependency: `pcd/resolved/*` imports from `$sync/preview/*` (pure utility modules). Do not invert.

### Data Flow — the mutating build loop `buildReadOnly` must not share

`PCDCache.build()` (cache.ts L38-296): reads `conflict_strategy` + published user ops + prior conflict history (L41-64) → opens `:memory:` SQLite, registers SQL helper fns (L67-82) → `loadAllOperations()` + `validateOperations()` (L85-86) → **op-execution loop (L98-274)**: for each op, `parseOpId(filepath)` determines `trackHistory` (true only for `pcd_ops:<id>` DB-sourced ops, false for schema/tweaks file ops) → `this.db.exec(op.sql)` → if tracked: `evaluateValueGuardApply()` → maybe `pcdOpsQueries.update(id,{state:'dropped'})` (mutates real row) + always `pcdOpHistoryQueries.create(...)` (writes real history) → on SQL error, `evaluateValueGuardError()` decides swallow-vs-rethrow → sets `built=true` → on any thrown error, calls `disableDatabaseInstance()` (side effect on the real instance row) + `close()`. `compile()` then `setCache()`s the result and runs `autoResolveOverrideConflicts()` post-swap.

`buildReadOnly({layers})` must: (a) let the caller skip the 4th `loadAllOperations()` push (user stage) at the source rather than post-hoc filtering — "base" for display = schema+base+tweaks per Business Rule 3; (b) execute `this.db.exec(op.sql)` for every op but force `trackHistory=false` unconditionally, skipping the entire guard/history/auto-drop branch; (c) never call `setCache()`; (d) its own catch block must never call `disableDatabaseInstance()`.

### Integration Points

- **Cache access**: `pcdManager.getCache(databaseId)` (never import `registry.getCache` directly) → `cache?.isBuilt()` gate, exactly like `compatibility/parity` and `score-simulator` do.
- **`pcd/index.ts` re-export**: currently has no `resolved` export among its `// ====` banner sections (manager, cache, writer, manifest, dependencies, operations, snapshots, errors); routes must import from `$pcd/index.ts`, never a deep `pcd/resolved/*` path.
- **OpenAPI**: new `docs/api/v1/paths/resolved-config.yaml` + `schemas/resolved-config.yaml`, registered in `openapi.yaml` via per-path and per-schema `$ref` lines (verified pattern at `openapi.yaml` ~L347-349, ~615-616, ~1329-1333) — then `deno task generate:api-types` (writes `packages/praxrr-app/src/lib/api/v1.d.ts` via `npx openapi-typescript`, single command, resolves all `$ref`s itself) then `deno task bundle:api` (writes `packages/praxrr-api/openapi.json` + copies `v1.d.ts` → `packages/praxrr-api/types.ts`). Both must run before handlers reference `components['schemas'][...]`.
- **SSRF centralization (W1)**: single choke point is `getArrInstanceClient()` in `arrInstanceClients.ts` — confirmed *zero* call sites for `assertSafeArrUrl()` anywhere in the app (not even partial). Fixing here for free covers `generatePreview()`-based live diff/compare, `arr/library`, `arr/releases`, upgrades.
- **Navigation**: one `NAV_REGISTRY` entry in `navigation/registry.ts`, following `overview.parity_map` / `policies.score_simulator` object shape.
- **Test alias**: `scripts/test.ts`'s flat `aliases` map — add `resolvedConfig:` entry (comma-joined dir+file path, mirrors the `parity` alias exactly).

## Critical Files Reference

**Server — PCD core (modify/extend):**

- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts` — `PCDCache.build()` L38-296; the op-execution loop (L98-274) is the extraction point for `buildReadOnly({layers})`.
- `packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts` — `loadAllOperations()`'s 4-stage push order; the "user" stage must be skippable at the call site, not filtered post-hoc.
- `packages/praxrr-app/src/lib/server/pcd/database/registry.ts` — module-level cache map; `buildReadOnly` output must never reach `setCache`.
- `packages/praxrr-app/src/lib/server/pcd/database/compiler.ts` — the only `build()`/`setCache` caller; do not touch its flow.
- `packages/praxrr-app/src/lib/server/pcd/core/manager.ts` — `pcdManager.getCache/getAll/getById` route-facing access convention.
- `packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts` — 15 `serialize*(cache,name)` functions, no dispatcher; `readers.ts` must build its own `(entityType,arrType)→fn` map.
- `packages/praxrr-app/src/lib/server/pcd/index.ts` — public surface with `// ====` banners; add `// RESOLVED CONFIG` section.

**Server — sync preview (reuse verbatim, no change):**

- `packages/praxrr-app/src/lib/server/sync/preview/diff.ts` — `diffToFieldChanges(current, desired, options?)`; the diff engine for layer/live/cross-instance comparisons.
- `packages/praxrr-app/src/lib/server/sync/preview/sectionDiffs.ts` — exported array-key-strategy constants; reuse, do not re-derive.
- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts` — `generatePreview()`; no per-entity filter exists — liveDiff must post-filter section results client-side.
- `packages/praxrr-app/src/lib/server/sync/preview/types.ts` — `FieldChange`/`EntityChange`/`SyncPreviewArrType` — keep vocabularies distinct (see Gotchas).
- `packages/praxrr-app/src/lib/server/sync/preview/limits.ts` — `registerPreviewCreateAttempt(instanceId, nowMs)` — two required args.
- `packages/praxrr-app/src/lib/server/sync/namespace.ts` — `findNamespaceMatch()` pure string matching (no DB).
- `packages/praxrr-app/src/lib/server/sync/mappings.ts` — `isSyncSectionSupported()`/`getUnsupportedSyncSectionReason()`; `SUPPORTED_SYNC_SECTIONS` is module-private, do not import it.

**Server — Arr/util (reuse; one modification):**

- `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts` — `getArrInstanceClient()`; MODIFY to call `assertSafeArrUrl()` (W1 centralization).
- `packages/praxrr-app/src/lib/server/utils/arr/urlSafety.ts` — `assertSafeArrUrl(url)` L81; zero call sites app-wide today.
- `packages/praxrr-app/src/lib/server/utils/arr/testConnectionReason.ts` — sanitized reason-enum template for W2.
- `packages/praxrr-app/src/lib/server/utils/rateLimit.ts` — `registerRateLimitAttempt(key, opts?)` generic limiter, building block for `/compare` window (W3).
- `packages/praxrr-app/src/lib/shared/arr/capabilities.ts` — `isArrAppType()` L275, canonical arr_type allowlist (W4).
- `packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts` — every SELECT hard-codes `'' AS api_key`; only sanctioned instance accessor (W5).
- `packages/praxrr-app/src/lib/server/db/queries/arrNamespaces.ts` — `.get()` read-only vs `.getOrCreate()` mutating; never call the latter from resolved/live-diff paths.

**Routes / contract:**

- `packages/praxrr-app/src/routes/api/v1/compatibility/parity/+server.ts` — THE handler shape to copy verbatim.
- `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts` — precedent for 64KB body cap, store-capacity 429, rate-limit 429.
- `docs/api/v1/paths/compatibility.yaml` + `docs/api/v1/schemas/compatibility.yaml` — literal contract-file template.
- `deno.json` — `generate:api-types` and `bundle:api` tasks; run both after any contract change.

**Client:**

- `packages/praxrr-app/src/routes/parity-map/+page.server.ts` / `+page.svelte` / `ParityMatrix.svelte` — page-load, empty-state ladder, and Table/Badge/Column<T> matrix idiom to copy.
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewEntityDiff.svelte` — glyph+color+label diff visual language (WCAG 1.4.1).
- `packages/praxrr-app/src/lib/client/ui/meta/JsonView.svelte` — reuse for raw-JSON mode.
- `packages/praxrr-app/src/routes/databases/[id]/changes/components/FieldDiffTable.svelte` — ANTI-pattern; renders markdown via unsanitized `marked.parse()`+`{@html}` (C1). Do not copy.
- `packages/praxrr-app/src/lib/server/navigation/registry.ts` — `NAV_REGISTRY` entry point.

**Tests:**

- `packages/praxrr-app/src/tests/base/syncPreviewDiff.test.ts` — pure Deno.test mirror target.
- `packages/praxrr-app/src/tests/routes/parityMapApi.test.ts` — route-test + in-memory-SQLite-fixture recipe.
- `packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts` — add one case per new route/load surface.
- `scripts/test.ts` — flat `aliases` map; add `resolvedConfig` entry.

## Patterns to Follow

**Parity handler shape** (copy verbatim): auth-first (`!locals.user && !locals.authBypass` → 401) → strict `/^\d+$/.test()` param check (not bare `parseInt`, rejects `"1e5"`/`"1abc"`) → 400 "Database not found" for `!cache?.isBuilt()` (not 404 — "caller input problem, no sibling-app fallback") → try/catch with `logger.error(msg,{source, meta:{error: error instanceof Error ? error.message : String(error)}})` → generic 500 → every response `satisfies components['schemas'][...]`. Example: `routes/api/v1/compatibility/parity/+server.ts`.

**Per-entity-type functions, no generic dispatcher**: one exported function per entity/arr-app combo (`serializeRadarrNaming` vs `serializeSonarrNaming`, distinct return types), never one function branching on `arrType` internally. Throws plain `Error` on miss; caller translates to 404. Example: `pcd/entities/serialize.ts`.

**Contract-first API**: author `docs/api/v1/paths|schemas/resolved-config.yaml` → register in `openapi.yaml` (each named schema needs its own top-level `$ref` line under `components.schemas`) → `deno task generate:api-types` → `deno task bundle:api` → handlers import `components['schemas'][...]` from `$api/v1.d.ts`. Never hand-edit generated files.

**Svelte 4-style, no runes** (repo-wide, confirmed in every file inspected): `export let` props, `$:` reactive labels, plain `let` local state, `on:click`/`on:change` directives, `<svelte:fragment slot=... let:x>` for table cells. Example: `parity-map/ParityMatrix.svelte`, `SyncPreviewEntityDiff.svelte`.

**Sanitized reason enums**: closed string-union type + pure mapping functions (`toFailureReason(error)`, `reasonFromStatus(status?)`); raw error text never reaches a response body — only `logger.error(...)` server-side. Example: `utils/arr/testConnectionReason.ts`.

**Diff triple-encoding**: glyph (`+ ~ - =`) + color + text label per change row (WCAG 1.4.1, never color-only). Example: `SyncPreviewEntityDiff.svelte` `ACTION_META`/`FIELD_META`.

**Page-load error pattern**: `+page.server.ts` load mirrors route-handler validation but returns `{ ..., error?: string }` in page data instead of throwing a SvelteKit error — page renders its own inline banner. `?databaseId=` URL param is the source of truth (no client store). Example: `parity-map/+page.server.ts`.

**Test fixtures without a real build**: minimal in-memory SQLite (`new Database(':memory:', {int64:true})`) + hand-written `CREATE TABLE`/`INSERT` scoped to only the tables the handler under test reads, wrapped and registered via `setCache`/`deleteCache` in try/finally — OR patch-and-restore monkeypatching of query-module methods (`patchTarget`, `patchLoggerForTest`). No test anywhere runs a real `PCDCache.build()` from actual ops. Examples: `tests/routes/parityMapApi.test.ts`, `tests/pcd/snapshots/service.test.ts`.

## Cross-Cutting Concerns

**Security C1 (CRITICAL, hard stop)**: `FieldDiffTable.svelte`/`Markdown.svelte` render markdown via unsanitized `marked.parse()` + `{@html}` for `description`/`readme`/`notes` fields — confirmed live in the current codebase (also flagged in `docs/pr-reviews/pr-140-review.md` finding I-4, a prior real incident: raw HTML interpolation of `custom_format_trash_id`). All new resolved-config components must render every value as plain escaped `{value}` text; no `{@html}`, no `marked.*` calls anywhere in new code, even for a "raw view" mode (`JsonView.svelte`'s highlight.js path is safe — text-escaped, not HTML-injected — and is the correct reuse target).

**Security W1-W5** (warnings, each has an existing-primitive mitigation, no redesign needed):

- W1 — centralize `assertSafeArrUrl()` inside `getArrInstanceClient()` (zero call sites today).
- W2 — never forward raw `error.message` in JSON error bodies (leaks LAN host/port); use a closed reason-enum per `testConnectionReason.ts`.
- W3 — no multi-instance fan-out bound exists anywhere in the codebase today; `resolved/limits.ts` needs both a per-user rate window (`$utils/rateLimit.ts`) and a hard instance-count cap (8/request).
- W4 — validate `arr_type` against canonical `isArrAppType()` at the top of every handler; do not trust ad hoc validation (the codebase has 3+ inconsistent per-call-site validators today).
- W5 — instance metadata only via `arrInstancesQueries` accessors, never a fresh raw SELECT.

**Cross-Arr Semantic Validation Policy (CLAUDE.md, load-bearing)**: applies to every comparison/live/compare code path — explicit `arr_type` dispatch, no sibling-app fallback, unsupported (arrType, section) combos report `compatible:false` explicitly. Concrete instances: `metadataProfiles` is Lidarr-only; quality-definitions are per-app-native tables; Sonarr v3 apps lack custom formats entirely.

**Portable Contract Fidelity**: OpenAPI schemas, runtime validators, and payload handlers must stay in lockstep — do not document portable fields the runtime rejects for a given `arr_type`.

**Contract-first ordering is a hard sequencing dependency**: every phase that touches the API surface must land OpenAPI schema + `generate:api-types` + `bundle:api` before any handler code that imports `components['schemas'][...]`.

## Parallelization Opportunities

- Phase 0 (contract + route skeletons) is a single blocking prerequisite — sequential, one small commit.
- Phase 2 (layer breakdown/`buildReadOnly`) and Phase 3 (live diff) can run in parallel once Phase 1 lands — disjoint files, no data dependency, both depend only on Phase 1's `readers.ts`.
- Phase 4 (cross-instance compare) depends on Phase 1 + Phase 3 (if `includeLive` used); otherwise independent of Phase 2.
- Phase 5 (UI) can start against Phase 1's output alone; layer/live-diff/cross-instance UI slices gate on their server phases.
- Within any phase, OpenAPI schema authoring and server-module implementation can proceed in parallel once shape is agreed, but handlers can't be written until `generate:api-types` has run.
- W1 SSRF centralization is independent, low-risk — can land at any point, ideally early since it benefits every existing Arr-fetch path too.

## Implementation Constraints

- No new app-DB tables or migrations — all sources exist already.
- No new runtime dependencies — `jsondiffpatch` explicitly rejected (CVE-2026-8657, CVE-2026-8656); `microdiff` acceptable only as a fallback.
- `buildReadOnly` is real refactoring, not a flag add — `build()`'s op-loop, value-guard evaluation, and history/state writes are tightly interleaved; genuinely net-new, not extending a partial method.
- Layer views must never mutate state (Business Rule 2) — test must assert zero writes to `pcd_ops`/`pcd_op_history`.
- "Base" for display = schema + base + tweaks; user ops entirely omitted; tweaks not a separate v1 toggle.
- User overrides = diff(base-only, resolved) via `diffToFieldChanges()` — never reconstructed from `metadata.changed_fields` alone.
- No per-entity filter in `generatePreview()` — single-entity live diff must fetch/compute the full section and filter client-side.
- Hard instance cap: 8 per `/compare` request (400 above); existing 6/60s per-instance preview rate limit reused for `/diff`.
- File-size soft cap ~500 lines — `readers.ts` should split by entity family if it grows past that.
- `.prettierrc` on disk is authoritative over CLAUDE.md's formatting prose: 2-space indent, `printWidth: 120`, `trailingComma: "es5"`, `singleQuote: true`. Run `deno task format`.
- CLAUDE.md's "use `onclick`" wording is stale — actual codebase convention is Svelte 4-style `on:click`/`on:change`. Follow the code.

## Key Recommendations

1. Sequence strictly as spec'd: Phase 0 → Phase 1 → {Phase 2 ∥ Phase 3} → Phase 4 → Phase 5. Treat `docs/prps/plans/completed/cross-arr-parity-map.plan.md` as the literal task-ordering template.
2. Extract, don't duplicate, the `cache.ts` op-loop: a shared helper parameterized by `trackHistory: boolean` (forced `false` for `buildReadOnly`), not a second copy of the loop.
3. Land W1 (SSRF centralization) early and independently — no dependency on layer-breakdown work.
4. Build `readers.ts`'s dispatch table by hand — no existing generic entity registry fits this purpose; `entities/registry.ts`'s `AUTO_ALIGN_ENTITIES` serves a different purpose (rename-chain SQL table names).
5. Keep `pcd/resolved/*` functions pure given a `PCDCache` input — no direct DB/registry access inside comparator/diff functions — so future issues #7/#15/#26 can reuse without parameter creep.
6. Do not conflate `sync/preview/diff.ts` (full-entity structural diff, needed here) with `pcd/ops/draftChanges.ts` (single-op before/after diff for conflicts/drafts review) — different inputs, different UIs.
7. Extend `arrCredentialRedactionRoutes.test.ts` incrementally per phase as new routes/loads land, not as a single end-of-feature pass.

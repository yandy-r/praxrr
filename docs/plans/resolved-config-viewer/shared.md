# Resolved Config Viewer

The PCD in-memory cache (`PCDCache`, built by replaying schema→base→tweaks→user ops via
`loadAllOperations`) is already the fully resolved configuration state, and
`pcd/entities/serialize.ts` reads it into arr-agnostic `Portable*` shapes; the sync-preview
subsystem (`$sync/preview/*`) already builds per-arr desired payloads, fetches live Arr state
through `getArrInstanceClient()`, and diffs them with `diffToFieldChanges()`. This feature adds a
read-only `$pcd/resolved/*` service (readers dispatch table, a net-new side-effect-free
`PCDCache.buildReadOnly({ layers })` build variant, layer diff, live-diff and cross-instance
wrappers), four contract-first endpoints under `/api/v1/pcd/{databaseId}/resolved/**`, and a
viewer page at `/resolved-config/[databaseId]` that reuses the parity-map page idiom and the
`SyncPreviewEntityDiff` visual language. All comparison/live paths dispatch by explicit
`arr_type` (canonical `isArrAppType()`, `isSyncSectionSupported()`) with no sibling-app fallback,
and all new components render values as escaped text only (no `{@html}`/`marked.parse` — the
existing `FieldDiffTable.svelte` markdown path is a known XSS trap that must not be copied).

## Relevant Files

Server — PCD core (modify / extend):

- packages/praxrr-app/src/lib/server/pcd/database/cache.ts: `PCDCache.build()` L38-296; op-execution loop L98-274 interleaves `this.db.exec(op.sql)` with value guards (`evaluateValueGuardApply/Error`), `pcdOpsQueries.update(...,{state:'dropped'})`, `pcdOpHistoryQueries.create(...)` (gated by `trackHistory` from `parseOpId(op.filepath)` at ~L100); catch path calls `disableDatabaseInstance()`. Add `buildReadOnly({ layers })`: execute ops only, skip guards/history/state-mutation/disable, never `setCache`.
- packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts: `loadAllOperations(pcdPath, dbId)` pushes 4 stages in order — schema files → base published → base drafts (offset 3_000_000_000) → tweaks files → user published. "Base" layer = stop before the user stage (skippable at call site, not post-hoc filter).
- packages/praxrr-app/src/lib/server/pcd/database/registry.ts: `setCache/getCache/deleteCache` module map — ephemeral caches must never be registered.
- packages/praxrr-app/src/lib/server/pcd/database/compiler.ts: `compile()` is the only `build()` caller + only `setCache` caller — do not touch its flow.
- packages/praxrr-app/src/lib/server/pcd/core/manager.ts: `pcdManager.getCache(id)` / `getAll()` / `getById(id)` — route-facing cache access convention.
- packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts: 15 `serialize*(cache, name) => Promise<Portable*>` functions (per-entity, per-arr-app; no dispatcher exists); throws plain `Error` on miss — routes translate to 404. `pcd/resolved/readers.ts` builds a `(entityType, arrType) → fn` table over these.
- packages/praxrr-app/src/lib/server/pcd/index.ts: public surface with `// ====` banner sections — add a `// RESOLVED CONFIG` section; routes import from `$pcd/index.ts`, never deep paths.

Server — sync preview (reuse, no change):

- packages/praxrr-app/src/lib/server/sync/preview/diff.ts: `diffToFieldChanges(current, desired, options?: DiffOptions): FieldChange[]`; `DiffOptions { ignoredFields?, arrayKeyStrategies?, nullAndMissingAreEqual? }`; DEFAULT_IGNORED_FIELDS strips id/links/timestamps; DEFAULT_ARRAY_KEY_STRATEGIES is empty.
- packages/praxrr-app/src/lib/server/sync/preview/sectionDiffs.ts: `diffEntityCollection()`, `diffSingletonEntity()`, exported `CUSTOM_FORMAT_/QUALITY_PROFILE_/QUALITY_DEFINITION_/METADATA_PROFILE_ARRAY_KEY_STRATEGIES` — reuse for layerDiff/liveDiff.
- packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts: `generatePreview(input: GeneratePreviewInput): Promise<GeneratePreviewResult>`; one shared Arr client per call, `close()` in finally, per-section failure isolation; NO per-entity filter — liveDiff must post-filter section payloads by entityType+name.
- packages/praxrr-app/src/lib/server/sync/preview/types.ts: `FieldChange { field, type:'added'|'changed'|'removed', current, desired }`; `EntityChange { entityType, name, action:'create'|'update'|'delete'|'unchanged', remoteId, fields }`; `SyncPreviewArrType = Exclude<ArrType,'all'|'chaptarr'>`. Keep the two vocabularies distinct.
- packages/praxrr-app/src/lib/server/sync/preview/limits.ts: `registerPreviewCreateAttempt(instanceId: number, nowMs: number): boolean` (6/60s per instance — two required args); `PREVIEW_MAX_SNAPSHOTS=200`; `resetPreviewCreateRateLimitForTests()`.
- packages/praxrr-app/src/lib/server/sync/namespace.ts: `findNamespaceMatch()` (pure string matching, no DB), `stripNamespaceSuffix`, `normalizeNamespaceDisplayName` — for matching live entity names.
- packages/praxrr-app/src/lib/server/sync/mappings.ts: `isSyncSectionSupported(arrType, section)`, `getUnsupportedSyncSectionReason()`, `SYNC_SECTION_ORDER`; NOTE `SUPPORTED_SYNC_SECTIONS` is module-private — use the exported functions only. metadataProfiles is Lidarr-only.

Server — Arr/util (reuse; one security modification):

- packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts: `getArrInstanceClient(type, instanceId, url, options?, cache?)` — decrypts credentials, calls `createArrClient()`. MODIFY: call `assertSafeArrUrl(url)` here (W1 — the guard currently has ZERO call sites repo-wide besides two test-connection routes... actually zero in-app besides definition; centralizing here covers preview/library/upgrades too).
- packages/praxrr-app/src/lib/server/utils/arr/urlSafety.ts: `assertSafeArrUrl(url)` L81 — throws on non-http(s), cloud-metadata IPs, link-local; allows RFC1918/loopback (LAN Arr is legitimate).
- packages/praxrr-app/src/lib/server/utils/arr/testConnectionReason.ts: `TestConnectionReason = 'unreachable'|'unauthorized'|'invalid_response'|'timeout'`; `toFailureReason(error)`, `reasonFromStatus(status?)` — template for sanitized per-instance error reasons (W2); never forward `error.message` to clients.
- packages/praxrr-app/src/lib/server/utils/rateLimit.ts: `registerRateLimitAttempt(key, opts?)` generic limiter (30s/8 default); `resetRateLimitForTests()` — building block for the /compare per-user window (W3).
- packages/praxrr-app/src/lib/shared/arr/capabilities.ts: `isArrAppType(value): value is ArrAppType` (L275), `ARR_APP_TYPES` — canonical arrType allowlist (W4).
- packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts: `arrInstancesQueries` — every SELECT hard-codes `'' AS api_key`; only sanctioned instance accessor (W5).
- packages/praxrr-app/src/lib/server/db/queries/arrNamespaces.ts: `arrNamespaceQueries.get(instanceId, databaseId)` is the read-only namespace-index lookup; `.getOrCreate()` MUTATES — never call it from resolved/live-diff paths.
- packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts: `pcdOpsQueries.listByDatabaseAndOrigin(dbId,'user',{states:['published']})` — user-op provenance source.
- packages/praxrr-app/src/lib/server/db/queries/pcdOpHistory.ts: `pcdOpHistoryQueries.listLatestConflictsByDatabase()` — conflict-badge annotation source.
- packages/praxrr-app/src/lib/shared/pcd/portable.ts: `Portable*` types — canonical resolved payload shapes.
- packages/praxrr-app/src/lib/shared/pcd/types.ts: `PCDDatabase` (34 cache tables) for `cache.kb` typing.

Routes / contract:

- packages/praxrr-app/src/routes/api/v1/compatibility/parity/+server.ts: THE handler copy target — auth-first (`!locals.user && !locals.authBypass` → 401), `/^\d+$/` param check (400), `pcdManager.getCache(id)?.isBuilt()` guard → 400 "Database not found" (not 404), try/catch with `logger.error(msg,{source,meta:{error: e.message}})` → generic 500, every response `satisfies components['schemas'][...]`.
- packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts: preview endpoint precedent — 64KB body cap, store capacity 429, `registerPreviewCreateAttempt` 429.
- packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/: existing siblings `snapshots/`, `lidarr-metadata-profiles/`; add `resolved/[entityType]/+server.ts`, `resolved/[entityType]/[name]/+server.ts`, `.../compare/+server.ts`, `.../diff/+server.ts`.
- docs/api/v1/openapi.yaml: register paths via `$ref: './paths/resolved-config.yaml#/<key>'` and each named schema individually under `components.schemas` via `$ref: './schemas/resolved-config.yaml#/<Name>'` (mirror compatibility.yaml / pcd-snapshots.yaml registration lines).
- docs/api/v1/schemas/sync.yaml: already publishes `EntityChange`, `FieldChange` — $ref them, do not redefine.
- deno.json: `generate:api-types` = `npx openapi-typescript docs/api/v1/openapi.yaml -o packages/praxrr-app/src/lib/api/v1.d.ts`; `bundle:api` = `deno run -A scripts/bundle-api.ts` (regenerates packages/praxrr-api mirror). Run both after contract changes; never hand-edit generated files.

Client:

- packages/praxrr-app/src/routes/parity-map/+page.server.ts: page-load copy target — mirrors route validation but returns `{ error?: string }` in data (inline banner, not SvelteKit error page); `?databaseId=` URL param is the source of truth.
- packages/praxrr-app/src/routes/parity-map/+page.svelte: `{#if}/{:else if}` empty-state ladder; `<select on:change={... goto()}>` database picker.
- packages/praxrr-app/src/routes/parity-map/ParityMatrix.svelte: `Table.svelte` + `Badge.svelte` + `Column<T>[]` matrix idiom for the cross-instance grid.
- packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewEntityDiff.svelte: diff visual language — ACTION_META/FIELD_META glyph (`+ ~ - =`) + color + text label triple-encoding (WCAG 1.4.1); expandable rows; plain `let expanded`, `$:` labels, `on:click`.
- packages/praxrr-app/src/lib/client/ui/meta/JsonView.svelte: highlight.js raw-JSON view — reuse for the raw payload mode.
- packages/praxrr-app/src/lib/client/ui/state/EmptyState.svelte: informational empty states (no overrides / in-sync / check-failed distinctions).
- packages/praxrr-app/src/lib/client/ui/toggle/Toggle.svelte: toggle primitive for the layer segmented control.
- packages/praxrr-app/src/routes/databases/[id]/changes/components/FieldDiffTable.svelte: ANTI-pattern — renders markdown via unsanitized `marked.parse()` + `{@html}` (C1 XSS). Do NOT copy; render all values with escaped `{value}` interpolation.
- packages/praxrr-app/src/lib/server/navigation/registry.ts: `NAV_REGISTRY` array — add entry following `overview.parity_map` / `policies.score_simulator` object shape.

Tests:

- packages/praxrr-app/src/tests/base/syncPreviewDiff.test.ts: pure `Deno.test` + `@std/assert`, zero bootstrap — mirror for layer/diff pure logic.
- packages/praxrr-app/src/tests/routes/parityMapApi.test.ts: route test recipe — import `GET` directly, `buildGetEvent(query, authenticated)` fake event, in-memory `Database(':memory:',{int64:true})` + Kysely + hand-written CREATE TABLE/INSERT for only the tables needed, `setCache/deleteCache` in try/finally.
- packages/praxrr-app/src/tests/pcd/snapshots/service.test.ts: patch-and-restore monkeypatch idiom (`patchTarget`, `patchLoggerForTest`) for module-level stubbing.
- packages/praxrr-app/src/tests/base/arrCredentialRedactionRoutes.test.ts: BaseTest subclass — add one case per new route/load surface (`assertPayloadNoLeak`).
- scripts/test.ts: flat `aliases` map; values may be comma-joined paths (see `parity` alias) — add `resolvedConfig` alias.

## Relevant Tables

- pcd_ops (app DB): origin('base'|'user'), state('published'|'draft'|'superseded'|'dropped'|'orphaned'), source, sequence, sql, metadata, desired_state — replay source; `build()` mutates `state` on conflict auto-drop (buildReadOnly must not).
- pcd_op_history (app DB): per-build op outcome (applied/skipped/conflicted/conflicted_pending/error/dropped/superseded) — conflict badges; written by `build()` (buildReadOnly must not).
- arr_instances / arr_instance_credentials (app DB): instance metadata (api_key always `''` in reads) / AES-GCM encrypted keys.
- arr_database_namespaces (app DB): (instance, database) → namespace_index; `.get()` read-only, `.getOrCreate()` mutates.
- PCD cache tables (in-memory via `cache.kb`): custom_formats(+conditions/tags/tests), quality_profiles(+qualities/custom_formats/languages/tags), quality_api_mappings, quality_groups(+members), delay_profiles, regular_expressions(+tags), {radarr,sonarr,lidarr}_naming, {radarr,sonarr,lidarr}_media_settings, {radarr,sonarr,lidarr}_quality_definitions, lidarr_metadata_profiles(+related).

## Relevant Patterns

**Parity handler shape**: auth-first → strict `/^\d+$/` params → `isBuilt()` guard (400) → try/catch sanitized logging → `satisfies` typed responses. See [packages/praxrr-app/src/routes/api/v1/compatibility/parity/+server.ts](packages/praxrr-app/src/routes/api/v1/compatibility/parity/+server.ts).

**Per-entity-type functions, no generic dispatcher**: one exported function per entity/arr-app (`serializeRadarrNaming` vs `serializeSonarrNaming`), throw on miss; the Cross-Arr policy at the read layer. See [packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts](packages/praxrr-app/src/lib/server/pcd/entities/serialize.ts).

**Contract-first API**: author `docs/api/v1/paths|schemas/*.yaml` → register in `openapi.yaml` → `deno task generate:api-types` → `deno task bundle:api` → handlers import `components['schemas'][...]` from `$api/v1.d.ts`.

**Svelte 4-style (no runes)**: `export let` props, `$:` labels, plain `let` state, `on:click`/`on:change`, `<svelte:fragment slot=... let:x>`. Follow the code, not CLAUDE.md's `onclick` wording. See [packages/praxrr-app/src/routes/parity-map/ParityMatrix.svelte](packages/praxrr-app/src/routes/parity-map/ParityMatrix.svelte).

**Formatting**: trust `.prettierrc` (2-space indent, printWidth 120, singleQuote, trailingComma es5) over CLAUDE.md prose; run `deno task format`.

**Sanitized reason enums**: closed string-union + pure mapping functions; raw error text never reaches responses. See [packages/praxrr-app/src/lib/server/utils/arr/testConnectionReason.ts](packages/praxrr-app/src/lib/server/utils/arr/testConnectionReason.ts).

**Diff triple-encoding**: glyph + color + label per change row (WCAG 1.4.1). See [packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewEntityDiff.svelte](packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewEntityDiff.svelte).

**Test fixtures without real builds**: in-memory SQLite + hand-written schema fragments registered via `setCache`, or patch-and-restore stubbing — never a real `PCDCache.build()` in tests. See [packages/praxrr-app/src/tests/routes/parityMapApi.test.ts](packages/praxrr-app/src/tests/routes/parityMapApi.test.ts).

## Relevant Docs

**docs/plans/resolved-config-viewer/feature-spec.md**: You _must_ read this when working on any task — it is the feature contract (API shapes, decisions, security requirements, phasing).

**docs/plans/resolved-config-viewer/research-architecture.md**: You _must_ read this when working on `buildReadOnly` / `pcd/resolved/*` — exact extraction points and verified signatures.

**docs/plans/resolved-config-viewer/research-integration.md**: You _must_ read this when working on endpoints, OpenAPI registration, rate limits, or Arr clients — exact contract-system mechanics and corrections (private `SUPPORTED_SYNC_SECTIONS`, two-arg limiter).

**docs/plans/resolved-config-viewer/research-patterns.md**: You _must_ read this when writing any route/component/test — copy-paste-grade patterns and the Prettier/Svelte convention corrections.

**CLAUDE.md (repo root)**: You _must_ read the Cross-Arr Semantic Validation Policy, Portable Contract Fidelity, and Arr Cutover Guardrails sections before any Arr-touching code.

**docs/api/v1/paths/compatibility.yaml + docs/api/v1/schemas/compatibility.yaml**: You _must_ read these when authoring the resolved-config contract files — the literal template to mirror.

**docs/prps/plans/completed/cross-arr-parity-map.plan.md**: Reference for how this exact feature shape (contract → server → route → page) was successfully task-ordered before.

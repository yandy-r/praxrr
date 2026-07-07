# Research: Resolved Config Viewer — Integration Facts

Verified against current `main` (commit `c9d7573e`). This supplements
`feature-spec.md` with exact signatures, file paths, and a few corrections.

## Overview

The feature spec's architecture is directionally accurate: `PCDCache` (in-memory
Kysely-backed SQLite) is the resolved state, `entities/serialize.ts` reads it into
`Portable*` shapes, and `sync/preview/*` already has a working diff engine and
orchestrator that can be reused for live diff. Two corrections matter for planning:
`SUPPORTED_SYNC_SECTIONS` in `sync/mappings.ts` is **not exported** (only
`isSyncSectionSupported()` is), and `assertSafeArrUrl()` has **zero call sites**
anywhere in the app (not even a partial/local guard) — W1 is a full gap, not a
gap-in-one-place.

## API Endpoints

### Existing `/api/v1/pcd/[databaseId]/**` conventions

- `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/lidarr-metadata-profiles/+server.ts`
  is the closest existing precedent for a `[databaseId]`-scoped PCD route family.
  - `databaseId` validation: local `POSITIVE_INTEGER_ID = /^\d+$/` regex, parsed with
    `Number.parseInt(rawId, 10)`, rejecting non-integer/`<= 0` — matches the feature
    spec's `/^\d+$/` claim exactly.
  - Cache/database lookup pattern:
    ```ts
    const database = pcdManager.getById(databaseId);
    if (!database) return { error: 'Database not found', status: 404 };
    const cache = pcdManager.getCache(databaseId);
    if (!cache) return { error: 'Database cache not available', status: 500 };
    ```
    Note this route returns 404/500 for missing db/cache — the **parity** endpoint
    (see below) is the actual precedent the spec wants (400 for "not ready"), so
    resolved-config handlers should follow parity's convention, not this one's.
  - Other siblings: `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/snapshots/**`,
    `.../[databaseId]/lidarr-metadata-profiles/[id]/+server.ts`.

- **Parity endpoint convention** (the one the spec explicitly wants to mirror):
  `packages/praxrr-app/src/routes/api/v1/compatibility/parity/+server.ts`
  - Auth fail-closed: `if (!locals.user && !locals.authBypass) return json({error:'Unauthorized'}, {status:401})`.
  - `databaseId` from `url.searchParams` (not path param here), validated with
    `/^\d+$/.test(databaseIdParam)` → 400 `Invalid databaseId`.
  - Cache-not-ready: `const cache = pcdManager.getCache(databaseId); if (!cache?.isBuilt()) return json({error:'Database not found'}, {status:400})` —
    **explicitly 400, not 404**, with an inline comment citing "no sibling-app
    fallback per the Cross-Arr Semantic Validation Policy." This is the exact
    precedent cited in the feature spec's edge-case table.
  - Static payload memoized module-level (`cachedStaticPayload`), rebuilt only for
    the dynamic `profiles` portion — a pattern worth reusing for the
    `ResolvedEntityListResponse` matrix/entities shape if any part is static.

### OpenAPI contract system (`docs/api/v1/`)

- Root file: `docs/api/v1/openapi.yaml` — `openapi: 3.1.0`.
- `paths:` section maps URL templates to file refs, e.g.:
  ```yaml
  /compatibility/parity:
    $ref: './paths/compatibility.yaml#/parity'
  /sync/preview:
    $ref: './paths/sync.yaml#/preview'
  /sync/preview/{previewId}:
    $ref: './paths/sync.yaml#/previewById'
  /pcd/{databaseId}/snapshots:
    $ref: './paths/pcd-snapshots.yaml#/snapshots'
  ```
  Some simple paths (e.g. `/ui-preferences`, `/complexity-tiers`, the Lidarr
  metadata-profile routes) are defined **inline** in `openapi.yaml` itself rather
  than via a `paths/*.yaml` file — both patterns coexist; the spec's plan to use a
  dedicated `paths/resolved-config.yaml` matches the more common (and cleaner)
  pattern used by `compatibility.yaml`, `sync.yaml`, `pcd-snapshots.yaml`.
- `components.schemas:` section registers each schema individually:
  ```yaml
  ParityMapResponse:
    $ref: './schemas/compatibility.yaml#/ParityMapResponse'
  ArrSemanticDifference:
    $ref: './schemas/compatibility.yaml#/ArrSemanticDifference'
  ProfileCompatibility:
    $ref: './schemas/compatibility.yaml#/ProfileCompatibility'
  ```
  Every schema referenced anywhere must have an individual top-level key/`$ref`
  line under `components.schemas` — nested/anonymous schemas inside path files are
  fine but named cross-referenced schemas need this registration line.
- Existing schema/path files relevant as templates: `docs/api/v1/paths/sync.yaml`,
  `docs/api/v1/schemas/sync.yaml` (has `EntityChange`, `FieldChange`,
  `SyncPreviewSection`, etc. — exactly what the spec wants to reuse),
  `docs/api/v1/paths/compatibility.yaml`, `docs/api/v1/schemas/compatibility.yaml`.

### Type generation and bundling

- `deno task generate:api-types` (from `deno.json:69`):
  ```
  npx openapi-typescript docs/api/v1/openapi.yaml -o packages/praxrr-app/src/lib/api/v1.d.ts
  ```
  Single command, reads the root spec (which pulls in all `$ref`'d files via
  `openapi-typescript`'s own resolver), writes `packages/praxrr-app/src/lib/api/v1.d.ts`
  directly — no intermediate bundling needed for this step.
- `deno task bundle:api` (`deno.json:94`) runs `deno run -A scripts/bundle-api.ts`:
  - Reads `docs/api/v1/openapi.yaml`, walks `components.schemas` refs, loads each
    referenced schema **file** once and imports **all** top-level keys from that
    file (not just the one explicitly referenced) into a flat `schemas` map.
  - Walks `paths`, resolving each path file `$ref` via `resolveFileRef()`.
  - `convertRefs()` rewrites every file-relative `$ref` (`'./schemas/x.yaml#/Y'` or
    local `'#/Y'`) into `#/components/schemas/Y'` for the single-file bundle.
  - Writes `packages/praxrr-api/openapi.json` (pretty JSON) and copies
    `packages/praxrr-app/src/lib/api/v1.d.ts` → `packages/praxrr-api/types.ts`,
    injecting JSDoc banners on `paths`/`components`/`operations`/`webhooks`/`$defs`.
  - `deno task publish:api` = `bundle:api` then `cd packages/praxrr-api && deno publish`.
- Handler consumption pattern (`compatibility/parity/+server.ts`):
  ```ts
  import type { components } from '$api/v1.d.ts';
  type ParityMapResponse = components['schemas']['ParityMapResponse'];
  type ErrorResponse = components['schemas']['ErrorResponse'];
  ```
  `$api/v1.d.ts` resolves to `packages/praxrr-app/src/lib/api/v1.d.ts` (per
  `svelte.config.js` alias table) — the generated file, never hand-edited.

### Sync preview endpoint (`routes/api/v1/sync/preview/+server.ts`)

- `POST` only. Body: `{ instanceId: number; sections?: SectionType[]; sectionConfigs?: Partial<Record<SectionType, unknown>> }`.
- Body-size guard: `PREVIEW_REQUEST_BODY_LIMIT_BYTES = 64 * 1024`, checked against
  both the `content-length` header and actual encoded byte length before
  `JSON.parse`.
- Flow: parse body → `arrInstancesQueries.getById(instanceId)` (404 if missing) →
  reject unsupported/disabled instance (400) → `previewStore.cleanup(nowMs)` +
  capacity check (`PREVIEW_MAX_SNAPSHOTS = 200`, 429 if full) →
  `registerPreviewCreateAttempt(instanceId, nowMs)` (429 if throttled) →
  `previewStore.create(initialPreview, nowMs)` → `generatePreview({ instance, sections, sectionConfigs, nowMs })` →
  `previewStore.updateResult(...)` → `json(storedPreview)`.
- No SSRF guard call anywhere in this file or in `generatePreview()` — confirms W1
  is unmitigated on the very endpoint the spec plans to reuse for live diff.

## Database Schema

### `pcd_ops` (migration `041_create_pcd_ops.ts`)

```sql
CREATE TABLE pcd_ops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  database_id INTEGER NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('base', 'user')),
  state TEXT NOT NULL CHECK (state IN ('published', 'draft', 'superseded', 'dropped', 'orphaned')),
  source TEXT NOT NULL CHECK (source IN ('repo', 'local', 'import')),
  filename TEXT,
  op_number INTEGER,
  sequence INTEGER,
  sql TEXT NOT NULL,
  metadata TEXT,
  desired_state TEXT,
  content_hash TEXT,
  last_seen_in_repo_at DATETIME,
  superseded_by_op_id INTEGER,
  pushed_at DATETIME,
  pushed_commit TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (database_id) REFERENCES database_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (superseded_by_op_id) REFERENCES pcd_ops(id)
);
```

Indexes: `idx_pcd_ops_apply_order (database_id, origin, state, sequence, id)`,
unique `idx_pcd_ops_base_filename (database_id, origin, filename) WHERE origin='base' AND filename IS NOT NULL`,
`idx_pcd_ops_hash (database_id, origin, content_hash)`.

`PcdOpState = 'published' | 'draft' | 'superseded' | 'dropped' | 'orphaned'`
(`packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts:4`). Confirms spec's
Decision-Needed #3: no code path currently sets `'orphaned'` via `build()` history
writes — it's set by `pcdOpsQueries.markBaseOrphaned()` directly (separate from the
cache-build loop), consistent with "ignore for v1" being safe.

Query surface (`pcdOpsQueries` in `packages/praxrr-app/src/lib/server/db/queries/pcdOps.ts`):
`create`, `getById`, `listByDatabase(databaseId, origin?)`,
`listByDatabaseAndOrigin(databaseId, origin, { states?, source? })`,
`getBaseByFilename`, `update`, `markBaseOrphaned`. `PCDCache.build()` calls
`pcdOpsQueries.listByDatabaseAndOrigin(this.databaseInstanceId, 'user', { states: ['published'] })`
to get user ops for value-guard matching during replay — any `buildReadOnly`
variant needs the equivalent published-only filtering per Business Rule 1.

### `pcd_op_history` (migration `042_create_pcd_op_history.ts`)

```sql
CREATE TABLE pcd_op_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id INTEGER NOT NULL,
  database_id INTEGER NOT NULL,
  batch_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied','skipped','conflicted','conflicted_pending','error','dropped','superseded')),
  rowcount INTEGER,
  conflict_reason TEXT,
  error TEXT,
  details TEXT,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (op_id) REFERENCES pcd_ops(id) ON DELETE CASCADE,
  FOREIGN KEY (database_id) REFERENCES database_instances(id) ON DELETE CASCADE
);
```

Indexes: `idx_pcd_op_history_status (database_id, status, applied_at)`,
`idx_pcd_op_history_op (op_id, applied_at)`.

`pcdOpHistoryQueries` (`packages/praxrr-app/src/lib/server/db/queries/pcdOpHistory.ts`):
`create`, `listByOp`, `listByDatabase`,
`listLatestByDatabaseWithOps(databaseId, statuses?)` (window-function "latest row
per op_id" query), `listLatestConflictsByDatabase` (wraps the above with
`['conflicted','conflicted_pending']`).

### `PCDCache.build()` write/mutation surface (confirms spec's core risk)

`packages/praxrr-app/src/lib/server/pcd/database/cache.ts` — `build()`:

1. Reads `databaseInstancesQueries.getById()` for `conflict_strategy`.
2. Reads `pcdOpsQueries.listByDatabaseAndOrigin(..., 'user', { states: ['published'] })`.
3. Reads `pcdOpHistoryQueries.listLatestByDatabaseWithOps(..., ['conflicted','conflicted_pending'])`
   for prior-conflict context.
4. Creates a fresh in-memory `Database(':memory:', { int64: true })`, executes ops
   in `loadAllOperations()` order (schema → base → tweaks → user, per
   `loadAllOperations()` in `../ops/loadOps.ts`).
5. **Per user-tracked op** (`filepath` matching `pcd_ops:<id>`), it calls
   `evaluateValueGuardApply()` / `evaluateValueGuardError()`
   (`../migration/valueGuardGate.ts`), can call `pcdOpsQueries.update(trackedOpId, { state: 'dropped' })`
   (mutates `pcd_ops.state`), and **always** calls
   `pcdOpHistoryQueries.create(...)` (writes `pcd_op_history`) for every tracked op
   outcome — confirming the spec's claim that a naive base-only replay reusing this
   loop verbatim would write history rows and potentially flip `pcd_ops.state` even
   for a read-only base/user-diff computation.
6. On any hard failure, calls `disableDatabaseInstance(this.databaseInstanceId)` —
   another write side-effect a read-only variant must not trigger on partial
   failure.
7. `PCDCache` is a plain class with `kb` (Kysely getter, throws if not built),
   `query`/`queryOne` (raw SQL), `validateSql` (SAVEPOINT-based dry run),
   `isBuilt()`, `close()`. There is currently **no `buildReadOnly()` method** — it
   does not exist yet; the spec's Phase 2 primitive is confirmed net-new.
8. `PCDCache` instances are never auto-registered by the class itself — registration
   is external (`setCache(databaseInstanceId, cache)` in
   `packages/praxrr-app/src/lib/server/pcd/database/registry.ts`), so a
   `buildReadOnly()` caller simply must not call `setCache()` for the ephemeral
   instance — no special guard needed inside `PCDCache` itself for the "never
   registered" requirement, just caller discipline.

### `arr_instances` / credentials (`$db/queries/arrInstances.ts`)

- Confirmed: `arrInstanceSelect` constant selects `'' AS api_key` (never the real
  key) in every read path (`getById`, `getAll`, `getByType`, `getBySource`,
  `getBySourceAndName`, `getEnabled`), and mutation helpers accept `apiKey` but
  always write `''` into the `api_key` column too — the real key lives in
  `arr_instance_credentials` (separate table, accessed via
  `arrInstanceCredentialsQueries`), not `arr_instances`. This validates the spec's
  W5 concern and its mitigation ("only `arrInstancesQueries` accessors").
- `ArrInstance` interface: `{ id, name, type, url, external_url, api_key_fingerprint, api_key, tags, enabled, source?, created_at, updated_at }`.

### `arr_database_namespaces` (`$db/queries/arrNamespaces.ts`)

- `arrNamespaceQueries.get(instanceId, databaseId): number | null` — **pure
  read**, no insert.
- `arrNamespaceQueries.getOrCreate(instanceId, databaseId): number` — **mutates**:
  `SELECT`, then on miss computes `MAX(namespace_index)+1` and `INSERT`s a new row.
- This confirms the spec's risk-table claim precisely: a read-only suffix lookup
  (`.get()`) already exists and is distinct from the mutating `.getOrCreate()`
  used by the sync writer path. Live-diff / resolved-view code must call `.get()`,
  never `.getOrCreate()`.

### PCD cache tables (`PCDDatabase` type, `$shared/pcd/types.ts:386-429`)

In-memory Kysely schema (34 tables) exposed via `cache.kb`: `custom_formats`,
`custom_format_conditions`, `custom_format_tags`, `custom_format_tests`,
`quality_profiles`, `quality_profile_custom_formats`, `quality_profile_languages`,
`quality_profile_qualities`, `quality_profile_tags`, `quality_api_mappings`,
`quality_groups`, `quality_group_members`, `qualities`, `delay_profiles`,
`languages`, `regular_expressions`, `regular_expression_tags`,
`radarr_naming`/`sonarr_naming`/`lidarr_naming`,
`radarr_media_settings`/`sonarr_media_settings`/`lidarr_media_settings`,
`radarr_quality_definitions`/`sonarr_quality_definitions`/`lidarr_quality_definitions`,
`lidarr_metadata_profiles` + 3 related tables, plus `condition_*` lookup tables and
`test_entities`/`test_releases`.

## External Services

### Arr client stack

- `getArrInstanceClient(type: ArrType, instanceId: number, url: string, options?: ArrClientOptions, cache?: ArrInstanceClientCache): Promise<BaseArrClient>`
  (`packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts:55`).
  Resolves credentials via `arrInstanceCredentialsQueries.getByInstanceId()` (falls
  back to legacy `arrInstancesQueries.getById().api_key` only if the credentials
  table/db isn't initialized — dev/migration edge case), decrypts via
  `decryptArrInstanceApiKey()`, then `createArrClient(type, url, apiKey, options)`.
  Optional per-request `cache: ArrInstanceClientCache` (a `Map`) avoids
  re-decrypting per section within one `generatePreview()` call; invalidated on
  key-version mismatch via `invalidateMismatchedInstanceClientCache()`.
  **`assertSafeArrUrl()` is never called inside this function** — verified via
  `grep -rln assertSafeArrUrl packages/praxrr-app/src` returning **only**
  `utils/arr/urlSafety.ts` itself (the definition file). No call site exists
  anywhere in the app, including tests. W1 is a complete gap, not partial.
- `assertSafeArrUrl(url: string): void` (`packages/praxrr-app/src/lib/server/utils/arr/urlSafety.ts:81`) —
  throws on non-http(s) scheme, cloud-metadata hostnames
  (`0.0.0.0`, `169.254.169.254`, `fd00:ec2::254`), and link-local ranges
  (169.254.0.0/16, fe80::/10, including IPv4-mapped/NAT64 IPv6 literal smuggling).
  Deliberately **allows** RFC1918 and loopback (self-hosted LAN Arr instances).
- `BaseArrClient` (`packages/praxrr-app/src/lib/server/utils/arr/base.ts:32`)
  extends `BaseHttpClient`, sets `X-Api-Key` header. Relevant methods for
  resolved-config's live diff/compare: `getQualityProfiles()`,
  `getCustomFormats()`, `getMediaManagementConfig()`, `getNamingConfig()`,
  `getQualityDefinitions()`, `getDelayProfiles()`, `getSystemStatus()` /
  `testConnection()`. `apiVersion = 'v3'` by default (overridable by subclass).
  Sonarr/Radarr/Lidarr-specific clients live in `utils/arr/clients/{sonarr,radarr}.ts`
  etc.
- `ArrClientOptions = { timeout?: number; retries?: number }`. Defaults from
  `BaseHttpClient` (`packages/praxrr-app/src/lib/server/utils/http/client.ts`):
  `timeout = 30000`ms, `retries = 3`; retry loop is `for (attempt = 0; attempt <= retries; attempt++)`
  with retry only on `retryStatusCodes` or abort/timeout — not a fixed backoff-ms
  array (no `RETRY_DELAYS_MS` constant found; retries are immediate re-attempts up
  to the count, gated by response status).

### Rate limit utilities

- Generic limiter (`packages/praxrr-app/src/lib/server/utils/rateLimit.ts`):
  ```ts
  export function registerRateLimitAttempt(
    key: string,
    opts?: { windowMs?: number; maxRequests?: number }
  ): boolean;
  ```
  Defaults: `DEFAULT_RATE_LIMIT_WINDOW_MS = 30_000`, `DEFAULT_RATE_LIMIT_MAX_REQUESTS = 8`.
  In-memory `Map<string, {windowStart, count}>`, capped at `MAX_TRACKED_KEYS = 10_000`
  distinct keys with oldest-window eviction — single-process only (no
  cross-instance sharing), explicitly documented as such in the file header.
  `resetRateLimitForTests()` exported for test cleanup.
- Preview-specific limiter (`packages/praxrr-app/src/lib/server/sync/preview/limits.ts`):
  ```ts
  export function registerPreviewCreateAttempt(
    instanceId: number,
    nowMs: number
  ): boolean;
  ```
  Separate sliding-window implementation (own `Map<number, {timestamps:number[]}>`,
  filter-based pruning, **not** built on top of `registerRateLimitAttempt`).
  Constants: `PREVIEW_CREATE_RATE_LIMIT_WINDOW_MS = 60_000`,
  `PREVIEW_CREATE_RATE_LIMIT_MAX_REQUESTS = 6`, `PREVIEW_MAX_SNAPSHOTS = 200`,
  `PREVIEW_REQUEST_BODY_LIMIT_BYTES = 64 * 1024`. Confirms spec's "existing 6/60s
  per instance" claim exactly. `resetPreviewCreateRateLimitForTests()` also
  exported.
  - Implication for `resolved/limits.ts`: the spec's plan to reuse both
    `registerPreviewCreateAttempt` (per-instance live-diff throttle) **and**
    `$utils/rateLimit.ts` (per-user/global fan-out window for `/compare`) is
    consistent with existing precedent — they are two independent, differently-shaped
    limiters, not one generic thing to configure.

## Internal Services

### Sync preview orchestrator

`packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`:

```ts
export interface GeneratePreviewInput {
  instance: ArrInstance;
  sections?: SectionType[];
  sectionConfigs?: Partial<Record<SectionType, unknown>>;
  nowMs?: number;
}
export interface GeneratePreviewResult {
  instanceId: number;
  instanceName: string;
  arrType: SyncPreviewArrType;
  status: SyncPreviewStatus;
  createdAtMs: number;
  sections: SectionType[];
  sectionOutcomes: SyncPreviewSectionOutcome[];
  qualityProfiles: QualityProfilesPreview | null;
  delayProfiles: DelayProfilesPreview | null;
  mediaManagement: MediaManagementPreview | null;
  metadataProfiles: MetadataProfilesPreview | null;
  summary: SyncPreviewSummary;
  errors: ReadonlyArray<string>;
  error?: string;
}
export async function generatePreview(
  input: GeneratePreviewInput
): Promise<GeneratePreviewResult>;
```

- Resolves `arrType` via `toSyncArrType()` (throws on unsupported type — no
  sibling-app fallback, matches Cross-Arr policy).
- `resolveSections()`: if no `sections` requested, runs every section in
  `SYNC_SECTION_ORDER` for which `handler.hasConfig(instanceId)` is true; if
  sections are requested, filters to ones that are still in `SYNC_SECTION_ORDER`
  (drops unsupported ones silently at this layer — the actual per-arrType support
  check happens inside each section's syncer/handler, not here).
- Gets one shared `getArrInstanceClient(...)` for the whole run via
  `createArrInstanceClientCache()`, `client.close()` in a `finally`.
  **Per-entity live-diff (`/diff` endpoint) would need to call this same
  orchestrator or replicate the single-client/close-on-finally pattern** — it is
  not designed to be filtered to one entity internally; the spec's Decision #2
  ("filter full-section preview result") is the only option without new syncer
  code, confirmed.
- Per-section failures are caught individually and pushed into `errors[]` +
  `sectionOutcomes` — partial failure does not abort the whole run.

### `SyncPreviewResult` / `EntityChange` / `FieldChange` (`sync/preview/types.ts`)

```ts
export interface FieldChange {
  readonly field: string;
  readonly type: 'added' | 'changed' | 'removed';
  readonly current: unknown;
  readonly desired: unknown;
}
export interface EntityChange {
  readonly entityType: string;
  readonly name: string;
  readonly action: 'create' | 'update' | 'delete' | 'unchanged';
  readonly remoteId: number | null;
  readonly fields: readonly FieldChange[];
}
export type SyncPreviewArrType = Exclude<ArrType, 'all' | 'chaptarr'>;
```

`SyncPreviewResult` wraps `id, instanceId, instanceName, arrType, createdAt,
expiresAt, status, error?, sections, sectionOutcomes, qualityProfiles,
delayProfiles, mediaManagement, metadataProfiles, summary`. Note
`SyncPreviewFieldChangeType` is `'added' | 'changed' | 'removed'`, **not**
`'create' | 'update' | 'delete'` (that vocabulary is `SyncPreviewAction`, used at
the entity level) — the spec's UI copy ("Create/Update/Delete/Unchanged
vocabulary") applies to `EntityChange.action`, while `FieldChange.type` uses
added/changed/removed. Any new `ResolvedLiveDiffResponse`/`FieldDiffTable` copy
should keep these two vocabularies distinct and not conflate them.

### `diffToFieldChanges()` (`sync/preview/diff.ts`)

```ts
export function diffToFieldChanges(
  current: unknown,
  desired: unknown,
  options: DiffOptions = {}
): FieldChange[];
export interface DiffOptions {
  readonly ignoredFields?: readonly string[];
  readonly arrayKeyStrategies?: readonly PreviewArrayKeyStrategy[];
  readonly nullAndMissingAreEqual?: boolean;
}
export interface PreviewArrayKeyStrategy {
  readonly path: string;
  readonly selectKey: (item: Record<string, unknown>) => string;
}
```

Default ignored fields: `id, links, created, updated, createdAt, updatedAt,
revision, lastExecution, lastExecutionTime, lastModified, dateAdded, dateUpdated`.
`current` = existing/actual, `desired` = target — matches the spec's
`diffToFieldChanges(baseOnly, resolved)` call shape (base = "current", resolved =
"desired") for the user-overrides computation, and `(actual, desired)` for live
diff.

### Namespace utilities (`sync/namespace.ts`)

- `getNamespaceSuffix(index: number): string` — pure, deterministic (1–5 map to
  distinct zero-width chars; 6+ repeats U+200B). No DB access.
- `findNamespaceMatch(desiredName: string, candidateNames: readonly string[], consumedIndexes?: ReadonlySet<number>): NamespaceNameMatch | null` —
  **pure function**, no DB access, no mutation. Precedence: exact match first,
  then suffix-stripped match (shortest suffix wins on ties), returns `null` if
  `desiredName` already has a suffix and no exact match exists (prevents
  accidental cross-db collision). This is what the spec means by
  "read-only suffix lookup" — it's actually namespace-suffix-agnostic string
  matching, not a DB lookup at all; the DB-backed read-only piece is
  `arrNamespaceQueries.get()` (see Database Schema section above).
- `stripNamespaceSuffix`, `hasNamespaceSuffix`, `getNamespaceIndex`,
  `normalizeNamespaceDisplayName` round out the module; `getTrashGuideNamespaceSuffix`
  is a disjoint-prefix variant for TRaSH Guide sources, not relevant here.

### `isSyncSectionSupported` / `SUPPORTED_SYNC_SECTIONS` — **correction**

`packages/praxrr-app/src/lib/server/sync/mappings.ts`:

```ts
export type SyncArrType = Exclude<ArrType, 'all'>;
export const SYNC_SECTION_ORDER: SectionType[] = [
  ...BASE_SYNC_SECTION_ORDER,
  'metadataProfiles',
];
const SUPPORTED_SYNC_SECTIONS: Record<SyncArrType, readonly SectionType[]> = {
  radarr: BASE_SYNC_SECTION_ORDER, // qualityProfiles, delayProfiles, mediaManagement
  sonarr: BASE_SYNC_SECTION_ORDER,
  lidarr: SYNC_SECTION_ORDER, // includes metadataProfiles
};
export function isSyncSectionSupported(
  arrType: SyncArrType,
  section: SectionType
): boolean {
  return SUPPORTED_SYNC_SECTIONS[arrType].includes(section);
}
export function getUnsupportedSyncSectionReason(
  arrType: SyncArrType,
  section: SectionType
): string | null;
```

**`SUPPORTED_SYNC_SECTIONS` itself is module-private (no `export`)** — only
`isSyncSectionSupported()`, `SYNC_SECTION_ORDER`, and
`getUnsupportedSyncSectionReason()` are exported. The feature spec lists
`SUPPORTED_SYNC_SECTIONS` alongside `isSyncSectionSupported` as something to reuse
directly; code should call the exported predicate/reason functions, not import the
constant. `metadataProfiles` is Lidarr-only — Radarr/Sonarr never support it,
confirming the spec's cross-Arr gating requirement.

### `isArrAppType` location

`packages/praxrr-app/src/lib/shared/arr/capabilities.ts:275`:

```ts
export function isArrAppType(value: string): value is ArrAppType {
  return Object.hasOwn(ARR_APPS, value);
}
```

Also in this file: `ARR_APP_TYPES` (`:243`, re-exported from
`$shared/pcd/types.ts`'s `ARR_APP_TYPES`), `getArrAppMetadata`,
`getArrCapabilities`, `supportsArrWorkflow`, `supportsArrSyncSurface`,
`resolveArrTargets`, `supportsFeature`. The parity endpoint imports
`ARR_APP_TYPES` from here for its static `apps` array — same source
resolved-config should use for `arrType` allowlist validation and any
"which arr types support this entity" gating.

### `getDesiredTo()` and value-guard op-metadata helpers

`packages/praxrr-app/src/lib/server/pcd/conflicts/overrideUtils.ts`:

```ts
export function isFromTo(value: unknown): value is { to: unknown }
export function getDesiredTo<T = unknown>(value: unknown): T | undefined
export function followRenameChain(databaseId: number, entityType: string, oldName: string, maxDepth = 10): string
export function normalizeOrderedItems(items: unknown): Array<{...}>
export function orderedItemsEqual(a: unknown, b: unknown): boolean
export function valuesEqual(expected: unknown, actual: unknown): boolean
```

`StoredOpMetadata` shape includes `changed_fields?: string[]` — this is the field
the spec's Business Rule 4 explicitly says NOT to rely on alone for "user
overrides" reconstruction (value guards can drop ops silently, leaving
`changed_fields` stale/misleading relative to actual resolved state).

## Configuration

- Path aliases relevant to this feature (from `packages/praxrr-app/svelte.config.js`,
  mirrored in `deno.json`): `$pcd/` → `.../server/pcd/`, `$sync/` →
  `.../server/sync/`, `$db/` → `.../server/db/`, `$arr/` →
  `.../server/utils/arr/`, `$api/` → `.../lib/api/` (generated `v1.d.ts` lives
  here), `$shared/` → `.../lib/shared/`.
- No new environment variables are implicated by this feature; existing
  `PRAXRR_DEFAULT_DB_*` / `PRAXRR_SCHEMA_*` vars are unrelated to resolved-config
  read paths.
- Test alias registration point: `scripts/test.ts` (spec's task to add a
  `resolved` alias) — existing aliases include `filters`, `normalize`,
  `selectors`, `backup`, `cleanup`, `upgrades`, `jobs`, `logger`.

## Contradictions / Corrections vs. feature-spec.md

1. **`SUPPORTED_SYNC_SECTIONS` is not exported** from `sync/mappings.ts` — only
   `isSyncSectionSupported()` and `getUnsupportedSyncSectionReason()` are. Code
   should use the functions, not attempt to import the constant directly.
2. **`assertSafeArrUrl()` has zero call sites** anywhere in the codebase (verified
   via full-repo grep), not just "not wired into `getArrInstanceClient()`" — W1 is
   a total gap. Centralizing it in `getArrInstanceClient()` (per the spec's Files
   to Modify) is the correct single choke point since both
   `createArrClient()`/`getArrInstanceClient()` and the sync/preview/upgrade/rename
   paths all resolve clients through it.
3. **`PCDCache.buildReadOnly()` does not exist yet** (confirmed by reading the full
   `cache.ts` file) — this is genuinely net-new, not a rename/extension of an
   existing partial method. `build()` is a single ~250-line method with the op-loop,
   value-guard evaluation, and history/state writes tightly interleaved; extracting
   a shared op-execution core will require real refactoring, not just adding a flag.
4. **The "read-only suffix lookup" the spec describes** is two distinct things that
   should not be conflated: `findNamespaceMatch()` (pure string matching, no DB) and
   `arrNamespaceQueries.get()` (DB read, returns `null` on miss, contrasted with
   the mutating `arrNamespaceQueries.getOrCreate()`). Both already exist and are
   already read-only — no new code needed here, just correct call-site selection
   (never call `.getOrCreate()` from resolved-config/live-diff paths).
5. **`entities/serialize.ts` has no generic entityType-keyed dispatcher** — it's a
   flat set of per-entity-type exported functions (`serializeQualityProfile`,
   `serializeCustomFormat`, `serializeRadarrNaming`, etc.), each with a different
   `(cache, name)` signature returning a different `Portable*` type. The spec's
   planned `$pcd/resolved/readers.ts` "dispatch over serialize.ts, fail-fast on
   unknown types" will need to build its own `entityType → serializer` map/switch;
   there's no existing registry to import for this specific purpose (the
   `entities/registry.ts`'s `AUTO_ALIGN_ENTITIES` map, used by
   `overrideUtils.ts:followRenameChain`, is a different registry keyed for a
   different purpose — table names for rename-chain SQL parsing — and only
   incidentally overlaps in shape).

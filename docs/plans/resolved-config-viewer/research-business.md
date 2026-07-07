# Business Research: Resolved Config Viewer (GitHub #25)

## Executive Summary

Praxrr already computes "resolved state" as a side effect of every PCD cache build — `PCDCache.build()`
replays schema → base → tweaks → user ops into a flat in-memory SQLite DB, and all entity reads (e.g.
`qualityProfiles/list.ts`) query that already-resolved cache. This feature's core job is **surfacing**
that existing resolved state in the UI with provenance (which layer produced each value), not computing
it fresh. The hard parts are: (1) the cache has no per-row layer/provenance tracking today — only
op-level metadata (`pcd_ops.metadata`, `desired_state`) exists — so "base only" vs "user override" views
require either a second ephemeral cache build (base+schema+tweaks only, no user ops) or op-history-driven
diffing; (2) "diff against live Arr" and "cross-instance comparison" should reuse the sync-preview diff
engine (`$sync/preview/*`) rather than inventing a new comparator, since it already produces
current-vs-desired `EntityChange`/`FieldChange` structures with namespace-aware matching; (3) cross-instance
comparison must account for instances pointing at *different* PCD databases (sync selections are
per-instance-per-section `{ databaseId, profileName }` pairs, not a single global database).

## User Stories

- As a self-hoster running multiple Radarr/Sonarr/Lidarr instances, I want to see the final computed
  quality profile / custom format / release profile state for an entity so I know exactly what Praxrr
  will push, without mentally replaying base-op + user-op history myself.
- As an admin who applied a local override (user op) on top of a PCD-provided base op, I want to see
  which fields came from the base PCD and which were overridden locally, so I understand why my instance
  differs from the PCD's published default.
- As an admin debugging "sync did something I didn't expect," I want a resolved view I can diff against
  what's actually live on the Arr instance, so I can tell whether the surprise is a stale/unsynced
  instance, a value-guard conflict silently applied an auto-align, or a genuine bug.
- As an admin running the same PCD across several instances (e.g. staging + prod Radarr), I want to
  compare the resolved state of "the same" profile across instances to catch drift caused by
  per-instance profile selection differences, instance-only tweaks, or partially-applied syncs.
- As an admin who just linked a new PCD or pulled upstream changes, I want to preview resolved state
  before committing to a sync, reducing "sync surprises" that erode trust in automation (ties into #21
  Transparent Automation).
- As an admin resolving a value-guard conflict (`databases/[id]/conflicts`), I want the resolved view to
  make clear what "align" vs "override" will produce, since that page currently shows metadata/summary
  text but not a full before/after entity render.

## Business Rules

### Core composition rules

1. **Resolved state = flattened SQL replay, not a data-structure merge.** `PCDCache.build()`
   (`packages/praxrr-app/src/lib/server/pcd/database/cache.ts`) executes ops in strict order — schema →
   base (published, then drafts) → tweaks (file-based) → user (published) — against one in-memory SQLite
   DB (`loadAllOperations`, `packages/praxrr-app/src/lib/server/pcd/ops/loadOps.ts`). There is no
   in-memory "base layer" and "user layer" kept separately; by the time any entity query runs, layers are
   already collapsed into table rows. A "base only" or "user overrides only" view therefore cannot be read
   directly off the built cache — it requires either a second cache build with the user-ops layer omitted,
   or reconstructing state from `pcd_ops`/`pcd_op_history` metadata deltas.
2. **Ops carry origin (`base`|`user`), state (`published`|`draft`|`superseded`|`dropped`|`orphaned`), and
   source (`repo`|`local`|`import`)** (`$db/queries/pcdOps.ts`). Only `published` ops are replayed into the
   cache (base drafts get a synthetic high sequence offset so they preview after published ops but are
   excluded from a "committed resolved state"). Any resolved-config feature must respect these state
   filters exactly as `loadAllOperations` does, or it will show a different resolved state than what
   actually syncs.
3. **Value guards decide what actually lands in the resolved cache when base and user ops collide**
   (`packages/praxrr-app/src/lib/server/pcd/migration/valueGuardGate.ts`). A user op that yields
   `rowcount === 0` (target row missing/changed) or fails a full-list-conflict check is either applied,
   auto-aligned (dropped silently per rule), or recorded as `conflicted`/`conflicted_pending` per the
   database's `conflict_strategy` (`override`|`align`|`ask`). **This means "resolved state" is not a pure
   function of ops content — it also depends on `conflict_strategy` and prior conflict-history state.**
   The viewer must expose this (e.g., "this field would be X per base ops, but a value-guard conflict left
   it at Y") rather than presenting resolved state as if it were deterministic from ops alone.
4. **"Resolved" is entity-type specific.** Named-collection entities (quality profiles, custom formats,
   delay profiles) are matched/diffed by name with namespace-aware matching (`findNamespaceMatch`,
   `packages/praxrr-app/src/lib/server/sync/namespace.ts`); singleton entities (naming config, media
   settings, metadata profile) have exactly one resolved row per database. Any resolved viewer must branch
   on entity shape the same way `sync/preview/sectionDiffs.ts` already does
   (`diffEntityCollection` vs `diffSingletonEntity` vs `diffUnidentifiedPayload`).
5. **Cross-Arr semantics apply.** Per `CLAUDE.md`'s Cross-Arr Semantic Validation Policy, quality-profile
   resolution must filter by `arr_type` compatibility using `quality_api_mappings` (see
   `computeCompatibleProfileNames` in `qualityProfiles/list.ts` and `qualityProfiles/compatibility.ts`,
   also used by the Parity Map, PR #14) — never assume a resolved profile is valid for every Arr app just
   because it exists in the cache.

### Edge cases

- **Entity deleted upstream while user has a local override** — covered today by the value-guard/conflict
  system, not by a dedicated "orphan" UI. E2e spec `1.25-cf-update-upstream-deleted.spec.ts` documents the
  exact scenario: user updates a CF, upstream deletes it, user's op replay gets `rowcount 0` →
  `conflicted`/`conflicted_pending`, surfaced on `/databases/[id]/conflicts`, resolved via
  "Override" (re-create with user's values) or "Align" (accept deletion). The resolved viewer should
  either link to/reuse this conflict resolution flow for such entities, or explicitly show
  "orphaned — conflict pending" state rather than silently omitting the entity.
- **`pcd_ops.state = 'orphaned'`** is a distinct lifecycle state from `conflicted` history status — needs
  clarification during design whether "orphaned" ops (e.g., a user op whose base counterpart was fully
  removed and superseded chain broken) should render in the resolved view at all, and if so, how.
- **Draft base ops** (`origin='base', state='draft'`) are included in cache replay preview but are not yet
  "published" — the resolved viewer must distinguish "resolved (published)" from "resolved (with pending
  drafts)" the way `changes/+page.server.ts` already treats drafts as a separate committable unit
  (`listDraftEntityChanges`, `exportDraftOps`).
- **Instance unreachable during "diff against live"** — `sync/preview/orchestrator.ts` already handles this
  pattern: each section's `generatePreview()` failure is caught per-section, recorded as a
  `SyncPreviewSectionOutcome.error`, and does not fail the whole preview (partial-failure accumulation).
  The resolved-viewer's "diff vs live" mode should reuse this exact resilience pattern rather than treating
  instance unreachability as a hard failure of the whole comparison.
- **Cross-instance comparison where instances use different PCD databases or different profile selections**
  — `arrSync.ts` shows sync selections are `{ instance_id, database_id, profile_name }` tuples per section
  type (quality profiles support multiple selections per instance; delay/media-management/metadata support
  one profile-selection triplet per instance). "Same profile" across instances is therefore ambiguous by
  name alone; the viewer must resolve per-instance which `(databaseId, profileName)` pair is actually
  selected before diffing, and must clearly show when instances aren't even comparing the same PCD source.
- **Rate-limiting during multi-instance live diff** — issue design notes call this out explicitly; the
  codebase already caches/reuses Arr HTTP clients via `createArrInstanceClientCache()` and
  `getArrInstanceClient()` per preview run — reuse this rather than adding a second client pool.
- **Case-insensitive entity name uniqueness** (CLAUDE.md convention) — resolved-view lookups/matches by name
  must be case-insensitive-safe consistent with entity CRUD elsewhere.

## Workflows

### Primary: View resolved state for a single entity

1. User navigates to an entity (e.g. a quality profile) within its existing editor route
   (`/quality-profiles/[databaseId]/[id]/...`) or a dedicated resolved-config page/panel.
2. System resolves the entity from the already-built `PCDCache` for that `databaseId` (via
   `pcdManager.getCache(databaseId)` — same access pattern as the Parity Map API,
   `/api/v1/compatibility/parity/+server.ts`).
3. System renders resolved field values (tree/table view per issue's design note).
4. If the cache is not built (`cache?.isBuilt()` false), surface a clear "database not ready" state rather
   than 404/500 (existing convention seen in the parity API's 400 response for unbuilt cache).

### Toggle layer breakdown (base only / user overrides / resolved)

1. User toggles a layer selector on the resolved view.
2. "Resolved" = default, reads live built cache (as above).
3. "Base only" = requires a scoped cache build/query that replays schema+base(+tweaks) without user ops —
   there is no existing helper for this; `loadAllOperations` always includes all four layers. This is new
   business logic: either (a) build a throwaway secondary cache instance scoped to base-only ops, or
   (b) derive base-only field values from op metadata/desired_state deltas without a full SQL replay.
   Prefer (a) for correctness parity with the real resolved cache, gated by performance cost.
4. "User overrides" = the set of published user ops touching this entity, best sourced from
   `pcdOpsQueries.listByDatabaseAndOrigin(databaseId, 'user', { states: ['published'] })` filtered to the
   entity, similar to how `overrideUtils.ts`/`draftChanges.ts` already correlate ops to entities via
   `metadata.entity` / `metadata.name` / `stable_key`.
5. Empty/no-op layers (e.g., no user overrides exist) must render an explicit empty state, not be
   indistinguishable from "not loaded yet."

### Cross-instance comparison

1. User selects two or more Arr instances (or explicitly compares instance A vs instance B for a given
   section/profile).
2. For each instance, resolve which PCD database + profile/config name is actually selected for that
   section (`databaseInstances`/`arrSync` selection queries) — do not assume all instances share one
   database.
3. For each (database, profile) pair, resolve state from that database's built cache.
4. Render side-by-side, explicitly labeling divergent source databases/profile names when instances aren't
   comparing apples-to-apples (this is itself useful transparency, not just an edge case to hide).
5. Diff engine: reuse `diffEntityCollection`/`diffSingletonEntity` (or a comparable local diff) to produce
   field-level `added`/`changed`/`removed` deltas between the two resolved states.

### Diff against live Arr instance (desired vs actual)

1. This is functionally the same computation the sync-preview system already performs
   (`generatePreview()` in `sync/preview/orchestrator.ts`): fetch current live state via the Arr client,
   compute resolved (desired) state from cache, diff via `sectionDiffs.ts` helpers.
2. Distinguish this feature's read-only "inspect" framing from sync-preview's "about to apply" framing —
   same diff engine, different UI intent/entry point. Reuse `EntityChange`/`FieldChange` types
   (`$sync/preview/types.ts`) rather than defining a parallel diff contract.
3. Partial failures (single Arr instance unreachable, one section's live fetch fails) must not blank the
   whole page — mirror `SyncPreviewSectionOutcome.error`/`skipped` handling.

### Error recovery

- Cache not built / database disabled → explicit inline message + link to database settings/sync status,
  not a generic error page (matches `disableDatabaseInstance` behavior on cache-build failure).
- Entity not found in resolved cache (deleted, renamed via chain, or orphaned) → attempt
  `followRenameChain` resolution (as `qualityProfiles/override/resolve.ts` does) before declaring "not
  found"; if genuinely gone, link to the conflicts page if a pending conflict exists for that entity.
- Live Arr fetch fails (auth, network, rate limit) → show desired/resolved side regardless, mark actual
  side as "unavailable," never fail the whole comparison.
- Value-guard conflict affecting the entity → surface a banner/badge linking to
  `/databases/[id]/conflicts` rather than silently presenting a "resolved" value that a pending conflict
  may still change.

## Domain Model

### Key entities

- **PCD Database** (`database_instances`) — a linked PCD repo/local-path source; owns `pcd_ops`, has a
  `conflict_strategy`, has a `PCDCache` when `enabled`.
- **PCD Op** (`pcd_ops`) — append-only unit of change; `origin` (base/user), `state` (published/draft/
  superseded/dropped/orphaned), `source` (repo/local/import), carries `metadata` (entity/operation/name/
  changed_fields/stable_key) and `desired_state` JSON used for value-guard comparisons and UI diff
  rendering.
- **PCD Op History** (`pcd_op_history`) — per-cache-build execution record per op: `status` (applied/
  skipped/conflicted/conflicted_pending/error/dropped/superseded), `conflict_reason`, `rowcount`. This is
  the audit trail explaining *why* resolved state ended up the way it did.
- **PCD Cache** (`PCDCache`, in-memory SQLite) — the resolved state itself; one per enabled database
  instance, held in a registry (`pcd/database/registry.ts`).
- **Managed entities**: quality profiles, custom formats, delay profiles, media management (naming,
  quality definitions, media settings), metadata profiles (Lidarr), release profiles/regular expressions —
  each with its own `entities/<type>/{create,read,update,delete,list}.ts` and (for quality profiles)
  `override/` resolution + `compatibility.ts` for arr_type filtering.
- **Arr Instance** (`arr_instances`) — a configured Radarr/Sonarr/Lidarr target; independent of any single
  PCD database.
- **Sync selection** (`arrSync.ts`: `ProfileSelection`, `DelayProfilesSyncData`, `MediaManagementSyncData`,
  `MetadataProfilesSyncData`) — per-instance, per-section binding of *which* PCD database and *which*
  named profile/config is the "desired" source for that instance. This is the join point cross-instance
  comparison must traverse.

### State transitions relevant to "resolved"

- Op: `draft → published` (commit) → replayed into cache as part of resolved state.
- Op: `published → superseded` (edited again) → old op excluded from resolve, new op's target wins.
- Op: `published → dropped` (auto-align or manual align on conflict) → excluded from resolve, effectively
  "upstream/aligned" state wins.
- Op history: `applied` (normal) / `skipped` (no-op update) / `conflicted`|`conflicted_pending` (value
  guard blocked) / `error` (hard failure) / `dropped` (aligned) / `superseded` — resolved value is only
  "final" once no `conflicted_pending` history exists for the entity's ops.
- Cache: `not built → built` (on database enable/pull/sync) → `built → rebuilt` on every op mutation
  (create/update/delete write pipeline recompiles). The resolved viewer must always read the *current*
  cache, never a stale snapshot, unless explicitly viewing a historical snapshot (see adjacent
  `pcd-state-snapshot` plan — a different, complementary feature for point-in-time rewind, not currently
  overlapping this feature's live-resolved-state scope).

## Existing Codebase Integration

- **Sync Preview** (`packages/praxrr-app/src/lib/server/sync/preview/`) is the closest existing feature and
  should be the primary reuse target for "diff against live." It already has: `orchestrator.ts`
  (per-section generation with partial-failure handling), `sectionDiffs.ts` (named-collection and
  singleton diff helpers with array-key strategies per entity type), `diff.ts` (low-level field diffing),
  `types.ts` (`EntityChange`, `FieldChange`, `SyncPreviewResult` contracts), and a UI
  (`routes/arr/[id]/sync/components/SyncPreviewPanel.svelte`) that already renders current-vs-desired
  changes per section. A "diff vs live" resolved-config mode can likely call `generatePreview()` (or a
  read-only variant) directly instead of reimplementing comparison logic.
- **Conflicts page** (`/databases/[id]/conflicts`, `pcd/conflicts/`) already exposes value-guard conflict
  state (`alignConflict`/`overrideConflict` actions) but currently shows only metadata/title/summary text,
  not full before/after entity content. The resolved viewer is a natural place to give this page richer
  detail, and conversely, any entity in "conflicted_pending" state that the resolved viewer shows should
  link back here.
- **Changes page** (`/databases/[id]/changes`, `pcd/ops/draftChanges.ts`, `pcd/ops/exporter.ts`) already
  renders per-entity field-level diffs for *draft* ops (before commit/push) with a rich diff-row model
  (`DraftEntitySectionRow`: field/quality_definition_entries/conditions/tests kinds). This is a strong
  existing UI pattern to imitate/reuse components from for the "layer breakdown" (user overrides) view.
- **Parity Map** (PR #14, `routes/parity-map/`, `/api/v1/compatibility/parity`,
  `pcd/entities/qualityProfiles/compatibility.ts`) demonstrates the established pattern for
  cross-arr-type computed views: static matrix + per-database computed `profiles` via
  `pcdManager.getCache(databaseId)`, gated by the Cross-Arr Semantic Validation Policy (fail with 400 on
  unbuilt cache, no sibling-Arr fallback). Follow this same API shape/auth-gating convention
  (`locals.user || locals.authBypass` check) for any new resolved-config API endpoints.
- **Score Simulator** (`routes/score-simulator/[databaseId]/`, `routes/quality-profiles/entity-testing/
  [databaseId]/`) is existing precedent for a dedicated computed/simulated-view page that reads from the
  built cache and renders derived results distinct from the raw editable entity — a UI/IA precedent for
  where a standalone "Resolved Config Viewer" page could live in navigation.
- **Sync selection queries** (`$db/queries/arrSync.ts`, `$db/queries/databaseInstances.ts`,
  `$db/queries/arrInstances.ts`) are the join tables needed to resolve "which database/profile does this
  instance actually use" for cross-instance comparison — no existing UI aggregates this across instances
  today, confirming the issue's claim of a genuine competitive/feature gap.
- **Related open plan**: `docs/plans/pcd-state-snapshot/` — a point-in-time rewind/backup feature for PCD
  state, conceptually adjacent (both surface "PCD state") but functionally distinct (snapshots = historical
  restore points; resolved viewer = live current state + live-vs-desired diff). No functional overlap
  found; safe to develop independently, though a future "resolved state at snapshot X" view is a plausible
  follow-on once both exist.

## Success Criteria

- Resolved view for any managed entity type matches exactly what the next sync would push (verified by
  diffing resolved-viewer output against `sync/preview` output for the same entity/instance — they must
  agree, since both should ultimately derive from the same cache).
- Layer toggle correctly attributes fields to base vs user origin without misrepresenting value-guard
  outcomes (e.g., never silently shows a "user override" value that was actually dropped/aligned).
- Cross-instance comparison correctly identifies and surfaces when instances are not comparing the same
  underlying database/profile, rather than presenting a false apples-to-apples diff.
- Diff-against-live degrades gracefully per-instance/per-section on unreachable Arr instances, consistent
  with existing sync-preview resilience.
- No new sibling-Arr-type fallback logic is introduced; quality-profile/entity resolution stays
  arr_type-explicit per CLAUDE.md's Cross-Arr Semantic Validation Policy.
- Entities with pending value-guard conflicts are never presented as having unambiguous "resolved" values
  without a visible link to conflict resolution.

## Open Questions

1. **Base-only / user-only layer view mechanism**: build a real secondary cache (correctness-first, cost:
   extra in-memory SQLite build per view) vs. derive from op metadata deltas (cheap, but risks drifting
   from actual SQL-replay semantics, especially for value-guard-affected fields)? Needs an architecture
   decision before implementation planning.
2. **Where does this live?** Standalone page (`/databases/[id]/resolved` or similar) vs. panel embedded in
   each entity editor (per issue's "could be a page or a panel" ambiguity) — affects nav registry changes
   (`server/navigation/`) and whether it's single-entity-scoped or database-wide from the start.
3. **Should "diff against live" call the *existing* sync-preview generation path directly**, or does it
   need a read-only/no-side-effect variant (preview generation already appears read-only/no side effects
   at the Arr-instance level, but confirm no preview-store persistence side effects — `sync/preview/
   store.ts` — are undesirable for a pure "inspect" use case)?
4. **`orphaned` op state semantics**: no code path found that sets `pcd_ops.state = 'orphaned'` in the
   files reviewed — confirm where/when this state is actually assigned before deciding how the resolved
   viewer should represent orphaned entities.
5. **Cross-instance comparison scope for MVP**: compare only instances sharing the exact same PCD database
   (simpler, still valuable), or support the general case of differing databases/profile selections per
   instance (matches issue's stated ambition but is materially more complex given the join-table
   resolution described above)?
6. **Rate-limit policy specifics for multi-instance live diff**: is there an existing rate-limit/backoff
   utility in `$http/` or `$arr/` intended for fan-out multi-instance calls, or does this feature need to
   introduce one?

# Resolved Config Viewer (#25) — Research & Recommendations

## Executive Summary

The Resolved Config Viewer is far less green-field than it appears. Two of the four
sub-features are already implemented or nearly free:

1. **Resolved view (bullet 1)** is essentially free. The PCD cache
   (`$pcd/database/cache.ts`) is the compiled resolved state, and
   `$pcd/entities/serialize.ts` + `$pcd/entities/*/list.ts` already read full entities
   out of it as portable/display objects. A read-only "resolved" panel is mostly a
   thin API + UI layer over existing readers.
2. **Diff against live (bullet 4)** already exists as the **sync preview** subsystem
   (`$sync/preview/*`, `POST /api/v1/sync/preview`). It builds a "desired" payload from
   the cache, fetches live Arr state, and produces a field-level diff with a reusable
   deep-diff engine (`$sync/preview/diff.ts`), TTL store, and rate limiting. The viewer
   should surface/reframe this rather than rebuild it.

The genuinely new engineering is **bullet 2 (layer breakdown: base only / user
overrides / resolved)** and **bullet 3 (cross-instance comparison)**. Layer breakdown
is the hard part because the cache **merges all layers (schema → base → tweaks → user)
into one in-memory SQLite DB** — there is no per-layer cache, so "base only" cannot be
read from the live cache without either a second (read-only) compile pass or
reconstruction from op metadata.

**Recommended framing:** ship a read-only resolved/layer viewer first (net-new value),
reuse sync preview verbatim for live-diff, and defer cross-instance comparison. This
directly lays the foundation #7 (sync preview — already shares the diff engine), #15
(drift detection — drift == resolved-vs-actual over time), and #21/#26.

---

## Implementation Recommendations

### Technical approach

The resolved state already exists in three accessible forms; pick the right one per
sub-feature:

| Need | Source | Cost |
| --- | --- | --- |
| Resolved (base+user merged) domain read | `getCache(dbId)` → `serialize.ts` / `entities/*/list.ts` | Free (already built) |
| Resolved → Arr payload (namespaced, per `arr_type`) | `$sync/*/syncer.ts` `generatePreview()` | Built (sync preview) |
| Live Arr actual state + field diff | `$sync/preview/orchestrator.ts` + `diff.ts` | Built (sync preview) |
| Base-only resolved | **new** read-only layered compile pass | New work |
| User-overrides delta | `$pcd/ops/draftChanges.ts` pattern (op metadata) OR diff(base-only, resolved) | Partly built |

Cache access is centralized: `pcdManager.getCache(id)` / `getCache(id)` returns a
`PCDCache` exposing `cache.kb` (typed Kysely over `PCDDatabase`) and `cache.query()`.
The parity-map endpoint (`routes/api/v1/compatibility/parity/+server.ts`) is a working
template for "read the cache, compute a view, return JSON" and shows the auth + fail-
fast (`400` on unbuilt cache, no sibling fallback) conventions to copy.

**Layer breakdown — the core design decision.** The cache build
(`PCDCache.build()`, cache.ts L98-274) runs value-guard evaluation and **writes op
history and mutates `pcd_ops.state`** (e.g. force-drops conflicting ops via
`pcdOpsQueries.update(..., { state: 'dropped' })`, `pcdOpHistoryQueries.create`). A
base-only pass therefore **must not reuse the mutating build path** — it needs a
read-only/dry build mode that loads only `schema + base` ops
(`loadAllOperations` variant, loadOps.ts L72-96 omits the `user` step) and executes SQL
into a throwaway in-memory DB with history/state-mutation disabled. Then:

- **base only** = read entities from the base-only ephemeral cache.
- **resolved** = read entities from the live merged cache.
- **user overrides** = server-side `diffToFieldChanges(baseOnly, resolved)` per entity
  (reuses `diff.ts`, correct by construction), optionally annotated with op provenance
  from `pcd_ops` where `origin='user'` (metadata JSON: `operation`, `entity`, `name`,
  `changed_fields`, `desired_state`; see `draftChanges.ts`).

This "diff two caches" approach is more robust than trusting `changed_fields` metadata
alone, and it reuses the exact diff engine the viewer already needs.

### Technology choices (align with repo conventions)

- **Server-computed diffs.** Keep diff logic on the server in `$sync/preview/diff.ts`
  (already there) or a promoted `$shared` module. Arr semantics stay server-side; the
  client (Svelte 5, **no runes**, `onclick` handlers) renders precomputed rows.
- **Contract-first API.** Define OpenAPI schemas in
  `packages/praxrr-app/src/routes/api/v1/openapi.json`, run `deno task generate:api-types`,
  then implement using `components['schemas'][...]` (as parity does). New endpoints under
  `/api/v1/config/resolved` (or similar).
- **UI reuse.** `$ui/table/Table.svelte`, `$ui/badge/Badge.svelte`, the sync
  `SyncPreviewPanel.svelte` / `ChangesActionsBar`, and the parity-map
  `ParityMatrix.svelte` / `$lib/client/ui/parity/*` are all directly reusable for
  tree/table + diff + side-by-side layouts.
- **Memoize base-only builds** keyed on the published-ops fingerprint. Reuse
  `computeStateHash(databaseId)` from `snapshots/service.ts` (SHA-256 over published
  `pcd_ops`) as the cache key so a base-only cache is only rebuilt when base ops change.

### Phasing (which bullet first; is live-diff separable?)

**Live-diff is fully separable from the resolved view — and already exists.** Do not
gate the resolved view on live fetches.

- **Phase A — Resolved + Layer viewer (net-new value):** resolved read API + base-only
  read-only compile + `user-overrides` diff + a page/panel with the base/user/resolved
  toggle. No live Arr calls; fast, deterministic, cacheable.
- **Phase B — Live-diff surfacing (reuse):** embed/reframe the existing sync-preview
  payload as "Desired (PCD) vs Actual (Arr)" for a single entity/instance. Mostly UI +
  a per-entity slice of the preview.
- **Phase C — Cross-instance comparison (defer):** side-by-side of resolved/desired/
  actual across N instances, reusing preview limits and `diff.ts`.

### Quick wins (what the PCD cache gives for free)

- Per-entity **resolved** read via existing `serialize*` / `list()` functions — no new
  compilation logic.
- A whole-database **resolved snapshot** (portable JSON) by iterating existing
  serializers — reusable by #26 (dependency graph) and future export.
- Field-level diffs for cross-instance/layer via `diffToFieldChanges` with the existing
  array-key strategies in `sectionDiffs.ts` (quality items by name, formatItems by
  format id, specifications by name+implementation).
- Live desired-vs-actual per section via `generatePreview()` — bullet 4 with zero new
  diff code.

---

## Improvement Ideas

- **Foundation for Sync Preview (#7):** #7 already shares this feature's diff engine.
  Promote `diff.ts` + `sectionDiffs.ts` key strategies into a shared "config diff"
  module so both the viewer and preview draw from one contract. A single-entity
  "explain this change" view in the viewer becomes the drill-down target for preview
  rows.
- **Foundation for Drift Detection (#15):** drift == resolved(desired) vs actual(Arr)
  divergence sampled over time. The viewer's live-diff (bullet 4) is exactly the drift
  primitive; #15 adds scheduling + persistence + alerting on top of the same
  desired/actual comparison. Emit a stable per-entity "diff summary" shape now so #15
  can store and trend it.
- **Persist resolved snapshots for temporal diffs.** Snapshots today store only
  fingerprints (`cache_state_hash`, op counts) — not resolved payloads
  (`snapshots/service.ts`). Adding an optional resolved-state blob unlocks
  "before/after sync" and historical drift for #15/#21 without new compilation.
- **Provenance overlay.** Annotate each resolved field with which op set it (base op id
  vs user op id) using `pcd_ops` metadata. Turns the viewer into a debugging tool ("why
  is this field this value?") — the core #21 transparency promise.
- **Dependency-graph hook (#26).** While serializing resolved entities, emit the
  reference edges (quality profile → custom formats via `getReferencedCustomFormatNames`,
  regex → tags, etc.) so #26 can build the graph from the same read pass.

---

## Risk Assessment

### Technical risks

| Risk | Severity | Notes / Mitigation |
| --- | --- | --- |
| **Base-only compile mutates state/history.** `PCDCache.build()` writes `pcd_op_history` and can force-drop ops (`state='dropped'`). A naive base-only reuse would corrupt real data. | High | Add a read-only/dry build flag that disables history writes and `pcd_ops` mutation, and skips value-guard auto-drop. Build into a throwaway `:memory:` DB, never `setCache`. |
| **Second compile cost.** Each base-only view = a full in-memory replay of schema+base ops (timing tracked in `CacheBuildStats.timing`, typically tens–hundreds ms). | Medium | Memoize keyed on `computeStateHash`; build lazily on first "base only" toggle; reuse for all entities in that DB. |
| **"User overrides" correctness.** Trusting `metadata.changed_fields` can miss fields a user op actually changed or drop ops eliminated by value guards. | Medium | Derive overrides from `diff(baseOnly, resolved)` (ground truth), use op metadata only as provenance annotation. |
| **Cross-Arr payload semantics.** Resolved PCD read is Arr-agnostic; the "desired" for live-diff is Arr-specific (namespace suffixes, `quality_api_mappings` per `arr_type`, per-app transforms in `transformer.ts`). Mixing them mislabels state. | High | Per CLAUDE.md Cross-Arr policy: label panels explicitly ("PCD domain state" vs "desired Arr payload for <type>"), dispatch by `arr_type`, no sibling fallback. |
| **Namespace suffixes on live entities.** Live Arr entities carry invisible suffixes; naive name matching fails. | Medium | Reuse `normalizeNamespaceDisplayName` / `findNamespaceMatch` from `namespace.ts` (already used by preview). |
| **Multi-instance live fetch load.** Cross-instance = N instances × sections live calls; rate limits and API pressure. | Medium | Reuse `$sync/preview/limits.ts` (`PREVIEW_MAX_SNAPSHOTS`, per-instance create rate limit) and the TTL `previewStore`. Fetch lazily, cache actual state per instance. |
| **UI complexity across 4 sub-features.** Tree/table + layer toggle + diff + N-way matrix is a large surface. | Medium | Ship read-only resolved/layer first; treat matrix/live as separate phases. |

### Integration challenges

- **Where it lives.** Entity editors exist at `routes/quality-profiles/[databaseId]`,
  `custom-formats/[databaseId]`, `media-management/[databaseId]`; parity-map is a
  standalone page precedent. Recommend a standalone viewer page **plus** a reusable
  panel component embeddable in editors (issue explicitly allows "page or panel").
- **Contract-first friction.** Must author OpenAPI schema and regenerate types before
  implementing; budget for it in every phase.
- **Cache availability.** Views must fail fast when a cache is not built (parity uses
  `400`); handle disabled/unlinked databases and non-Git local-path sources gracefully.

### Performance

- Resolved reads are cheap SQLite queries against an in-memory DB — negligible.
- Base-only compile is the only heavy server op; memoize aggressively.
- Live/cross-instance are network-bound; reuse preview rate limiting + TTL caching.

### Security

- Copy parity's auth gate: reject unless `locals.user || locals.authBypass`.
- Never leak Arr API keys/credentials in resolved/diff payloads (redaction patterns
  exist; see `arrCredentialRedactionRoutes` tests).
- Validate `databaseId`/`instanceId` strictly (digits-only, positive int) as parity and
  preview routes do.

---

## Alternative Approaches

### (a) Read-only resolved JSON/tree panel first vs (b) full diff engine first

- **(a) Resolved panel first** — Pros: near-free (existing serializers), no live calls,
  deterministic, immediate transparency value, unblocks layer breakdown. Cons: no
  desired-vs-actual until later. Effort: **Low–Med**.
- **(b) Diff engine first** — Pros: highest-value comparison. Cons: **already built** as
  sync preview; rebuilding is wasted effort. Effort: **High (redundant)**.
- **Recommendation: (a).** The diff engine already exists; net-new value is the
  resolved/layer read. Surface existing preview for the diff bullet.

### (c) Server-computed diff vs client-computed diff

- **Server-computed** — Pros: reuses `diff.ts`, keeps Arr semantics + namespace logic
  server-side, small payloads, single source of truth shared with #7/#15. Cons: a bit
  more API surface. Effort: **Low** (engine exists).
- **Client-computed** — Pros: fewer endpoints. Cons: duplicates diff logic in a
  no-runes Svelte client, ships large raw payloads, risks Arr-semantic drift between
  client and server. Effort: **Med**, higher long-term cost.
- **Recommendation: server-computed**, reusing/promoting `$sync/preview/diff.ts`.

### Base-only computation: second compile vs op-metadata reconstruction vs diff-of-two-caches

- **Second (read-only) compile + diff(base, resolved)** — most correct, reuses
  compilation + diff engine; costs one memoized build. **Recommended.**
- **Op-metadata reconstruction only** — cheapest, no compile, but approximate and
  drift-prone. Use only as a provenance overlay.

---

## Task Breakdown Preview

Sized for a parallel implementation plan. Dependencies noted.

### Phase 0 — Contract & scaffolding (S)
- Define OpenAPI schemas: `ResolvedEntity`, `ResolvedConfigResponse`, `LayerBreakdown`
  (`baseOnly` / `userOverrides` / `resolved`), reuse `FieldChange`. Regenerate types.
- New route skeleton `GET /api/v1/config/resolved` + auth/validation (copy parity).
- Complexity: **Low**. Blocks all later phases.

### Phase 1 — Resolved view (M) — *depends on Phase 0*
- **1a** Resolved read service: wrap `serialize.ts` / `entities/*/list.ts` into a
  per-entity + whole-database resolved reader. (Low)
- **1b** Endpoint returns resolved entity(ies) as portable JSON. (Low)
- **1c** UI: resolved tree/table panel + standalone page, reusing `Table`/`Badge`;
  embeddable panel component. (Med)
- Quick win; no live calls.

### Phase 2 — Layer breakdown (L) — *depends on Phase 1; highest new engineering*
- **2a** Read-only/dry layered compile: `loadAllOperations` variant (schema+base only)
  + `PCDCache` dry mode that disables history writes / state mutation / auto-drop. (High)
- **2b** Memoized base-only cache keyed on `computeStateHash`. (Med)
- **2c** `userOverrides = diffToFieldChanges(baseOnly, resolved)` per entity + optional
  op provenance from `pcd_ops`. (Med)
- **2d** UI toggle: base only / user overrides / resolved. (Med)
- Critical path; parallelizable internally after 2a lands.

### Phase 3 — Live-diff surfacing (M) — *independent of Phase 2; reuses sync preview*
- **3a** Per-entity slice/adapter over `generatePreview()` payload → "Desired vs Actual"
  for one entity/instance. (Med)
- **3b** UI: desired/actual diff view reusing `SyncPreviewPanel`/`diff` rendering, clear
  PCD-vs-Arr labeling per `arr_type`. (Med)
- Can run in parallel with Phase 2.

### Phase 4 — Cross-instance comparison (L) — *depends on Phases 1 & 3; deferrable*
- **4a** N-instance orchestration reusing preview limits/store + `diff.ts`. (High)
- **4b** Side-by-side/matrix UI reusing `ParityMatrix.svelte` patterns. (Med)
- Ambiguous semantics (see Open Questions) — resolve before starting.

### Phase 5 — Foundation hooks for #7/#15/#26 (S, opportunistic)
- Promote shared diff module; emit stable diff-summary shape; optional resolved-snapshot
  persistence; dependency edges during serialize. (Low–Med)

---

## Key Decisions Needed

1. **Base-only computation strategy:** read-only second compile + diff (recommended) vs
   op-metadata reconstruction vs live-cache-only (not possible). Confirm the dry-build
   mode is acceptable engineering.
2. **Layer semantics:** do "base only / user overrides / resolved" operate on the
   **raw PCD domain model** (Arr-agnostic, recommended) or the **Arr payload**
   (post-transform)? Live-diff (bullet 4) must be Arr-payload.
3. **Where schema + tweaks layers go.** Issue names 3 layers; schema/tweaks are also
   compiled. Fold them into "base" for display, or expose separately?
4. **Page vs panel vs both.** Recommend both (standalone page + embeddable editor panel).
5. **Reuse vs rebuild live-diff.** Confirm bullet 4 = surface existing sync preview
   (recommended) rather than a new resolved-vs-live endpoint.
6. **Scope commitment:** ship bullets 1+2 first, treat 4 as preview reuse, defer 3.

## Open Questions

- **Cross-instance meaning:** resolved PCD state is per-database, not per-Arr-instance.
  Does "same profile across different instances" mean (a) the **desired Arr payload**
  each instance would receive (differs by namespace/selection/`arr_type`), or (b) the
  **live actual** state on each instance? This changes Phase 4 entirely.
- **Temporal diff:** does #25 require "before vs after sync" over time? That needs
  resolved-state persisted in snapshots (currently only hashes are stored).
- **Provenance granularity:** is per-field "which op set this" required, or is a
  base/user delta sufficient for the first release?
- **Multi-database instances:** when one Arr instance syncs from multiple PCD databases,
  how should the resolved view aggregate/segment by source database?
- **Non-supported Arr types:** `chaptarr`/`all` are excluded from preview
  (`SyncPreviewArrType`); confirm the viewer mirrors that exclusion.
```

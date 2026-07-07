# Feature Spec: Resolved Config Viewer (Issue #25)

## Executive Summary

The Resolved Config Viewer surfaces the fully computed PCD configuration state — the result of
replaying schema → base → tweaks → user ops — for every managed entity, with a layer-breakdown
toggle (base only / user overrides / resolved), cross-instance comparison, and a desired-vs-actual
diff against live Arr state. The PCD in-memory cache (`PCDCache`) already _is_ the resolved state
and `$pcd/entities/serialize.ts` already reads it into arr-agnostic `Portable*` shapes, so the
resolved view is a thin read surface; the live diff reuses the existing sync-preview pipeline
(`$sync/preview/*`) and its `diffToFieldChanges()` engine verbatim. The single genuinely new server
primitive is a **side-effect-free layer-subset cache build** (`PCDCache.buildReadOnly({ layers })`)
— today's `build()` writes `pcd_op_history` and can mutate `pcd_ops.state`, so a naive base-only
rebuild would corrupt real data. Primary risks: layer-computation correctness, cross-Arr payload
semantics (strict per-`arr_type` dispatch, no sibling fallback), a stored-XSS trap if the existing
unsanitized markdown diff pattern is copied, and fan-out load from multi-instance live fetches.

## External Dependencies

### APIs and Services

#### Radarr API v3

- **Documentation**: https://radarr.video/docs/api/ (JS-rendered; authoritative schema at a running
  instance's `/api/v3/openapi.json`)
- **Authentication**: `X-Api-Key` header (already handled by `BaseArrClient`)
- **Key Endpoints**: `GET /api/v3/qualityprofile`, `GET /api/v3/customformat`,
  `GET /api/v3/config/mediamanagement`, `GET /api/v3/config/naming` — full arrays, no pagination
- **Rate Limits**: none documented for the local API; concurrency bounding is courtesy-based

#### Sonarr API v3 (serves Sonarr v3 and v4 apps)

- **Documentation**: https://sonarr.tv/docs/api/
- **Authentication**: `X-Api-Key` header
- **Key Endpoints**: `GET /api/v3/qualityprofile` (no `language` field, unlike Radarr),
  `GET /api/v3/releaseprofile` (Sonarr-only), `GET /api/v3/customformat` (**v4-app-only**)
- **Constraints**: custom formats absent on Sonarr v3 apps; `SourceSpecification` numeric enums
  differ between Radarr and Sonarr — never diff cross-app without explicit `arr_type` scoping

### Libraries and SDKs

| Library      | Version | Purpose                                                                                                                              | Installation |
| ------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| _(none new)_ | —       | Diffing is hand-rolled and already exists (`$sync/preview/diff.ts`); JSON display uses existing `highlight.js` via `JsonView.svelte` | n/a          |

Decision: **no new dependencies**. `jsondiffpatch` is explicitly rejected (CVE-2026-8657 prototype
pollution, CVE-2026-8656 XSS in its HTML formatter, supply-chain incident history). `microdiff` is
an acceptable fallback only if hand-rolled comparison becomes unwieldy — it will not, because the
diff engine already exists in-repo.

### External Documentation

- [ArgoCD diffing customization](https://argo-cd.readthedocs.io/en/stable/user-guide/diffing/):
  normalize-before-diff pattern (strip unmanaged fields, key arrays by stable identity)
- [Terraform JSON plan format](https://developer.hashicorp.com/terraform/internals/json-format):
  one diff shape reused for both layer deltas and live drift
- [WCAG 1.4.1 Use of Color](https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html):
  diff indicators must not rely on color alone

## Business Requirements

### User Stories

**Primary User: Self-hoster managing one or more Radarr/Sonarr/Lidarr instances**

- As an admin, I want to see the final computed state for any PCD entity so that I know exactly
  what Praxrr will push without mentally replaying op history.
- As an admin who applied local overrides, I want to see which fields differ from the published
  base so that I understand why my instance diverges from the PCD default.
- As an admin debugging an unexpected sync, I want to diff resolved (desired) state against what is
  actually live on the Arr instance so that I can tell stale-instance drift from a config bug.
- As an admin running the same PCD across several instances, I want side-by-side comparison of the
  per-instance desired payloads (and optionally live state) so that I catch per-instance selection
  divergence.

### Business Rules

1. **Resolved state = SQL replay of published ops** exactly as `loadAllOperations()` orders them
   (schema → base → tweaks → user); any layer view must respect the same state filters
   (`published` only) or it will disagree with what actually syncs.
   - Validation: resolved-view output for an entity must equal what sync preview computes as
     "desired" for the same entity (single source of truth).
2. **Layer views must never mutate state.** The base-only build must skip value-guard evaluation,
   `pcd_op_history` writes, and `pcd_ops.state` mutation, and must never be registered in the
   cache registry.
3. **"Base" for display = schema + base + tweaks** (user ops omitted). Tweaks are not a separate
   toggle in v1.
4. **User overrides = diff(base-only, resolved)** computed with `diffToFieldChanges()` and the
   existing array-key strategies — ground truth by construction, never reconstructed from
   `metadata.changed_fields` alone (value guards can drop ops silently).
5. **Cross-Arr policy (repo CLAUDE.md) is load-bearing**: all comparison/live endpoints dispatch by
   explicit `arr_type` validated against the canonical allowlist; unsupported (arrType, section)
   combos are reported as `compatible: false`, never as a misleading empty diff; no sibling-app
   fallback anywhere.
6. **Entities with pending value-guard conflicts** must render a visible conflict indicator linking
   to `/databases/[id]/conflicts` rather than presenting an unambiguous "resolved" value.

### Edge Cases

| Scenario                                                                    | Expected Behavior                                               | Notes                                               |
| --------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------- |
| Cache not built / database disabled                                         | 400 with explicit "database not ready" message                  | Mirrors parity endpoint convention (400, not 404)   |
| Entity absent in requested layer (e.g. user-op-created entity in base view) | 200 with `present: false`                                       | 404 reserved for hard miss in the resolved layer    |
| No user overrides for entity                                                | Explicit informational empty state ("resolved matches base")    | Must be distinguishable from loading/error          |
| Instance unreachable during live diff                                       | Per-instance error status; other instances still render         | Sanitized reason enum, never raw `error.message`    |
| Empty live diff                                                             | Positive "in sync" state, visually distinct from "check failed" | Highest-stakes ambiguity for a debugging tool       |
| Live entity carries namespace suffix                                        | Match via existing namespace-aware matching                     | Reuse `findNamespaceMatch`; read-only suffix lookup |
| Cross-instance compare with mixed arr_type                                  | Per-instance `compatible: false` with explicit reason           | Fail fast per Cross-Arr policy                      |
| Instance count above cap                                                    | 400 with clear message                                          | Hard cap (8 instances/request)                      |
| Sonarr v3 app instance (no custom formats)                                  | Gate custom-format live/compare on app capability               | Version skew inside "v3 API"                        |

### Success Criteria

- [ ] Resolved view output for any supported entity type matches sync preview's desired payload
      derivation (both read the same cache through the same serializers/transformers).
- [ ] Layer toggle attributes fields to base vs user without misrepresenting value-guard outcomes.
- [ ] Layer-view requests perform zero writes to `pcd_ops` / `pcd_op_history` (asserted by test).
- [ ] Cross-instance comparison labels per-instance source (database, selection, arr_type) and
      never presents incompatible combos as comparable.
- [ ] Live diff degrades gracefully per instance; desired side always renders.
- [ ] New endpoints return 401 without a session; no CORS headers emitted; no credential fields in
      any response (extend `arrCredentialRedactionRoutes` test suite).
- [ ] `deno task lint`, `deno task check`, `deno task test` all pass.

## Technical Specifications

### Architecture Overview

```text
pcd_ops / pcd_op_history (app DB)
        │ loadAllOperations (schema→base→tweaks→user)
        ▼
  PCDCache (registry, resolved) ◄── pcdManager.getCache(dbId)
  PCDCache.buildReadOnly({layers}) ── ephemeral base-only cache (NO value guards, NO history writes)
        │
        ▼
  $pcd/resolved/*  (NEW read-only service)
    readers.ts   → Portable* payloads via entities/serialize.ts
    layers.ts    → base-only ephemeral build
    layerDiff.ts → diffToFieldChanges(baseOnly, resolved)  [reuses $sync/preview/diff.ts]
    liveDiff.ts  → section syncer generatePreview() filtered to entity  [reuses $sync/preview]
    compare.ts   → per-instance desired payloads (+optional live) with arr_type gating
    limits.ts    → fan-out rate limit + instance cap
        │
        ▼
  /api/v1/pcd/{databaseId}/resolved/**  (contract-first OpenAPI)
        │
        ▼
  Client: /resolved-config/[databaseId] page
    layer segmented control · Portable JSON/table view · field-diff table (SyncPreviewEntityDiff
    visual language) · cross-instance columns (Table/Badge, parity-map idiom)
```

### Data Models

**No new app-DB tables or migrations.** Sources:

- `pcd_ops` / `pcd_op_history` (existing) — op provenance and conflict annotations.
- Compiled PCD cache tables (existing, in-memory) — resolved state.
- `Portable*` shapes (`$shared/pcd/portable.ts`, published OpenAPI schemas) — canonical
  arr-agnostic entity payloads for the resolved and base layers.
- `EntityChange` / `FieldChange` (`$sync/preview/types.ts`, `schemas/sync.yaml`) — diff rows for
  user-overrides, cross-instance, and live-diff responses.

New OpenAPI wrapper schemas (in `docs/api/v1/schemas/resolved-config.yaml`):

- `ResolvedLayer`: enum `base | user | resolved`
- `ResolvedEntityState`: `{ databaseId, entityType, name, layer, present, entity?, overrides? }`
  — `entity` is the Portable payload for `base|resolved`; `overrides` is `FieldChange[]` for
  `layer=user`
- `ResolvedEntityListResponse`: `{ databaseId, entityType, layer, entities[] }`
- `ResolvedInstanceState`: `{ instanceId, instanceName, arrType, compatible, present, desired?,
actual?, error? }` (`error` is a sanitized reason enum, never raw message)
- `CrossInstanceComparisonResponse`: `{ databaseId, entityType, name, instances[], diffs[] }`
- `ResolvedLiveDiffResponse`: `{ databaseId, entityType, name, instanceId, arrType, changes[] }`

### API Design

All endpoints are auth-covered by global middleware (`hooks.server.ts`); handlers additionally
fail closed like the parity endpoint (`locals.user || locals.authBypass`). `databaseId` validated
`/^\d+$/`; `instanceId`s parsed as integers and existence-checked; `arrType` validated with the
canonical `isArrAppType()` allowlist.

#### `GET /api/v1/pcd/{databaseId}/resolved/{entityType}` and `.../{entityType}/{name}`

**Purpose**: resolved entity state with layer selection.
**Query**: `layer=base|user|resolved` (default `resolved`); `arrType` required only for
arr-specific readers.

**Response (200)**: `ResolvedEntityListResponse` / `ResolvedEntityState` (Portable payload or
`FieldChange[]` overrides).

**Errors:**

| Status | Condition                                                                         |
| ------ | --------------------------------------------------------------------------------- |
| 400    | invalid databaseId, unknown entityType, missing required arrType, cache not built |
| 401    | unauthenticated                                                                   |
| 404    | named entity absent from the resolved layer                                       |
| 500    | replay/read failure (logged; generic message)                                     |

#### `GET /api/v1/pcd/{databaseId}/resolved/{entityType}/{name}/compare`

**Purpose**: cross-instance comparison of per-instance transformed-desired payloads.
**Query**: `instanceIds` (comma-separated, required, cap 8); `includeLive=true|false` (default
false; live fetches are rate-limited per instance).
**Response (200)**: `CrossInstanceComparisonResponse`. Per-instance failures are inline statuses,
not request failures.
**Errors**: 400 (bad ids / cap exceeded / unbuilt cache), 401, 404 (entity missing), 429 (rate
limited), 500.

#### `GET /api/v1/pcd/{databaseId}/resolved/{entityType}/{name}/diff?instanceId={id}`

**Purpose**: desired-vs-actual diff for one entity on one instance, via the section syncer's
`generatePreview()` filtered to the entity (namespace-suffix aware).
**Rate limit**: `registerPreviewCreateAttempt(instanceId)` (existing 6/60s per instance).
**Response (200)**: `ResolvedLiveDiffResponse`.
**Errors**: 400 (unbuilt cache / section unsupported for arrType), 401, 404 (instance/entity),
429, 500.

Contract-first workflow: author `docs/api/v1/paths/resolved-config.yaml` +
`docs/api/v1/schemas/resolved-config.yaml`, register in `docs/api/v1/openapi.yaml`, run
`deno task generate:api-types`, then `deno task bundle:api` for the `packages/praxrr-api` mirror.

### System Integration

#### Files to Create

- `packages/praxrr-app/src/lib/server/pcd/resolved/{readers,layers,layerDiff,liveDiff,compare,limits,types,index}.ts`
- `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/resolved/[entityType]/+server.ts`
- `packages/praxrr-app/src/routes/api/v1/pcd/[databaseId]/resolved/[entityType]/[name]/+server.ts`
- `.../[name]/compare/+server.ts`, `.../[name]/diff/+server.ts`
- `docs/api/v1/paths/resolved-config.yaml`, `docs/api/v1/schemas/resolved-config.yaml`
- `packages/praxrr-app/src/routes/resolved-config/[databaseId]/+page.server.ts`, `+page.svelte`,
  `ResolvedStatePanel.svelte`, `LayerToggle` usage, `CrossInstanceGrid.svelte`
- Tests: `packages/praxrr-app/src/tests/pcd/resolved/*.test.ts`,
  `packages/praxrr-app/src/tests/routes/resolvedConfigApi.test.ts`

#### Files to Modify

- `packages/praxrr-app/src/lib/server/pcd/database/cache.ts` — extract op-execution loop; add
  `buildReadOnly({ layers })` (skips value guards + history writes + state mutation).
- `packages/praxrr-app/src/lib/server/pcd/index.ts` — export the resolved service.
- `packages/praxrr-app/src/lib/server/utils/arr/arrInstanceClients.ts` (or the factory choke
  point) — call `assertSafeArrUrl()` centrally (security W1).
- `docs/api/v1/openapi.yaml` — register new paths/schemas.
- `packages/praxrr-app/src/lib/api/v1.d.ts`, `packages/praxrr-api/{openapi.json,types.ts}` —
  regenerated, not hand-edited.
- Navigation registry — add the viewer page (follow parity-map registration).
- `scripts/test.ts` — add a `resolved` test alias.

#### Reuse (no change)

`$sync/preview/diff.ts`, `$sync/preview/sectionDiffs.ts` (array-key strategies),
`$sync/preview/orchestrator.ts` + section syncers' `generatePreview()`, `$sync/preview/limits.ts`,
`$sync/mappings.ts` (`isSyncSectionSupported`), `pcd/entities/serialize.ts`,
`pcd/entities/qualityProfiles/compatibility.ts`, `$db/queries/arrInstances.ts` (never raw
selects), `SyncPreviewEntityDiff.svelte` visual language, `$ui/table/Table.svelte`,
`$ui/badge/Badge.svelte`, `$ui/meta/JsonView.svelte`, `EmptyState.svelte`, parity-map page
patterns, `$utils/rateLimit.ts`, `$arr/testConnectionReason.ts` (sanitized reasons).

## UX Considerations

### User Workflows

#### Primary Workflow: Inspect resolved state and layers

1. **Open viewer** — User navigates to `/resolved-config/[databaseId]`, picks entity type + entity
   (search + type filter). System renders resolved state instantly from cache.
2. **Toggle layers** — Segmented control (not tabs): Base / User overrides / Resolved. Base builds
   the ephemeral cache server-side; user-overrides shows a `FieldChange[]` table.
3. **Success state** — Resolved payload table/JSON with provenance chips; empty user-overrides
   layer states "No user overrides — resolved matches base."

#### Secondary Workflow: Diff against live / compare instances

1. User selects an instance (or several, cap 8) for the chosen entity.
2. Desired side renders immediately; live columns load independently with skeletons.
3. Field diff table uses the existing Create/Update/Delete/Unchanged vocabulary.

#### Error Recovery Workflow

1. **Error Occurs**: an instance is unreachable or rate-limited.
2. **User Sees**: per-instance inline status (`unreachable` / `timeout` / `rate-limited`) in that
   column; other columns unaffected; full detail only in server logs.
3. **Recovery**: per-instance refresh affordance; explicit retry state (never a silent spinner).

### UI Patterns

| Component      | Pattern                                                        | Notes                                                                       |
| -------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Layer switch   | Segmented control (`ViewToggle`/`Toggle`)                      | Same content, different lens — not navigation                               |
| Field diff     | Triple-redundant indicators: color + glyph (`+ ~ - =`) + label | Extend `SyncPreviewEntityDiff` visual language                              |
| Cross-instance | Table with per-instance columns (`Table`/`Badge`)              | Parity-map idiom; column header shows instance name + status + last-fetched |
| Raw view       | `JsonView.svelte`                                              | Existing highlight.js component                                             |
| Long payloads  | Collapse unchanged fields with count                           | Terraform concise-diff pattern                                              |

### Accessibility Requirements

- WCAG 1.4.1: never color-only change indication — keep glyph + text label on every diff surface.
- All values rendered as escaped text (`{value}`) — **no `{@html}` / `marked.parse()`** in any new
  component (security C1).

### Performance UX

- **Loading States**: skeletons for live columns; resolved side renders instantly from cache.
- **Progressive results**: per-instance columns resolve independently.
- **Error Feedback**: explicit per-instance retry/rate-limit messaging; visible last-fetched
  timestamps; no silent caching of "live" data.

## Recommendations

### Implementation Approach

**Recommended Strategy**: surface existing machinery, add one new primitive. Contract first, then
server service, then routes, then UI; every phase independently testable.

**Phasing:**

1. **Phase 0 — Contract & scaffolding**: OpenAPI paths/schemas, regenerate types, route skeletons
   with auth/validation (copy parity endpoint shape).
2. **Phase 1 — Resolved read service + endpoints**: `$pcd/resolved/readers.ts` over
   `entities/serialize.ts`; list + named endpoints (`layer=resolved`).
3. **Phase 2 — Layer breakdown**: `PCDCache.buildReadOnly({ layers })` (the hard part),
   `layers.ts`, `layerDiff.ts`, `layer=base|user` support. Includes W1 SSRF centralization.
4. **Phase 3 — Live diff**: `liveDiff.ts` over `generatePreview()`, `/diff` endpoint.
5. **Phase 4 — Cross-instance comparison**: `compare.ts` + `limits.ts`, `/compare` endpoint.
6. **Phase 5 — UI**: viewer page, layer toggle, diff tables, cross-instance grid, nav entry.

### Technology Decisions

| Decision                 | Recommendation                                                                  | Rationale                                                                |
| ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Base-only computation    | Read-only layer-subset replay + diff                                            | Matches replay semantics; op-metadata reconstruction is drift-prone      |
| Base-only cache lifetime | Build per request, close immediately                                            | ms-scale build; memoize later only if timings warrant (KISS)             |
| Layer payload shape      | Arr-agnostic `Portable*`                                                        | Published schemas; Portable Contract Fidelity                            |
| Live diff                | Reuse sync preview `generatePreview()`                                          | Per-arr transforms, namespace handling, rate limiting already correct    |
| Cross-instance semantics | Compare per-instance transformed-desired; `includeLive` optional                | The desired payload is what differs per instance; live drift is additive |
| Diff engine              | Existing `diffToFieldChanges`                                                   | No new dependency; `jsondiffpatch` rejected (CVEs)                       |
| Diff rendering           | Plain escaped text everywhere                                                   | Avoids C1 XSS trap; markdown rendering is not needed for a diff view     |
| Endpoint namespace       | `/api/v1/pcd/{databaseId}/resolved/**`                                          | Resolved state is a PCD-database property                                |
| Placement                | Standalone page now; embeddable panel component designed for editor reuse later | Controls scope; issue allows "page or panel"                             |

### Quick Wins

- Resolved read endpoints: thin wrappers over existing serializers — immediate transparency value.
- Live diff endpoint: existing preview pipeline filtered to one entity — bullet 4 with near-zero
  new diff code.

### Future Enhancements

- Editor-embedded resolved panel (custom formats / quality profiles detail pages).
- Provenance overlay (which op set this field) from `pcd_ops` metadata.
- Persisted resolved snapshots for temporal diffs (feeds #15 drift detection).
- Global "entities with user overrides" filter (VS Code `@modified` analog).
- Dependency edges emitted during serialization (feeds #26).

## Risk Assessment

### Technical Risks

| Risk                                                                | Likelihood | Impact | Mitigation                                                                                                        |
| ------------------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| Base-only build reuses mutating path and corrupts `pcd_ops`/history | Medium     | High   | `buildReadOnly` skips value guards/history/state mutation; test asserts zero writes; never registered in registry |
| Layer view disagrees with sync desired state                        | Medium     | High   | Same serializers/transformers for both; equivalence test                                                          |
| Cross-Arr semantic drift (wrong payload for arr_type)               | Medium     | High   | Canonical `isArrAppType` validation; `isSyncSectionSupported` gating; per-arr transformers only; per-arr tests    |
| Namespace suffix mismatch in live diff                              | Medium     | Medium | Reuse `findNamespaceMatch`; read-only suffix lookup (no `getOrCreate` mutation)                                   |
| Fan-out load on home-server Arr instances                           | Medium     | Medium | Instance cap (8), per-instance preview rate limit, per-user request window                                        |
| BigInt serialization failure (cache opened `int64: true`)           | Low        | Medium | JSON replacer coercing BigInt before `json()`                                                                     |
| Scope creep across 4 sub-features                                   | High       | Medium | Phased plan; UI kept to one page + shared components                                                              |

### Integration Challenges

- Contract-first friction: OpenAPI + two generation steps (`generate:api-types`, `bundle:api`)
  must precede handler code in every phase.
- `sync/preview` dependency direction: `pcd/resolved` imports from `$sync/preview` (pure utility
  modules) — accepted as one-directional; do not invert.

### Security Considerations

#### Critical — Hard Stops

| Finding                                                                                                                                                                                    | Risk                                                  | Required Mitigation                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| C1: existing diff components render markdown via unsanitized `marked.parse()` + `{@html}`; copying that pattern into new diff/tree views = stored XSS from PCD repos or live Arr responses | Session takeover via crafted description/notes fields | New components render all values as plain escaped text; no `{@html}`; no `marked.*` calls |

#### Warnings — Must Address

| Finding                                                                   | Risk                                      | Mitigation                                                                                                    | Alternatives                          |
| ------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| W1: SSRF guard `assertSafeArrUrl` not wired into `getArrInstanceClient()` | Fan-out amplifies stored-URL SSRF probing | Centralize the guard in `getArrInstanceClient()`                                                              | Feature-local guard + follow-up issue |
| W2: raw `error.message` in JSON error bodies leaks LAN topology           | Internal host/port disclosure             | Sanitized reason enum (extend `testConnectionReason.ts` pattern); full detail to server logs                  | Per-instance status enums             |
| W3: no multi-instance fan-out bound exists                                | Self-inflicted DoS on Arr instances       | `resolved/limits.ts`: instance cap (8) + `$utils/rateLimit.ts` window + existing per-instance preview limiter | Configurable cap later                |
| W4: inconsistent arr_type validation across call sites                    | Wrong-app semantics disclosure            | Canonical `isArrAppType()` at top of every handler; entity↔arr_type ownership validated                       | —                                     |
| W5: ad-hoc instance queries could leak `api_key`                          | Credential exposure                       | Only `arrInstancesQueries` accessors; extend `arrCredentialRedactionRoutes` test to new routes                | —                                     |

#### Advisories — Best Practices

- A2 (no CORS): add regression test asserting no CORS headers on new routes (deferral not needed —
  test is trivial).
- A4 (cache keying): if live-diff caching is ever added, key by `(instanceId, entityType, entity,
layer)` (defer: no caching in v1).
- A5 (pre-existing markdown gap in `FieldDiffTable.svelte`): out of scope; file a follow-up issue.

## Task Breakdown Preview

### Phase 0: Contract & scaffolding

**Focus**: OpenAPI paths/schemas, type generation, route skeletons with auth/validation.
**Tasks**:

- Author `paths/resolved-config.yaml` + `schemas/resolved-config.yaml`; register; regenerate.
- Route skeletons returning 501 with full validation (databaseId, entityType, arrType, auth).
  **Parallelization**: schemas and route skeletons after one contract commit.

### Phase 1: Resolved reads

**Focus**: `$pcd/resolved/readers.ts` + list/named endpoints, `layer=resolved`.
**Dependencies**: Phase 0.
**Tasks**:

- Reader dispatch over `entities/serialize.ts` (fail-fast unknown types).
- Endpoints + route tests + redaction/auth tests.

### Phase 2: Layer breakdown

**Focus**: the new primitive.
**Dependencies**: Phase 1.
**Tasks**:

- Extract op-execution loop in `cache.ts`; add `buildReadOnly({ layers })` with zero-write tests.
- `layers.ts` (ephemeral build/close), `layerDiff.ts` (`diffToFieldChanges` wrapper).
- `layer=base|user` endpoint support; W1 SSRF centralization.

### Phase 3: Live diff (parallel with Phase 2 after Phase 1)

**Focus**: reuse sync preview for desired-vs-actual.
**Tasks**:

- `liveDiff.ts` (preview orchestrator, entity filter, namespace-aware), `/diff` endpoint,
  sanitized error reasons, per-arr tests.

### Phase 4: Cross-instance comparison

**Focus**: per-instance desired (+optional live) comparison.
**Dependencies**: Phases 1, 3.
**Tasks**:

- `compare.ts` + `limits.ts` (cap + window), `/compare` endpoint, per-arr_type gating tests.

### Phase 5: UI

**Focus**: viewer page + components.
**Dependencies**: Phases 1–4 endpoints (can start against Phase 1 output).
**Tasks**:

- Page + entity picker + layer segmented control + resolved/JSON view.
- Field-diff table (escaped text only), cross-instance grid, per-instance status/loading states.
- Navigation registry entry; e2e-facing smoke if applicable.

## Decisions Needed

All key decisions have recommended answers adopted for planning (documented above). Remaining
confirmations that would refine (not block) implementation:

1. **Editor-embedded panel in v1?**
   - Options: standalone page only (adopted) / page + editor panels
   - Impact: scope of Phase 5; component API already designed for reuse
   - Recommendation: standalone page; panels as fast-follow

2. **Full-section preview fetch acceptable for single-entity live diff?**
   - Options: filter full-section preview result (adopted) / add single-entity syncer variant
   - Impact: live-diff latency on very large sections
   - Recommendation: filter full-section result; optimize later if profiling warrants

3. **`orphaned` op state rendering**
   - Options: ignore (adopted for v1 — no code path sets it) / explicit badge
   - Impact: edge-case display only

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): Arr API details, diff libraries, IaC patterns
- [research-business.md](./research-business.md): user stories, value-guard semantics, edge cases
- [research-technical.md](./research-technical.md): architecture, API contracts, file inventory
- [research-ux.md](./research-ux.md): workflows, accessibility, error/loading states
- [research-security.md](./research-security.md): severity-leveled findings (1 critical, 5 warnings)
- [research-practices.md](./research-practices.md): reuse map, module boundaries, testability
- [research-recommendations.md](./research-recommendations.md): phasing, risks, alternatives

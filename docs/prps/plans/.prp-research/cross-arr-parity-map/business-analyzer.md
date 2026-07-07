# Cross-Arr Parity Map — Business Analysis (issue #14)

## User Story

As a Praxrr user curating cross-Arr configuration (PCDs), I want a read-only parity map that shows which config entities each Arr app (Radarr/Sonarr/Lidarr) supports, flags same-API-shape/different-semantics cases, and shows which apps can use a given quality profile, so that I see incompatibilities before syncing instead of discovering them only when a sync silently skips or misbehaves.

## Problem → Solution

Cross-Arr support facts and semantic divergences live only in ~7 server-only files (`capabilities.ts` per-app booleans + scattered `mappings.ts`/`transformer.ts`/`syncer.ts` logic) with zero user-visible surface, so "looks-portable" configs fail on apply → A standalone `/parity-map` page plus contract-first `GET /api/v1/compatibility/parity` renders the entity×app tri-state matrix (derived from `capabilities.ts`), a per-`arr_type` semantic-warnings catalog, and live per-profile compatibility computed from the linked PCD by the one extracted `list.ts` algorithm.

## Evidence (verified today)

- `capabilities.ts` models per-app `sync`/`workflows` booleans only — no entity axis, no user surface (`packages/praxrr-app/src/lib/shared/arr/capabilities.ts:88-137,297-305`).
- No parity surface exists: `routes/parity-map`, `routes/api/v1/compatibility`, `shared/arr/parity.ts`, `shared/arr/semanticDifferences.ts`, `qualityProfiles/compatibility.ts` all absent (verified via `ls`).
- Compatibility algorithm exists once, inline, in list filtering: QUALITIES∩enabled-quality intersection + arr-specific-score fallback (`packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/list.ts:59-163`).
- metadata_profiles support = false/false/true across radarr/sonarr/lidarr (`capabilities.ts:101,118,135`); grounds `unsupported/unsupported/native` matrix row.

## Acceptance Criteria rows

| # | Criterion | Testable? |
| - | --------- | --------- |
| 1 | `/parity-map` route renders a 5-entity × 3-app matrix (custom_formats, quality_profiles, quality_definitions, delay_profiles, metadata_profiles × radarr/sonarr/lidarr) | Yes (e2e/render) |
| 2 | Every matrix cell is derived via `getEntitySupportStatus`→`supportsArrSyncSurface` (no 4th boolean map); catalog authors only `native`/`shared` refinement | Yes (unit) |
| 3 | Truth table holds: metadata_profiles→`unsupported/unsupported/native`; quality_definitions→`native/native/native`; custom_formats/quality_profiles/delay_profiles→`shared/shared/shared` | Yes (unit truth-table) |
| 4 | `PARITY_ENTITY_TO_SYNC_SURFACE` is a total `Record<ParityEntity,ArrSyncSurface>` (compile-time fail-fast on unmapped entity) | Yes (typecheck+unit) |
| 5 | Semantic catalog has ≥8 entries; each has non-empty `summary`/`detail`/`sourceRefs`, `apps ⊆ ARR_APP_TYPES`, valid `scope` (ParityEntity ∪ ArrWorkflowSurface) | Yes (unit invariants) |
| 6 | Page renders each warning's `detail` ("explain why") and, when present, `suggestion` ("suggest alternatives") as inform-only cards grouped by scope | Yes (render) |
| 7 | `GET /api/v1/compatibility/parity` with no `databaseId` → 200 with `matrix`+`semanticDifferences`, and NO `profiles` key | Yes (route unit) |
| 8 | Same endpoint with valid `?databaseId=` → 200 including `profiles[]` with per-profile `compatibleArrTypes` + `basis:'enabled-qualities'` | Yes (route unit) |
| 9 | Endpoint returns 400 `{error}` on invalid/unknown/`'all'` `databaseId` (fail-fast, no sibling fallback); 401 when unauthenticated | Yes (route unit) |
| 10 | Per-profile compatibility computed by single extracted `computeCompatibleProfileNames`; `list.ts` delegates to it with identical filtered-set output pre/post | Yes (delegation-equivalence) |
| 11 | Compatibility uses enabled quality names ∩ `QUALITIES[arrType]` + arr-specific-score fallback, never trusts `arr_type='all'` scores: video profile→`[radarr,sonarr]`, audio→`[lidarr]` | Yes (PCD-fixture unit) |
| 12 | Nav entry for `/parity-map` appears and `LayoutGrid` is registered in `NAV_ICON_MAP` so the icon resolves (not `undefined`) | Yes (render/unit) |
| 13 | Contract-first: `ParityMapResponse` authored in OpenAPI, types regenerated, handler typed as `components['schemas']['ParityMapResponse']` | Yes (typecheck) |
| 14 | Feature is inform-only: parity page/endpoint expose no mutation and gate no config (issue "don't block incompatible configs") | Partial (assert no write path) |
| 15 | Deferred scope NOT shipped this PR: no inline quality-profile-editor "Usable by" indicator wiring, no apply-time `alertStore` migration hints in sync/apply flow | Yes (absence check) |

## MVP vs Deferred (from design §8)

- **MVP (in scope):** parity matrix; semantic warnings; profile compatibility on standalone `/parity-map`; contract-first endpoint; `list.ts` delegation refactor; nav+icon; tests green.
- **Deferred (out of scope):** inline editor "Usable by" indicator (component ships, wiring deferred); apply-time interactive migration hints (data ships, sync-path wiring deferred); populating `UNSUPPORTED_*_REASONS`; server-side semantic-fact consolidation; per-quality-name matrix augmentation; Readarr/Whisparr (#34); pre-login availability.

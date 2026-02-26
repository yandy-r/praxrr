# TRaSH Guide Sync UX Follow-up Plan (2026-02-26)

## Why this plan exists

This plan tracks the remaining UX corrections requested after the initial `trash-guide-sync-ux`
rollout. It is designed for handoff across multiple AI sessions with concrete file targets,
acceptance criteria, and validation commands.

## Requested fixes (confirmed)

1. `/arr/{id}/sync` currently shows a separate `TRaSH Guide Sources` section with too much data. It
   should only support TRaSH quality profiles, integrated into the primary quality profile section
   (not a separate subsection), with source filtering + search. The section should also have a built
   in pagination (inside the section not the entire page) where only (5 per row are shown) by
   default.
2. Source filtering UX on dedicated listing pages (`custom-formats`, `quality-profiles`) is not
   scalable. Horizontal source buttons should move to a space-efficient dropdown model while keeping
   clear selected-state visibility.
3. `/media-management/{id}/naming` source naming is not user-friendly (`radarr-naming`,
   `sonarr-naming`). Display labels should be friendly (ex: `Radarr - TRaSH`, `Sonarr - TRaSH`).
4. `/media-management/{id}/quality-definitions` TRaSH rows exist but are de-selected by default.
   They should be selected by default.
5. Quality definition display names are too generic (`movie`, `series`). Apply the same user-facing
   naming logic used for naming settings so labels are understandable.

## Current implementation snapshot

- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte` renders standalone
  `TrashGuideSources`.
- `packages/praxrr-app/src/routes/arr/[id]/sync/components/TrashGuideSources.svelte` includes all
  TRaSH sections (`qualityProfiles`, `customFormats`, `qualityDefinitions`, `naming`,
  `mediaManagement`).
- `packages/praxrr-app/src/lib/client/ui/actions/SourceFilterAction.svelte` still renders horizontal
  pills when source count is below `pillsThreshold`.
- Media-management source contexts currently use raw TRaSH source names from
  `trashGuideManager.listSources()`.
- Media-management `naming` + `quality-definitions` pages default source selection to current PCD
  source key, which hides TRaSH rows until manually selected.
- `getMediaManagementDisplayName` currently returns raw names unchanged.

## Delivery approach

### Workstream A: Sync page consolidation (TRaSH quality profiles only)

- [ ] A1. Remove standalone `TrashGuideSources` section from `/arr/{id}/sync`.
  - Files:
    - `packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte`
    - `packages/praxrr-app/src/routes/arr/[id]/sync/components/TrashGuideSources.svelte` (remove or
      deprecate)
- [ ] A2. Refactor sync data contract so only TRaSH quality-profile selections are surfaced for this
      UX.
  - Files:
    - `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts`
    - `packages/praxrr-app/src/lib/server/db/queries/trashGuideSync.ts`
- [ ] A3. Extend `QualityProfiles.svelte` with integrated TRaSH source filtering + search in its
      primary section.
  - Files:
    - `packages/praxrr-app/src/routes/arr/[id]/sync/components/QualityProfiles.svelte`
    - `packages/praxrr-app/src/routes/arr/[id]/sync/+page.svelte`
- [ ] A4. Keep sync actions consistent: save/sync still call existing section actions; no new sync
      section added.

Acceptance for Workstream A:

- `/arr/{id}/sync` has no separate TRaSH block.
- TRaSH quality profile selection appears in the main quality profile section.
- TRaSH non-quality-profile section choices are not exposed in UI.
- Search and source filtering are available in this merged section.
- Proper UX without overwhelming data and properly paginaged.

### Workstream B: Source filter UX scalability (dropdown-first)

- [ ] B1. Update `SourceFilterAction` to support an explicit dropdown-only mode (no horizontal
      pills).
  - Files:
    - `packages/praxrr-app/src/lib/client/ui/actions/SourceFilterAction.svelte`
- [ ] B2. Apply dropdown mode to dedicated pages:
  - `packages/praxrr-app/src/routes/custom-formats/[databaseId]/+page.svelte`
  - `packages/praxrr-app/src/routes/quality-profiles/[databaseId]/+page.svelte`
- [ ] B3. Ensure selected-state remains visible (count and/or label summary in trigger).

Acceptance for Workstream B:

- Source filtering on both dedicated pages uses dropdown UI regardless of source count.
- Selected state remains visible without opening dropdown.
- Existing localStorage persistence and filter behavior remain intact.

### Workstream C: Friendly TRaSH naming labels in media-management

- [ ] C1. Add shared helper(s) for friendly TRaSH source labels and TRaSH media-management entity
      labels.
  - Proposed location:
    - `packages/praxrr-app/src/lib/shared/arr/displayName.ts` (or sibling helper)
- [ ] C2. Apply friendly source labels to naming and quality-definition source contexts.
  - Files:
    - `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/+page.server.ts`
    - `packages/praxrr-app/src/routes/media-management/[databaseId]/quality-definitions/+page.server.ts`
- [ ] C3. Apply friendly display names for TRaSH rows currently shown as `movie` / `series`.
  - Files:
    - `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/views/TableView.svelte`
    - `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/views/CardView.svelte`
    - `packages/praxrr-app/src/routes/media-management/[databaseId]/quality-definitions/views/TableView.svelte`
    - `packages/praxrr-app/src/routes/media-management/[databaseId]/quality-definitions/views/CardView.svelte`

Acceptance for Workstream C:

- Source badges/filters on naming page show friendly TRaSH labels (`Radarr - TRaSH`,
  `Sonarr - TRaSH` pattern).
- TRaSH config names are no longer raw `movie` / `series` labels where a friendlier label can be
  derived.
- Naming and quality-definition pages use consistent label logic (single shared helper path).

### Workstream D: Default source selection includes TRaSH quality definitions

- [ ] D1. Change source default selection behavior to include all available sources when multiple
      exist.
  - Minimum scope:
    - `packages/praxrr-app/src/routes/media-management/[databaseId]/quality-definitions/+page.svelte`
- [ ] D2. Align naming page default source selection behavior for consistency.
  - File:
    - `packages/praxrr-app/src/routes/media-management/[databaseId]/naming/+page.svelte`
- [ ] D3. Keep persisted user preference precedence: saved selection still overrides default.

Acceptance for Workstream D:

- First load (no stored filter) shows both PCD and TRaSH rows in quality-definitions.
- Existing stored source selection is respected.
- Empty-state messaging remains correct for filtered and searched states.

## Verification checklist

- [ ] `deno task check`
- [ ] `deno task test packages/praxrr-app/src/tests/base/trashGuideSyncUxFlows.test.ts`
- [ ] `deno task test packages/praxrr-app/src/tests/base/trashGuideSyncSourceScope.test.ts`
- [ ] `deno task test packages/praxrr-app/src/tests/arr/lidarrMediaManagement.test.ts`
- [ ] Manual UI pass:
  - [ ] `/arr/{id}/sync`: no standalone TRaSH section; quality profiles only.
  - [ ] `/custom-formats/{databaseId}`: source filter is dropdown and scalable.
  - [ ] `/quality-profiles/{databaseId}`: source filter is dropdown and scalable.
  - [ ] `/media-management/{databaseId}/naming`: friendly TRaSH labels.
  - [ ] `/media-management/{databaseId}/quality-definitions`: TRaSH selected by default and friendly
        names shown.

## Handoff notes for future sessions

- Start with Workstream A first because it changes sync data contracts and section composition.
- Workstreams B/C/D can run in parallel once A contract impact is understood.
- If naming-label logic is ambiguous, keep one canonical helper and reuse it across naming and
  quality-definitions pages.
- Do not reintroduce Arr-type cross-fallback behavior; keep explicit `arr_type` handling.

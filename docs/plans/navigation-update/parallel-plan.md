# navigation-update Implementation Plan

This plan replaces duplicated hard-coded navigation definitions with a single typed navigation contract that is resolved once in `+layout.server.ts` and consumed by both desktop and mobile navigation surfaces. The implementation centers on introducing shared navigation types plus a server registry/resolver path, then migrating `PageNav` and `BottomNav` to render from one `NavShell` payload without route or deep-link changes. After the shared shell is stable, the plan adds visual grouping and Arr scope-aware filtering using existing capability metadata, while preserving current mobile drawer behavior and icon preference stores. The final phase hardens behavior with focused tests and docs updates so the refactor is safe to ship and maintain.

## Critically Relevant Files and Documentation

- `packages/praxrr-app/src/routes/+layout.server.ts`: Canonical server load integration point for returning `navShell`.
- `packages/praxrr-app/src/routes/+layout.svelte`: Root composition point passing layout data into navbar/sidebar/bottom nav.
- `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/pageNav.svelte`: Primary sidebar currently holding hard-coded groups.
- `packages/praxrr-app/src/lib/client/ui/navigation/bottomNav/BottomNav.svelte`: Mobile navigation with independent item definitions and priority logic.
- `packages/praxrr-app/src/lib/shared/arr/capabilities.ts`: Source-of-truth capability helpers for Arr-aware visibility.
- `packages/praxrr-app/src/lib/shared/pcd/types.ts`: `ArrType`/`ArrAppType` types used by nav scope and metadata contracts.
- `docs/plans/navigation-update/feature-spec.md`: Requirements, constraints, and success criteria.
- `docs/plans/navigation-update/research-technical.md`: File-level architecture guidance and migration touchpoints.
- `docs/plans/navigation-update/research-recommendations.md`: Practical rollout strategy and sequencing guidance.
- `docs/plans/navigation-update/research-ux.md`: UX constraints for grouping, scope switching, and mobile parity.

## Implementation Plan

### Phase 1: Shared Navigation Foundation

#### Task 1.1: Define shared navigation contracts Depends on [none]

**READ THESE BEFORE TASK**

- `docs/plans/navigation-update/feature-spec.md`
- `docs/plans/navigation-update/research-technical.md`
- `packages/praxrr-app/src/lib/shared/pcd/types.ts`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/shared/navigation/types.ts`
- `packages/praxrr-app/src/lib/shared/navigation/constants.ts`

Files to Modify

- `packages/praxrr-app/src/app.d.ts`

Define `NavItemDef`, `ResolvedNavItem`, `ResolvedNavGroup`, and `NavShell` as the single transport contract between server and client. Add constants for group IDs and mobile priority values so later tasks do not duplicate literal strings. Extend `App.PageData` with typed `navShell` support so consuming components remain type-safe. Keep this task contract-only; do not introduce rendering or resolver logic here.

#### Task 1.2: Build server registry and resolver pipeline Depends on [1.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/+layout.server.ts`
- `packages/praxrr-app/src/lib/shared/arr/capabilities.ts`
- `docs/plans/navigation-update/research-technical.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/server/navigation/registry.ts`
- `packages/praxrr-app/src/lib/server/navigation/resolver.ts`

Files to Modify

- `packages/praxrr-app/src/routes/+layout.server.ts`

Create a static registry that captures current navigation destinations, grouping metadata, mobile priorities, and Arr scope metadata without changing any route paths. Implement `resolveNavShell` to transform registry items into a JSON-safe payload with deterministic ordering (group order, then item order) and stable `version + navShell` return shape. Wire `+layout.server.ts` so authenticated non-auth-route requests return `{ version, navShell }`, while auth pages keep existing hidden-nav behavior without requiring client-side fallback logic. Preserve existing version loading behavior and avoid introducing external dependencies.

#### Task 1.3: Add icon resolution utilities for shell-driven rendering Depends on [1.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/client/stores/navIcons.ts`
- `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/pageNav.svelte`
- `docs/plans/navigation-update/research-patterns.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/client/navigation/iconMap.ts`
- `packages/praxrr-app/src/lib/shared/navigation/normalize.ts`

Files to Modify

- `packages/praxrr-app/src/lib/client/stores/navIcons.ts`

Introduce a client-side icon map keyed by serializable icon IDs returned by `navShell` so server payloads never carry component references. Add shared normalization helpers for stable active-pattern and child-item shapes consumed by both nav surfaces. Update `navIcons.ts` only as needed to align with the new icon-key flow while preserving current emoji/lucide persistence semantics. Keep APIs minimal because later tasks rely on this as a stable utility layer.

### Phase 2: UI Consumption and Grouped Navigation

#### Task 2.1: Move sidebar rendering to `navShell` data Depends on [1.2, 1.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/routes/+layout.svelte`
- `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/pageNav.svelte`
- `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/groupHeader.svelte`

**Instructions**

Files to Create

- None

Files to Modify

- `packages/praxrr-app/src/routes/+layout.svelte`
- `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/pageNav.svelte`
- `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/groupHeader.svelte`

Pass `data.navShell` from root layout into `PageNav` and replace hard-coded sidebar item declarations with loops over resolved groups/items. Keep existing interaction behavior intact: Escape-close, route-change auto-close, and active state semantics. Ensure `GroupHeader` continues to compute active styles correctly when data now comes from the resolver instead of inline literals. Do not add scope selector behavior yet.

#### Task 2.2: Move bottom nav rendering to shared shell Depends on [1.2, 1.3]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/client/ui/navigation/bottomNav/BottomNav.svelte`
- `packages/praxrr-app/src/routes/+layout.svelte`
- `docs/plans/navigation-update/research-recommendations.md`

**Instructions**

Files to Create

- None

Files to Modify

- `packages/praxrr-app/src/lib/client/ui/navigation/bottomNav/BottomNav.svelte`
- `packages/praxrr-app/src/routes/+layout.svelte`

Refactor `BottomNav` to derive entries from the same `navShell` payload used by `PageNav`, flattening groups while honoring `mobilePriority` semantics. Define deterministic ordering and tie-break rules explicitly: `always` before `medium` before `low`, then by registry order within each bucket, with no hidden implicit sorting. Preserve existing breakpoints and active-route logic so mobile visibility behavior remains unchanged after the data-source switch. Keep layout wiring explicit and avoid fallback copies of nav definitions.

#### Task 2.3: Add section headers and grouped sidebar presentation Depends on [2.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/pageNav.svelte`
- `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/group.svelte`
- `docs/plans/navigation-update/research-ux.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/sectionHeader.svelte`

Files to Modify

- `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/pageNav.svelte`
- `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/group.svelte`

Add lightweight section-header rendering so grouped navigation is visually scannable without introducing route or interaction churn. Insert headers based on group metadata in `navShell`, and keep existing expand/collapse transitions and child-link rendering intact. Ensure header markup is accessible and does not interfere with keyboard navigation.

#### Task 2.4: Normalize nav component conventions and remove dead sidebar store Depends on [none]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/groupItem.svelte`
- `packages/praxrr-app/src/lib/client/stores/sidebar.ts`
- `docs/plans/navigation-update/research-recommendations.md`

**Instructions**

Files to Create

- None

Files to Modify

- `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/groupItem.svelte`
- `packages/praxrr-app/src/lib/client/stores/sidebar.ts`

Align `groupItem.svelte` with project conventions and preserve exact active-state behavior for string and regex `activePattern` matching. Remove or retire the unused sidebar-collapsed store by deleting dead exports/imports and confirming no runtime references remain. Acceptance criteria: active-link highlighting is unchanged for existing routes, no store import errors remain, and nav rendering behavior is identical before/after cleanup. Keep this task isolated from resolver work so it can run independently and reduce merge pressure.

### Phase 3: Scope Awareness and Hardening

#### Task 3.1: Add Arr scope store and selector component Depends on [2.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/shared/arr/capabilities.ts`
- `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/pageNav.svelte`
- `docs/plans/navigation-update/research-ux.md`

**Instructions**

Files to Create

- `packages/praxrr-app/src/lib/client/stores/navScope.ts`
- `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/navScopeSelector.svelte`

Files to Modify

- `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/pageNav.svelte`

Implement a persisted Arr scope store (`all`, `radarr`, `sonarr`, `lidarr`) and a sidebar selector component that reads options from `navShell`. Add stale-value handling: if local storage contains an invalid or unavailable scope, fallback to `all` and rewrite persisted state. Integrate the selector into `PageNav` without breaking existing layout spacing or mobile drawer behavior. Keep the first cut focused on state and UI plumbing; filtering logic lands in the next task.

#### Task 3.2: Apply capability-aware filtering across nav groups Depends on [1.2, 2.1, 3.1]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/lib/server/navigation/registry.ts`
- `packages/praxrr-app/src/lib/server/navigation/resolver.ts`
- `packages/praxrr-app/src/lib/shared/arr/capabilities.ts`

**Instructions**

Files to Create

- None

Files to Modify

- `packages/praxrr-app/src/lib/server/navigation/registry.ts`
- `packages/praxrr-app/src/lib/server/navigation/resolver.ts`
- `packages/praxrr-app/src/lib/client/ui/navigation/pageNav/pageNav.svelte`

Use Arr capability helpers to gate nav entries by scope while preserving route integrity and clear UX behavior when items are unavailable. Define an explicit behavior matrix in implementation notes: hidden for unsupported top-level surfaces with no safe fallback, disabled+annotated for in-group items where contextual discovery matters, unchanged for `arrScope=all`. Keep server-side filtering authoritative for shell shape, then apply client-side scope selection against resolved metadata from Task 2.1. Ensure unsupported surfaces never fail silently when UX requires explanatory affordances.

#### Task 3.3: Add targeted navigation regression tests Depends on [2.2, 3.2]

**READ THESE BEFORE TASK**

- `packages/praxrr-app/src/tests/base/arrExternalUrlLayoutPropagation.test.ts`
- `packages/praxrr-app/src/routes/+layout.server.ts`
- `packages/praxrr-app/src/lib/client/ui/navigation/bottomNav/BottomNav.svelte`

**Instructions**

Files to Create

- `packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts`
- `packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts`

Files to Modify

- `packages/praxrr-app/src/tests/base/arrExternalUrlLayoutPropagation.test.ts`

Add focused tests that assert layout load returns a stable `navShell`, deep-link hrefs remain unchanged, and scope filtering respects Arr capability constraints. Add explicit coverage for auth-route hidden-nav behavior and mobile-priority ordering through deterministic component/state checks so sidebar and bottom-nav parity regressions are caught early. Reuse existing base-test patching patterns to avoid introducing new test harness complexity.

#### Task 3.4: Update architecture and feature docs for the new nav contract Depends on [3.2]

**READ THESE BEFORE TASK**

- `docs/ARCHITECTURE.md`
- `docs/plans/navigation-update/feature-spec.md`
- `docs/plans/navigation-update/research-technical.md`

**Instructions**

Files to Create

- None

Files to Modify

- `docs/ARCHITECTURE.md`
- `docs/plans/navigation-update/feature-spec.md`

Document the final contract (`NavShell`, registry/resolver flow, and scope behavior) so future work does not reintroduce duplicated nav definitions. Keep docs aligned with actual runtime behavior and explicitly note preserved constraints (no route renames, mobile priority semantics, capability-based filtering). This closes the loop between implementation and planning artifacts.

## Advice

- Keep `+layout.server.ts` as the single assembly point for shell data; splitting nav composition across endpoints will reintroduce divergence quickly.
- Avoid mutating capability semantics in UI components; `packages/praxrr-app/src/lib/shared/arr/capabilities.ts` should remain the source of truth for scope compatibility.
- Complete Task 2.1 and 2.2 before deep visual tweaks so grouping work is applied once on top of the stable `navShell` data path.
- Treat `groupItem.svelte` normalization as a cleanup boundary task, not part of resolver logic, to reduce risk while large data-flow changes are landing.
- Validate deep-link stability continuously while refactoring; this feature’s highest regression risk is accidental route drift during registry extraction.

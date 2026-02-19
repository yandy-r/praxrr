### Executive Summary

The navigation-update effort replaces the dual hard-coded sidebar/bottom-bar arrays with a single typed registry resolved once on the server, supporting consistent section headers, mobile priority hints, and future Arr scope awareness while preserving every existing route path and deep link. The core approach is Option B from the recommendations: introduce shared `NavShell` types/registry/resolver, feed `+layout.server.ts`/`+layout.svelte`, and refactor `PageNav` and `BottomNav` to loop over that data so desktop and mobile share exactly the same source. Phase 1 focuses on that foundation, with scoped filtering and productivity features deferred until the registry is stable.

### Architecture Context

- **System Structure:** The root layout (`+layout.server.ts`/`+layout.svelte`) becomes the canonical integration point that calls `resolveNavShell`, returns `navShell` plus `version`, and renders `Navbar`, `PageNav`, and `BottomNav` only for non-auth routes. The nav registry lives under `packages/praxrr-app/src/lib/shared/navigation` and `packages/praxrr-app/src/lib/server/navigation`, while icon resolution and scope stores sit under `packages/praxrr-app/src/lib/client/navigation` and `packages/praxrr-app/src/lib/client/stores`.
- **Data Flow:** Requests populate `locals.user` in `hooks.server.ts`; `+layout.server.ts` resolves the static registry (`NavItemDef[]`), evaluates feature/permission gating, serializes icons to keys, and returns a `NavShell` consumed by both nav components. Client stores (`navIcons.ts`, `navScope.ts`, `mobileNav.ts`) filter the resolved shell without re-running server logic.
- **Integration Points:** The registry references `packages/praxrr-app/src/lib/shared/arr/capabilities.ts` for Arr capability metadata and `packages/praxrr-app/src/lib/shared/pcd/types.ts` for `ArrType`; consumers include `PageNav`/`BottomNav` (driving `Group`/`GroupItem`), `Navbar` (scope indicator if needed), and `iconMap.ts` (key -> Lucide component resolution).

### Critical Files Reference

- `docs/plans/navigation-update/feature-spec.md`: Defines success criteria, NavShell data models, UX requirements (groupings, scope selector, mobile drawer), and the phased roadmap guiding the implementation sequence.
- `docs/plans/navigation-update/research-technical.md`: Specifies the registry/resolver architecture, Svelte hydration constraints, responsive parity, icon serialization, and the exact files to create/modify/delete for the foundation phase.
- `docs/plans/navigation-update/research-recommendations.md`: Distills the realistic Option B strategy, quick wins (section headers, dead-code cleanup), and the Task Group breakdown for registry extraction, headers, scope awareness, and cleanup.
- `docs/plans/navigation-update/research-ux.md`: Captures user workflows, accessibility/performance expectations, mobile/command palette patterns, and context-switcher guidance that should inform nav-shell behavior and messaging.

### Patterns to Follow

- `Group` -> `GroupHeader`/`GroupItem` hierarchy in `pageNav.svelte` must continue feeding the same semantics (slide transitions, active-pattern matching, icon rendering) even after data is registry-driven.
- Follow the `navIcons.ts` store pattern (browser guard plus localStorage persistence) so both PageNav and BottomNav honor the emoji/Lucide toggle.
- Preserve responsive priority handling (`mobilePriority` -> Tailwind classes in `BottomNav.svelte`) and drawer behaviors (escape key, route-change close) tied to `mobileNav.ts`; the registry must provide the same metadata that the existing hard-coded arrays already expose.

### Cross-Cutting Concerns

- **Security:** Capability gating must still derive from `packages/praxrr-app/src/lib/shared/arr/capabilities.ts`; nav visibility remains purely UI-facing while backend auth stays enforced via `hooks.server.ts`.
- **Performance:** Keep `NavShell` static and SSR-safe to avoid hydration mismatches; caching the resolved shell in layout data while filtering client-side avoids duplicate work when scope changes.
- **Testing:** Validate mobile drawer escape/route-close interactions, bottom nav priority classes, and that all registered `href`s still hit existing routes (deep links must survive). Section headers and scope filtering should also have regression coverage.

### Parallelization Opportunities

- Independent work streams: registry/types/resolver creation (`shared/navigation/types.ts`, `server/navigation/registry.ts`/`resolver.ts`) can proceed alongside icon map and scope store scaffolding (`iconMap.ts`, `navScope.ts` once scoped filtering is delayed).
- Sidebar vs. mobile: refactoring `PageNav.svelte` to loop over `navShell.groups` and `BottomNav.svelte` to flatten that shell can happen in parallel once the resolver exists.
- Coordination hotspots: `+layout.server.ts`/`+layout.svelte` must land before consumers rely on `navShell`, and cleanup (e.g., deleting `packages/praxrr-app/src/lib/client/stores/sidebar.ts`, normalizing `groupItem.svelte`) should be synchronized to avoid temporary broken imports.

### Implementation Constraints

- No new external dependencies in Phase 1-feature flags may be env-driven, telemetry/API endpoints deferred until later phases.
- Deep links must stay valid; registry entries' `href`s cannot be renamed (per business rule).
- All nav data must serialize through `NavShell`; clients should not recompute permissions or flags to prevent hydration drift.
- Svelte convention is "Svelte 5, no runes," so prefer `export let` props when adding new components or normalizing existing ones.

### Planning Recommendations

1. **Phase 1 - Foundation:** Build the shared types/registry/resolver, update `+layout.server.ts`/`+layout.svelte` to return/pass `navShell`, refactor `PageNav`/`BottomNav` to consume that shell, add section headers, and clean up dead code (`sidebar.ts`, `groupItem.svelte` normalization). This delivers a single canonical source without altering behavior.
2. **Phase 2 - Scope Awareness (after Phase 1 stabilizes):** Add `navScope` store/selector component and Arr capability filtering using `capabilities.ts`, ensuring the selector writes to the store and the nav renders statefully from the resolved shell without re-requesting data.
3. **Coordinate touchpoints:** Ensure layout data is ready before nav consumers switch to `navShell`, and keep cleanup work (header component, store deletion) aligned so no temporary breakage occurs.
4. **Verification:** After each phase, test mobile drawer behavior, bottom nav consistency, and the section/ordering rendering; once scope filtering is added, verify disabled-item messaging and tooltip explanations.

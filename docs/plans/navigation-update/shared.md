# navigation-update

Navigation currently renders from the root SvelteKit shell in `src/routes/+layout.svelte`, where `Navbar`, `PageNav`, and `BottomNav` are composed and hidden only on auth routes. Server data enters this shell through `src/routes/+layout.server.ts`, which today returns only the app version from `app_info`, while both nav components maintain separate hard-coded item definitions. The navigation update should centralize those definitions behind one typed source that can feed desktop and mobile surfaces consistently, while preserving current interaction behavior (drawer state, icon style selection, and active-path matching). Arr app capability metadata in shared modules is the constraint layer for future scope-aware filtering and must remain the gating source when nav grouping evolves.

## Relevant Files

- /src/routes/+layout.svelte: Root shell that mounts navbar, sidebar nav, and bottom nav.
- /src/routes/+layout.server.ts: Layout load entry point for server-provided nav data.
- /src/lib/client/ui/navigation/pageNav/pageNav.svelte: Current sidebar tree and section composition.
- /src/lib/client/ui/navigation/bottomNav/BottomNav.svelte: Current mobile nav items and priority behavior.
- /src/lib/client/ui/navigation/navbar/navbar.svelte: Top navigation bar and global controls.
- /src/lib/client/ui/navigation/pageNav/group.svelte: Expandable group container pattern.
- /src/lib/client/ui/navigation/pageNav/groupItem.svelte: Active-item logic and child link rendering.
- /src/lib/client/stores/mobileNav.ts: Mobile drawer open/close state store.
- /src/lib/client/stores/navIcons.ts: Icon style preference persistence and lookup.
- /src/lib/shared/arr/capabilities.ts: Arr surface capability matrix and gating helpers.
- /src/lib/shared/pcd/types.ts: `ArrType`/`ArrAppType` types used for scope semantics.

## Relevant Tables

- arr_instances: Linked Arr apps and types that inform app-scope semantics.
- app_info: Version metadata currently surfaced in sidebar via layout load.

## Relevant Patterns

**Layout-Scoped Shell Data**: Root layout server load is the canonical place to prepare shell-level data used by multiple nav components. See [/src/routes/+layout.server.ts](/src/routes/+layout.server.ts) and [/src/routes/+layout.svelte](/src/routes/+layout.svelte).

**Single Navigation Source for Multiple Surfaces**: Sidebar and bottom nav should be driven from one shared definition to avoid drift between desktop and mobile UX. Current divergence is visible in [/src/lib/client/ui/navigation/pageNav/pageNav.svelte](/src/lib/client/ui/navigation/pageNav/pageNav.svelte) and [/src/lib/client/ui/navigation/bottomNav/BottomNav.svelte](/src/lib/client/ui/navigation/bottomNav/BottomNav.svelte).

**Capability-Gated Arr Semantics**: Arr-specific visibility must be derived from shared capability helpers and `ArrType` definitions, not inferred in UI components. See [/src/lib/shared/arr/capabilities.ts](/src/lib/shared/arr/capabilities.ts) and [/src/lib/shared/pcd/types.ts](/src/lib/shared/pcd/types.ts).

**Store-Driven Responsive Navigation State**: Responsive nav state and icon preferences are persisted in dedicated client stores and consumed by nav components. See [/src/lib/client/stores/mobileNav.ts](/src/lib/client/stores/mobileNav.ts) and [/src/lib/client/stores/navIcons.ts](/src/lib/client/stores/navIcons.ts).

## Relevant Docs

**/docs/plans/navigation-update/feature-spec.md**: You _must_ read this when working on requirements, success criteria, and rollout constraints.

**/docs/plans/navigation-update/research-technical.md**: You _must_ read this when working on file-level architecture and current-vs-target nav flow.

**/docs/plans/navigation-update/research-recommendations.md**: You _must_ read this when working on sequencing and practical implementation direction.

**/docs/plans/navigation-update/research-ux.md**: You _must_ read this when working on IA grouping, scope behavior, and mobile interaction design.

**/docs/ARCHITECTURE.md**: You _must_ read this when working on existing client navigation component boundaries.

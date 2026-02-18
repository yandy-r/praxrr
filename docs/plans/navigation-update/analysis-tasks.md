### Executive Summary

Phase the navigation-update work into discrete waves: a foundation pass that centralizes nav data via a typed registry and shared layout load, a grouping pass that adds section headers/cleanup, and a scope/productivity pass that layers in Arr scope awareness and command utilities. Each phase builds on the canonical `NavShell` so both sidebar and mobile nav surfaces stay synchronized and SSR-safe.

### Recommended Phase Structure

#### Phase 1: Foundation

- purpose
  Replace the dual hard-coded nav arrays with a single server-resolved registry so `PageNav` and `BottomNav` consume the same typed `NavShell`.
- suggested tasks
  1. Define `NavItemDef`/`NavShell` types in a shared module.
  2. Build the registry and resolver that filters by feature flags/capabilities and serializes icons.
  3. Wire `+layout.server.ts` to return `navShell`, pass it through `+layout.svelte`, and ensure `app.d.ts` types reflect the new data.
  4. Implement the client icon map and update the nav components to render from `navShell.groups`.
- parallelization notes
  Registry definition, icon map creation, and layout wiring can run concurrently; cleanup tasks (sidebar store removal, `groupItem` normalization) are safe to execute in parallel with data work.

#### Phase 2: Grouping

- purpose
  Add the IA polish-section headers, visual grouping, and accessibility fixes-without changing routes or nav behavior.
- suggested tasks
  1. Create `SectionHeader` (and any shared markup) to render group labels between nav sections.
  2. Adjust `PageNav` to insert headers, maintain active-state logic, and keep the expand/collapse UX intact over the new registry.
  3. Verify `BottomNav` priority sizing still aligns with the registry's `mobilePriority` field and the mobile drawer/escape behaviors still close appropriately.
  4. Sweep for aria improvements (e.g., `aria-current`, `aria-expanded`) and confirm consistent icon/emoji toggling.
- integration focus
  This phase depends on the `navShell` output from Phase 1; work focuses on presentation around the resolved groups/items.

#### Phase 3: Scope & Productivity

- purpose
  Introduce Arr scope awareness, capability-based filtering, and the productivity surface that leverages the unified nav data.
- suggested tasks
  1. Implement the Arr scope store (persisted in localStorage) and dropdown selector UI, anchored to the registry and `capabilities.ts`.
  2. Filter sidebar/bottom nav items client-side by the active scope while keeping disabled-but-visible items with informative tooltips.
  3. Surface the active scope badge in the navbar and plan the command palette/telemetry scaffolding (e.g., Bits UI Command integration, nav event batching).
- integration focus
  Relies on the resolved `NavShell` from Phase 1; the scope store must tie into `navShell.arrScopeOptions` without introducing SSR mismatches.

### Task Granularity Guidance

- appropriate task sizes
  Register/schema definition and resolver logic: multi-day work; layout wiring/nav component refactors: one-day changes; accessibility/cleanup tweaks: half-day tickets.
- tasks to split
  Separate "define schema + registry constants" from "resolver/filter + icon serialization" so data authors and evaluators can work in parallel on Phase 1.
- tasks to combine
  Bundle section header insertion, aria fixes, and BottomNav priority validation since they all touch the presentation layer over `navShell.groups`.

### Dependency Analysis

#### Independent Tasks

- Registry/type module creation can occur independently of nav rendering changes.
- Icon map implementation and layout/data wiring only need the shared types.
- Cleanup tasks (delete `sidebar.ts`, normalize `groupItem.svelte`) do not block the registry work.
- Accessibility polishing (aria attributes, tooltips) can run once nav data flows.

#### Sequential Tasks

- Registry/types -> resolver -> `+layout.server.ts` load -> `PageNav`/`BottomNav` rendering (client components rely on the resolved shell).
- Section header/grouping adjustments require the data from Phase 1 to exist.
- Scope store/selector/filtering waits for the stable `navShell` output plus `capabilities.ts` gating.

#### Potential Bottlenecks

- `+layout.server.ts` is the single gate for `navShell`; delays here block both nav surfaces.
- Expanding the shared `NavShell.groups` schema (mobile priority, `iconKey`, scope metadata) touches multiple components-coordinate changes or risk mismatched props.
- The Arr capability helpers (`$shared/arr/capabilities.ts`) feed scope filters; changes there ripple through the resolver and nav renderers.

### Suggested Task Template

- title format
  `[Phase X] Navigation - concise description` (e.g., `Phase 1 Navigation - define NavShell schema`).
- dependency annotation format
  Append `(depends on: +layout.server.ts update, shared navigation types)` to tasks that require earlier phase work.
- instruction completeness checklist
  Include success criteria (nav components render from shared data, section headers present, scope store filters), docs to update (feature spec/arch notes), required tests (layout load + nav render smoke), and dependencies (registry/types, capability helpers) so implementers have full context.

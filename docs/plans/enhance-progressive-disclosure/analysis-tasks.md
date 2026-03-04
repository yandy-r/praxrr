### Executive Summary

Use a contract-first, three-phase rollout. Build shared primitives first, then migrate high-priority pages in parallel, then finish medium-priority coverage and plan hardening. This minimizes merge conflicts and prevents route-level drift in section keys and hydration behavior.

### Recommended Phase Structure

#### Phase 1: Foundation Contracts

- purpose
  - Lock reusable primitives and key conventions.
- suggested tasks
  - Add section key registry.
  - Upgrade `AdvancedSection` interactions and animation.
  - Add `DisclosureSection` and `CollapsibleCard`.
  - Add shared server hydration utility.
- parallelization notes
  - `sectionKeys`, `AdvancedSection`, and `CollapsibleCard` can proceed in parallel.

#### Phase 2: Core Rollout

- purpose
  - Replace boilerplate in existing adopters and expand to high-priority forms.
- suggested tasks
  - Migrate Custom Formats + Media Settings.
  - Migrate Arr instance, delay profile, notification service, quality profile, and database config.
  - Add/align loader hydration where needed.
- dependencies
  - Requires Phase 1 completion.

#### Phase 3: Broad Rollout and Hardening

- purpose
  - Complete medium-priority targets and confirm plan readiness for implementation.
- suggested tasks
  - Migrate settings cards and remaining targeted forms/pages.
  - Add test and validation tasks for persistence and SSR mode behavior.
- integration focus
  - Enforce key registry adoption and prevent route-level exceptions.

### Task Granularity Guidance

- Keep tasks to 1-3 file touch targets.
- Split by route family (custom formats, media-management, arr, settings) for parallel execution.
- Separate high-risk migration cases (notification hidden-input behavior) into dedicated tasks.

### Dependency Analysis

#### Independent Tasks

- key registry creation
- `AdvancedSection` enhancement
- `CollapsibleCard` creation

#### Sequential Tasks

- route migrations depend on `DisclosureSection` availability
- hydration rollout depends on shared loader utility
- broad rollout depends on high-priority migration signoff

#### Potential Bottlenecks

- shared files (`AdvancedSection`, key registry, loader utility)
- notification form hidden-input handling
- repeated loader edits across many routes

### Suggested Task Template

- title format: `P{phase}.{task} [Area] [Action]`
- dependency format: `Depends on [none]` or `Depends on [1.2, 1.4]`
- checklist
  - explicit read-before files
  - explicit create/modify targets
  - clear implementation outcome

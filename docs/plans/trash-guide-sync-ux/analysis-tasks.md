### Executive Summary

A dependency-safe plan is to land source-awareness contracts first, then add cross-source
listing/filter behavior, and finally harden sync-page UX + verification. This sequencing minimizes
churn in shared types and server payloads while enabling parallel delivery across backend and
frontend tracks. The dependency graph should stay shallow with explicit coordination points around
shared route contracts and listing shell files.

### Recommended Phase Structure

#### Phase 1: Source-Aware Foundation

- purpose Establish shared source metadata types/contracts and baseline UI primitives required by
  all downstream tasks.
- suggested tasks
  - Add shared source reference/types and extend display types to carry source metadata.
  - Add reusable source badge/filter UI primitives.
  - Extend TRaSH-related query/API payloads to expose normalized source metadata fields.
  - Add Arr sync server-load support for source-grouped TRaSH sync state.
- parallelization notes Shared UI primitives and backend payload/query work can run in parallel
  after agreeing on source metadata shape.

#### Phase 2: Cross-Source Listing UX

- purpose Deliver source filtering, provenance badges, and all-sources browsing for custom formats
  and quality profiles.
- suggested tasks
  - Integrate source filter controls into listing ActionsBar shells.
  - Render source badges in table/card views with consistent semantics.
  - Add/adjust all-sources list loading and empty-state handling.
  - Preserve existing per-database tabs/redirect behavior while introducing source-aware navigation
    affordances.
- dependencies Depends on Phase 1 source metadata and route payload contracts.

#### Phase 3: Arr Sync UX + Verification

- purpose Surface source-aware sync selection/configuration in Arr sync page and complete
  verification coverage.
- suggested tasks
  - Add source-grouped sync sections/summary and integrate save/preview/dirty patterns.
  - Reflect queue dedupe and sync-status behavior in user-visible actions.
  - Add route/query/UI tests for multi-source workflows and regression scenarios.
  - Run lint/check/test validation sweep with targeted follow-up fixes.
- integration focus Ensure sync page and listing pages consume consistent source metadata and
  maintain strict Arr scope behavior.

### Task Granularity Guidance

- appropriate task sizes 1-3 files per task target; one logical behavior outcome per task.
- tasks to split Split shared-type changes from each page integration; split server payload work
  from UI rendering work.
- tasks to combine Combine paired UI-only updates when they share the same primitive (e.g., badge
  variant + wrapper component).

### Dependency Analysis

#### Independent Tasks

- shared source badge component
- source filter component
- backend query helper additions for source-grouped reads

#### Sequential Tasks

- listing page integration after source metadata contracts exist
- all-sources route behavior after backend payload/query support lands
- Arr sync grouped rendering after server load contract updates

#### Potential Bottlenecks

- `packages/praxrr-app/src/lib/shared/pcd/display.ts` contract changes consumed by multiple
  routes/components.
- listing page shells under `custom-formats` and `quality-profiles` due to parallel edits in similar
  files.
- `packages/praxrr-app/src/routes/arr/[id]/sync/+page.server.ts` and sync queries due to shared
  scope semantics.

### Suggested Task Template

- title format `Phase <n> - <Area> - <Outcome>`
- dependency annotation format `Depends on [Task IDs]`
- instruction completeness checklist
  - files in scope (1-3 targets)
  - explicit behavior outcome
  - validation steps/tests
  - constraints/non-goals

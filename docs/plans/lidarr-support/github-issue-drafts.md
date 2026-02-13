# GitHub Issue Drafts: Lidarr Support

## Issue Creation Status

Issues are now enabled and the Lidarr tracking set has been created.

Active tracking issues:

- Parent umbrella: [#6](https://github.com/yandy-r/profilarr/issues/6)
- Child issues:
  - [#1](https://github.com/yandy-r/profilarr/issues/1)
  - [#2](https://github.com/yandy-r/profilarr/issues/2)
  - [#3](https://github.com/yandy-r/profilarr/issues/3)
  - [#4](https://github.com/yandy-r/profilarr/issues/4)
  - [#5](https://github.com/yandy-r/profilarr/issues/5)

Status sync (2026-02-13):

- `#1` has been re-verified against implementation scope and acceptance criteria in this branch.
- `#1` is ready for issue-state closeout once merged to the target branch.

Planning workflow requirement:

- When running `shared-context` and `parallel-plan`, map generated work items to issue IDs `#1`-`#5` and track rollup status in `#6`.

## Recommended Issue Set

1. `feat(lidarr): enable instance onboarding and type contract parity`
2. `feat(lidarr): extend sync and media-management compatibility`
3. `feat(lidarr): implement library and release search support`
4. `feat(lidarr): generalize Arr UI controls and capability states`
5. `chore(lidarr): decide rename/upgrades scope and complete parity test matrix`

---

## 1) feat(lidarr): enable instance onboarding and type contract parity

### Body

```markdown
## Summary

Add foundational Lidarr support so instances can be created/tested and type contracts are aligned across backend + API schemas.

## Context

Research/spec: `docs/plans/lidarr-support/feature-spec.md`

## Scope

- Add `lidarr` to onboarding allowlists:
  - `src/routes/arr/new/+page.server.ts`
  - `src/routes/arr/test/+server.ts`
  - `src/routes/arr/components/InstanceForm.svelte`
- Extend OpenAPI schemas and generated API typings:
  - `docs/api/v1/schemas/arr.yaml`
  - `docs/api/v1/schemas/pcd.yaml` (if entity enums need expansion in this phase)
  - regenerate `src/lib/api/v1.d.ts`
- Align shared/server arr-type unions where needed to avoid runtime/compile drift.

## Acceptance Criteria

- Lidarr instance creation and connection test succeed through the existing UI flow.
- `ArrType` and related API schema unions include `lidarr` where expected.
- Type checks pass without ad-hoc casts for core onboarding paths.
- Existing Radarr/Sonarr onboarding remains unchanged.

## Validation

- `deno task check`
- Relevant unit/server tests for onboarding + schema generation workflow.
```

---

## 2) feat(lidarr): extend sync and media-management compatibility

### Body

```markdown
## Summary

Integrate Lidarr into section-based sync flows with clear handling for media-management and mapping constraints.

## Context

Research/spec: `docs/plans/lidarr-support/feature-spec.md`

## Scope

- Extend sync type handling and mappings where needed:
  - `src/lib/server/sync/mappings.ts`
  - `src/lib/server/sync/mediaManagement/syncer.ts`
  - related sync handlers/registry touchpoints
- Align PCD/shared typing and entity handling strategy for Lidarr-compatible media-management configs.
- Ensure arr sync job pipeline can process Lidarr instances without breaking Radarr/Sonarr.

## Acceptance Criteria

- Sync jobs can run for Lidarr instances through existing section orchestration.
- Media-management sync path has an explicit, tested strategy for Lidarr (supported or capability-gated).
- Quality/delay/media-management section status handling remains consistent.

## Validation

- `deno task check`
- targeted sync tests
- manual queue/job smoke test for Lidarr instance.
```

---

## 3) feat(lidarr): implement library and release search support

### Body

```markdown
## Summary

Add Lidarr branches to Arr library and releases APIs and surface them in the Arr instance library UI.

## Context

Research/spec: `docs/plans/lidarr-support/feature-spec.md`

## Scope

- Implement required methods in `src/lib/server/utils/arr/clients/lidarr.ts`.
- Add Lidarr support in:
  - `src/routes/api/v1/arr/library/+server.ts`
  - `src/routes/api/v1/arr/releases/+server.ts`
- Extend response typing/contracts for Lidarr library/releases.
- Update library UI behavior to handle Lidarr data and avoid unsupported-type runtime errors.

## Acceptance Criteria

- `/api/v1/arr/library` returns `type: "lidarr"` payload for Lidarr instances.
- `/api/v1/arr/releases` returns grouped release data for Lidarr instances.
- Library UI can render Lidarr path without generic unsupported error.
- API error envelope consistency is preserved.

## Validation

- `deno task check`
- Endpoint-focused tests for Lidarr library/releases
- Manual smoke test against a real Lidarr instance/container.
```

---

## 4) feat(lidarr): generalize Arr UI controls and capability states

### Body

```markdown
## Summary

Refactor UI surfaces that assume only Radarr/Sonarr so Lidarr is first-class and unsupported actions are explicit.

## Context

Research/spec: `docs/plans/lidarr-support/feature-spec.md`

## Scope

- Replace hardcoded 2-app option sets/logos/copy in Arr pages and forms.
- Add shared app metadata/capability representation to drive UI decisions.
- Update condition/selection controls that are binary Radarr/Sonarr today (where in scope).
- Ensure unsupported feature pages/actions show clear messaging instead of backend-only failures.

## Acceptance Criteria

- User-facing copy and selectors include Lidarr where relevant.
- No major Arr page silently assumes only two app types.
- Unsupported Lidarr actions are clearly communicated in UI.
- Accessibility expectations (keyboard + non-color-only distinctions) remain intact.

## Validation

- `deno task check`
- targeted UI/e2e coverage for Arr navigation and settings flows.
```

---

## 5) chore(lidarr): decide rename/upgrades scope and complete parity test matrix

### Body

```markdown
## Summary

Resolve product/technical decisions for Lidarr rename/upgrades support and lock a test matrix for launch readiness.

## Context

Research/spec: `docs/plans/lidarr-support/feature-spec.md`

## Scope

- Decide v1 behavior for:
  - Rename flow (`src/routes/arr/[id]/rename/+page.server.ts`, `src/lib/server/jobs/handlers/arrRename.ts`)
  - Upgrades flow (`src/routes/arr/[id]/upgrades/+page.server.ts`, `src/lib/server/jobs/handlers/arrUpgrade.ts`)
- Implement chosen behavior (support or explicit capability gating).
- Define and add required regression/integration/e2e coverage for Lidarr launch criteria.

## Acceptance Criteria

- Rename/upgrades behavior for Lidarr is explicit and documented.
- Job handlers/pages align with the decided capability state.
- Test matrix covers mixed Arr environments and regression safety for existing Radarr/Sonarr behavior.

## Validation

- `deno task check`
- `deno task test`
- relevant `deno task test:e2e` subset(s).
```

---

## Rollup Completion Update (Task 3.7)

### Final Task-to-Issue Mapping (from `parallel-plan.md`)

- `#1` foundation/onboarding/type contracts: `1.1`, `1.3`, `1.4`, `1.5`, `3.4`
- `#2` sync/media-management compatibility: `1.2`, `1.4`, `2.1`, `2.4`, `2.5`, `3.5`
- `#3` library/releases delivery: `2.1`, `2.2`, `2.3`, `3.4`
- `#4` UI generalization/capability UX: `1.6`, `1.7`, `2.6`, `2.7`, `3.3`, `3.6`
- `#5` rename/upgrades scope + parity matrix: `3.1`, `3.2`, `3.5`
- `#6` umbrella rollup: `3.7` (status aggregation and closeout notes for `#1`-`#5`)

### Completion Notes

- `#1` completed in scope: onboarding allowlists and contract chain updates
  (`arr.yaml` -> `pcd.yaml` -> generated `src/lib/api/v1.d.ts`) plus onboarding regression
  coverage in `src/tests/base/lidarrOnboarding.test.ts`.
- `#2` completed in scope: sync mappings and media-management behavior implemented with
  the v1 entity-reuse strategy and mixed-arr sync regression coverage in
  `src/tests/jobs/lidarrSync.test.ts`.
- `#3` completed in scope: Lidarr client methods and API branches for
  `/api/v1/arr/library` and `/api/v1/arr/releases`, with regression coverage in
  `src/tests/base/lidarrApiParity.test.ts`.
- `#4` completed in scope: capability metadata adopted across onboarding/list/condition/
  library UX, with end-to-end flow coverage in
  `src/tests/e2e/specs/2.40-lidarr-core-flow.spec.ts`.
- `#5` completed in scope: v1 decision locked as capability-gated rename/upgrades for
  Lidarr, enforced in handlers/pages with explicit unsupported responses and covered by
  `src/tests/upgrades/lidarrCapabilityGates.test.ts`.
- `#6` rollup status: child issue scopes `#1`-`#5` are complete in this implementation
  branch; umbrella is ready for closeout after merge and issue-state sync.

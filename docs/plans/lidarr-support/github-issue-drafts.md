# GitHub Issue Drafts: Lidarr Support

## Issue Creation Status

Attempted to create issues in `yandy-r/profilarr`, but GitHub API returned:

- `410 Issues has been disabled in this repository`

Once issues are enabled, the drafts below can be posted as-is.

## Recommended Issue Set

1. `feat(lidarr): enable instance onboarding and type contract parity`
2. `feat(lidarr): implement library and release search support`
3. `feat(lidarr): extend sync and media-management compatibility`
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

## 2) feat(lidarr): implement library and release search support

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

## 3) feat(lidarr): extend sync and media-management compatibility

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

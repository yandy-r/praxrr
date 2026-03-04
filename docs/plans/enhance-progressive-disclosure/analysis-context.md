## Executive Summary

`enhance-progressive-disclosure` extends an already-working preference persistence pipeline across many form-heavy pages by standardizing on a wrapper component (`DisclosureSection`) and adding animation/accessibility polish to `AdvancedSection`. The backend contract already exists (`user_interface_preferences`, query layer, `/api/v1/ui-preferences`), so this work is primarily UI composition, key governance, and per-route hydration consistency. The safest strategy is contract-first: lock key registry + shared wrapper + hydration utility, then migrate route groups in parallel.

## Architecture Context

- System Structure: Existing DB/API/store stack already persists `basic|advanced` per `section_key`; rollout is mostly client and loader integration.
- Data Flow: Server `+page.server.ts` preloads section modes -> page passes initial modes to disclosure wrapper -> wrapper binds to store -> store persists via debounced PATCH.
- Integration Points: `AdvancedSection.svelte`, new `DisclosureSection.svelte`, new key registry, route components, and relevant `+page.server.ts` loaders.

## Critical Files Reference

- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/enhance-progressive-disclosure/shared.md: scope, priorities, risks, and rollout targets.
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/enhance-progressive-disclosure/feature-spec.md: behavior and acceptance contract.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte: current disclosure UI contract.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/stores/userInterfacePreferences.ts: lifecycle/debounce/retry/cleanup semantics.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/user_interface_preferences.ts: key regex and DB query behavior.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/api/v1/ui-preferences/+server.ts: API behavior to preserve.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/GeneralForm.svelte: baseline manual wiring pattern.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/general/+page.server.ts: existing SSR hydration example.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte: second baseline migration target.

## Patterns to Follow

- Wrapper-first composition: keep persistence wiring out of route components.
- Registry-based keys: never inline new `section_key` strings.
- SSR-first hydration: seed initial mode in loaders for flicker-free first paint.
- Preserve existing two-state contract: `basic|advanced` only.

## Cross-Cutting Concerns

- Accessibility: preserve `aria-expanded`, `aria-controls`, and keyboard behavior while adding animation.
- Motion: respect reduced-motion users (duration 0 path).
- Form integrity: avoid losing hidden inputs when advanced blocks unmount (notification form is highest-risk).
- Auth semantics: maintain existing 401 handling and `clearOnAuthChange` lifecycle behavior.

## Parallelization Opportunities

- Independent: key registry, AdvancedSection animation work, and CollapsibleCard creation.
- After wrapper contract lock: route migration tasks can run by page family in parallel.
- Coordination hotspots: shared wrapper API, section key constants, and shared loader utility.

## Implementation Constraints

- No schema or API redesign; reuse existing endpoint and query model.
- Section keys must satisfy strict regex and length constraints.
- Keep existing debounce/retry behavior in store-driven persistence.
- Use current settings-page visual pattern (inline rounded card style) for collapsible settings behavior.

## Planning Recommendations

- Phase 1: finalize reusable contracts and primitives.
- Phase 2: migrate baseline and high-priority pages in parallel batches.
- Phase 3: complete medium-priority rollout, then harden tests and adoption checks.

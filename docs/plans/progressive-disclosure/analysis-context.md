# Analysis Context: progressive-disclosure

### Executive Summary

Progressive disclosure should ship as a reusable, explicit `Show Advanced` / `Hide Advanced` pattern for user-facing forms, with per-user persisted section preferences. The architecture supports this cleanly: client-side interaction in shared UI/stores and durable state in authenticated server/database paths.

### Architecture Context

- System Structure: Route-first SvelteKit UI (`+page.svelte` + `+page.server.ts`) on Deno server modules and SQLite migrations/queries.
- Data Flow: UI toggles update local state immediately, then sync to authenticated server persistence keyed by user and section scope.
- Integration Points: shared UI form components, route server loaders/actions, auth middleware/session lookup, DB migrations/queries.

### Critical Files Reference

- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/shared.md: Feature scope and UX goals.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/MaskedApiKey.svelte: Explicit text-toggle UX reference.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte: Existing expandable-state behavior.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/stores/dataPage.ts: Local persisted preference pattern.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/stores/navScope.ts: Section scoping inputs.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/auth/middleware.ts: Auth gate for persistence.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/migrations.ts: Migration registration.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/schema.sql: Schema alignment.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte: First rollout target.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/components/GeneralForm.svelte: Rollout target.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/GeneralForm.svelte: Rollout target.

### Patterns to Follow

- Route-pair separation: UI state in `+page.svelte`, validation/persistence in `+page.server.ts`.
- Explicit control labels: always textual `Show Advanced` / `Hide Advanced`.
- Section-keyed state: stable per-section keys, not index-based expansion.
- Fail-fast server validation: reject unknown keys and unauthenticated writes.

### Cross-Cutting Concerns

- Security: user/session scoping only; no anonymous durable writes.
- Performance: idempotent upserts and indexed `(user_id, section_key)` lookups.
- Testing: route/API validation + UI accessibility + persistence restore coverage.
- UX: advanced controls must be visually distinct and understandable for non-developers.

### Parallelization Opportunities

- Independent: UI primitive design, DB migration/query work, API contract drafting, test design.
- Coordination Hotspots: shared `section_key` taxonomy, persistence defaults, and hydration timing.

### Implementation Constraints

- `requirements.md` is currently missing.
- Existing schema lacks persisted UI preference table.
- API contract for preference persistence does not yet exist.

### Planning Recommendations

- Start with contract and key taxonomy, then schema/query implementation.
- Build shared UI/store primitives once and reuse across form families.
- Roll out by route family in parallel after primitives are stable.

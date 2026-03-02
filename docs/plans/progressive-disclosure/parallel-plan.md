# Progressive Disclosure Implementation Plan

Progressive disclosure should be implemented as a reusable UX architecture that defaults to a simple interface while exposing advanced controls only through explicit `Show Advanced` / `Hide Advanced` actions. The implementation should separate fast local interaction from durable per-user persistence, using authenticated server state keyed by stable section identifiers. The highest-leverage path is to build one shared advanced-section primitive and one preference persistence pipeline first, then integrate by route family in parallel. This approach preserves consistency for non-developer users, prevents UI drift, and keeps rollout risk contained.

## Critically Relevant Files and Documentation

- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/shared.md: Authoritative feature context for this plan.
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/analysis-context.md: Condensed architecture and dependency context.
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/analysis-code.md: Implementation patterns and target touchpoints.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/MaskedApiKey.svelte: Explicit text-toggle UX reference.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/stores/dataPage.ts: Existing preference persistence pattern.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/migrations.ts: Migration registration flow.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/schema.sql: DB schema reference.
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/auth/middleware.ts: Auth/session gate for persisted writes.
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/openapi.yaml: Contract-first API definition source.
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/endpoints.md: API documentation index to keep in sync.

## Implementation Plan

### Phase 1: Contracts and Persistence Foundation

#### Task 1.1: Define acceptance criteria and section-key taxonomy Depends on [none]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/shared.md
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/analysis-context.md
- /home/yandy/Projects/github.com/yandy-r/praxrr/tasks/todo.md

**Instructions**

Files to Create

- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/requirements.md

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/shared.md

Write an explicit checklist for UX behavior, persistence rules, default states, and section-key format. Lock one deterministic section-key convention before schema/API work starts.
Checklist must explicitly include:

- Regex: `^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$`
- Canonical keys:
  - `media-management:media-settings:naming`
  - `media-management:media-settings:folder-management`
  - `media-management:media-settings:importing`
  - `quality-profiles:general:custom-format-scoring`
  - `quality-profiles:general:upgrade-settings`
  - `custom-formats:general:conditions`
  - `custom-formats:general:scoring`
- Invalid-key examples: uppercase segments, empty segments, missing separators, trailing separators.
- Ownership mapping: each key must map to exactly one route family and one UI section owner.

#### Task 1.2: Add user interface preferences schema migration Depends on [1.1]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/migrations.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/schema.sql
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/requirements.md

**Instructions**

Files to Create

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/migrations/050_create_user_interface_preferences.ts

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/migrations.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/schema.sql

Add a new table for per-user, per-section advanced visibility preferences with uniqueness and lookup indexes. Register the migration and align schema docs in the same task.
Schema requirements to implement in this task:

- Columns: `user_id`, `section_key`, `mode`, `updated_at`
- Constraint: `mode` must be one of `basic|advanced`
- Unique index on `(user_id, section_key)`
- Supporting index on `user_id`
- Foreign key `user_id -> users.id` with `ON DELETE CASCADE`
- Reject null/empty `section_key` at schema level.

#### Task 1.3: Define API contract for preferences endpoints Depends on [1.1]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/openapi.yaml
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/endpoints.md
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/requirements.md

**Instructions**

Files to Create

- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/api-contract.md

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/openapi.yaml
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/endpoints.md

Define request/response schemas for reading and updating disclosure preferences. Ensure contract names and field semantics match the section-key taxonomy from task `1.1`.

### Phase 2: Server and UI Primitives

#### Task 2.1: Implement DB query module for disclosure preferences Depends on [1.2]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/users.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/sessions.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/migrations/050_create_user_interface_preferences.ts

**Instructions**

Files to Create

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/user_interface_preferences.ts

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/users.ts

Implement typed read/write helpers scoped by authenticated user id and section key. Keep writes idempotent and reject invalid keys.

#### Task 2.2: Add `/api/v1/ui-preferences` persistence endpoint Depends on [1.3, 2.1]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/openapi.yaml
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/auth/middleware.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/user_interface_preferences.ts

**Instructions**

Files to Create

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/api/v1/ui-preferences/+server.ts

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/openapi.yaml
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/endpoints.md

Implement authenticated GET and PATCH behavior with fail-fast validation and deterministic error responses. Keep route behavior aligned with the contract defined in task `1.3`.
This task must include an explicit error/status matrix:

- `GET 200`: authenticated user, payload returned
- `PATCH 200`: authenticated user, upsert succeeded
- `401`: no authenticated user/session (including `AUTH=local` requests without session identity)
- `403`: authenticated but unauthorized scope access attempt
- `400`: invalid payload (`section_key`, `mode`, schema violations)
- `404`: requested key not found when using strict read mode
- `409`: version or concurrency conflict (if optimistic concurrency token is provided)
  Auth-mode behavior contract:
- `AUTH=off`: endpoint must return `401` for persistence operations (no durable anonymous writes)
- `AUTH=local`: loopback bypass does not bypass user-scoped persistence checks
- `AUTH=oidc|on`: standard session-required behavior.
  PATCH semantics:
- Upsert by `(user_id, section_key)`
- Idempotent when payload equals stored value
- Return persisted canonical state in response body.

#### Task 2.3: Create reusable advanced section UI primitive Depends on [1.1]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/MaskedApiKey.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/requirements.md

**Instructions**

Files to Create

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/actions/ActionsBar.svelte

Build a shared component that clearly separates basic and advanced content with text-labeled show/hide controls and ARIA state. Keep styles and behavior user-focused, not developer-centric.

#### Task 2.4: Add client store bridge for persisted disclosure state Depends on [2.2]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/stores/dataPage.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/stores/navScope.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/api/v1/ui-preferences/+server.ts

**Instructions**

Files to Create

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/stores/userInterfacePreferences.ts

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/stores/dataPage.ts

Create a store that hydrates from the new API and exposes per-section read/write helpers. Preserve fast local responsiveness while syncing durable state asynchronously.
Store sync rules required in this task:

- Optimistic local update first, then async PATCH
- Debounce outbound writes by `300ms`
- Retry up to 3 times with exponential backoff (`300ms`, `600ms`, `1200ms`)
- Roll back to last acknowledged server value on final failure
- If response is `401`, stop retries and surface auth-required UX signal
- Keep per-key in-flight request deduplication to avoid races.

### Phase 3: Route Rollout and Validation

#### Task 3.1: Integrate progressive disclosure in media management form Depends on [2.3, 2.4]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/+page.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte

**Instructions**

Files to Create

- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/media-management-rollout-notes.md

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/+page.svelte

Apply `AdvancedSection` to advanced controls with clear labels and persisted state keys. Record rollout edge cases in the feature notes file.
Exact section/key mapping for this route family:

- `media-management:media-settings:naming`: rename token controls, naming strategy options
- `media-management:media-settings:folder-management`: folder/organization tuning controls
- `media-management:media-settings:importing`: import behavior toggles and advanced import rules
  Do not move basic controls into advanced sections; only high-complexity controls are keyed above.

#### Task 3.2: Integrate progressive disclosure in quality profiles form Depends on [2.3, 2.4]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/components/GeneralForm.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/general/+page.server.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/stores/userInterfacePreferences.ts

**Instructions**

Files to Create

- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/quality-profiles-rollout-notes.md

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/components/GeneralForm.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/general/+page.server.ts

Add explicit advanced sections and connect server-side load/save state for this route family. Keep behavior consistent with task `3.1`.
Exact section/key mapping for this route family:

- `quality-profiles:general:custom-format-scoring`: score weighting and per-format scoring rules
- `quality-profiles:general:upgrade-settings`: upgrade eligibility and cutoff-related tuning
- `quality-profiles:general:advanced-thresholds`: advanced threshold/priority controls
  Document field-level assignment to these keys in the rollout notes file during implementation.

#### Task 3.3: Integrate progressive disclosure in custom formats form Depends on [2.3, 2.4]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/GeneralForm.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/general/+page.server.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/stores/userInterfacePreferences.ts

**Instructions**

Files to Create

- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/custom-formats-rollout-notes.md

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/GeneralForm.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/custom-formats/[databaseId]/[id]/general/+page.server.ts

Mirror the same advanced-section pattern and persistence behavior used in other route families to maintain UX consistency.
Exact section/key mapping for this route family:

- `custom-formats:general:conditions`: advanced match-condition builder controls
- `custom-formats:general:scoring`: score application and weighting controls
- `custom-formats:general:negation-and-groups`: negation/grouping and nested condition controls
  Document field-level assignment to these keys in the rollout notes file during implementation.

#### Task 3.4: Add API and UX persistence tests Depends on [2.2, 3.1, 3.2, 3.3]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/routes/trashGuideSources.test.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/e2e/specs/2.40-api-key-masking.spec.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/requirements.md

**Instructions**

Files to Create

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/routes/uiPreferencesApi.test.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/tests/e2e/specs/2.50-progressive-disclosure.spec.ts

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/requirements.md

Add tests for authenticated persistence, section-key isolation, default behavior, and user-visible toggle clarity. Mark acceptance criteria complete only when each case is covered.
Minimum test cases required:

- unauthenticated read/write attempts return `401`
- authenticated user A cannot read/write user B preferences
- key-collision regression: similar keys do not overwrite each other
- first-visit default state is `basic`
- persisted advanced state restores after refresh and new session
- route-family isolation: media-management keys do not affect quality/custom-format pages.

#### Task 3.5: Finalize feature documentation and rollout guidance Depends on [3.4]

**READ THESE BEFORE TASK**

- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/features/README.md
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/endpoints.md
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/plans/progressive-disclosure/requirements.md

**Instructions**

Files to Create

- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/features/progressive-disclosure.md

Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/features/README.md
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/endpoints.md

Document the user-facing behavior, advanced-section design rules, and persistence semantics. Ensure docs clearly explain this is for end users managing media apps, not developer-only configuration.

## Advice

- Treat section-key design as a contract artifact; changing it later creates migration and UX restore bugs.
- Keep advanced control labeling explicit everywhere; do not reintroduce icon-only disclosure patterns on individual pages.
- Avoid coupling rollout tasks across route families; complete each family independently to preserve parallelism.
- Prefer deterministic defaults (`basic` on first visit) and explicit persistence writes rather than implicit fallback chains.
- Update API spec and docs in the same tasks as route/endpoint changes to prevent contract drift.

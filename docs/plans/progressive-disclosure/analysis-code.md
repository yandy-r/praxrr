# Analysis Code: progressive-disclosure

## Executive Summary

The codebase already has the right seams for progressive disclosure: shared client components/stores for interaction and server route/API layers for validated persistence. Implementation should add one reusable disclosure component, one persistence store pathway, and route-by-route integration.

### Related Components

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/MaskedApiKey.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/stores/dataPage.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/stores/navScope.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/migrations.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/schema.sql
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/users.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/sessions.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/utils/auth/middleware.ts

### Implementation Patterns

**Route + Server Pairing**: UI behavior in `+page.svelte`, persistence and validation in `+page.server.ts`.

- Example: /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/general/+page.svelte
- Apply to: `ui`, `route`, `server`

**Explicit Text Toggle Pattern**: Avoid icon-only disclosure controls.

- Example: /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/MaskedApiKey.svelte
- Apply to: `ui`, `accessibility`

**Scoped Preference Keys**: Stable route/entity/section keys.

- Example: /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/stores/dataPage.ts
- Apply to: `ui-store`, `persistence`

**Migration-First Schema Change**: Add migration + registration + schema alignment together.

- Example: /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/migrations.ts
- Apply to: `database`

### Integration Points

#### Files to Create

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/migrations/050_create_user_interface_preferences.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/user_interface_preferences.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/api/v1/ui-preferences/+server.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/AdvancedSection.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/stores/userInterfacePreferences.ts

#### Files to Modify

- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/schema.sql
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/migrations.ts
- /home/yandy/Projects/github.com/yandy-r/praxrr/docs/api/v1/openapi.yaml
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/components/GeneralForm.svelte
- /home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/GeneralForm.svelte

### Conventions

- Naming: deterministic `section_key` values and descriptive component names.
- Error handling: reject invalid payloads and unauthenticated writes.
- Testing: add route/API tests and e2e checks for persisted toggle behavior.

### Gotchas and Warnings

- LocalStorage-only persistence is insufficient for cross-device expectations.
- Missing schema support will block all server persistence tasks.
- Unstable section keys can break preference restore after UI refactors.

### Task Guidance by Area

- database: migration + query helpers + indexes first.
- api: strict read/write endpoint with validated payloads and clear errors.
- ui: shared advanced section component and route integration by form family.

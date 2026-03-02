# Progressive Disclosure

Praxrr’s UI stack is route-driven (`+page.svelte`/`+page.server.ts`) with reusable client components, so progressive disclosure should be implemented as a shared UI pattern then applied consistently across high-complexity forms. The core integration path is explicit `Show Advanced`/`Hide Advanced` controls in section-level form components, with server-backed per-user persistence so state survives devices and sessions. Existing architecture already supports this split: Svelte stores and shared UI components for immediate interaction, plus auth/session-aware DB queries and API routes for durable preference state. For this feature, the key UX rule is clarity for non-developer users, meaning advanced controls must be visually distinct, clearly labeled, and never hidden behind ambiguous icon-only disclosure affordances.

## Relevant Files

- packages/praxrr-app/src/routes/+layout.server.ts: Provides request-scoped layout context for global UI state wiring.
- packages/praxrr-app/src/routes/+layout.svelte: App shell where global disclosure controls can be surfaced.
- packages/praxrr-app/src/lib/client/ui/actions/ActionsBar.svelte: Shared action area suitable for explicit Show/Hide Advanced controls.
- packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte: Existing expand/collapse pattern to adapt toward explicit advanced sections.
- packages/praxrr-app/src/lib/client/stores/dataPage.ts: Existing per-page preference persistence pattern.
- packages/praxrr-app/src/lib/client/stores/navScope.ts: Provides section identity inputs for per-section preference keys.
- packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte: High-complexity form likely to consume disclosure component first.
- packages/praxrr-app/src/routes/quality-profiles/[databaseId]/components/GeneralForm.svelte: Quality profile form with advanced concepts to segment.
- packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/GeneralForm.svelte: Custom format editing form with power-user controls.
- packages/praxrr-app/src/lib/server/db/queries/users.ts: User identity query surface for binding preferences to user records.
- packages/praxrr-app/src/lib/server/db/queries/sessions.ts: Session context needed for per-user preference retrieval.
- packages/praxrr-app/src/lib/server/utils/auth/middleware.ts: Auth/session flow used before reading/writing persisted disclosure settings.
- packages/praxrr-app/src/lib/server/db/migrations/: Migration location for adding persistent disclosure preference table.
- packages/praxrr-app/src/lib/server/db/schema.sql: Current schema reference to align new preference storage.

## Relevant Tables

- users: User identities for scoping disclosure preferences.
- sessions: Session linkage used to resolve active user context.
- auth_settings: Auth mode/session duration context that can affect preference retrieval behavior.
- user_interface_preferences (proposed): Per-user, per-section progressive disclosure state (`beginner`/`advanced`).

## Relevant Patterns

**Route + Server Pairing**: Keep UI toggle behavior in `+page.svelte` and persistence/validation in `+page.server.ts`, matching existing route composition. Example: [packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/general/+page.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/[id]/general/+page.svelte).

**Explicit Toggle-Control UX**: Use clear text buttons and visible state (`Show Advanced` / `Hide Advanced`) instead of icon-only disclosure gestures. Example: [packages/praxrr-app/src/lib/client/ui/form/MaskedApiKey.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/form/MaskedApiKey.svelte).

**Shared Component Reuse**: Introduce one reusable advanced-section UI primitive under shared UI components and consume it across forms to keep behavior consistent. Example: [packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte).

**Fail-Fast Validation**: Validate disclosure payloads early and return explicit errors through route/API layers, mirroring existing server error conventions. Example: [packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/+page.server.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/+page.server.ts).

## Relevant Docs

**tasks/todo.md**: You _must_ read this when working on progressive-disclosure scope tied to issue #11 and related UX items.

**docs/ARCHITECTURE.md**: You _must_ read this when deciding component vs route vs server ownership for disclosure behavior.

**docs/DEVELOPMENT.md**: You _must_ read this when implementing feature changes under repository conventions and quality constraints.

**docs/api/README.md**: You _must_ read this when introducing or changing API endpoints for persisted disclosure preferences.

**docs/api/endpoints.md**: You _must_ read this when mapping disclosure persistence into the existing API surface.

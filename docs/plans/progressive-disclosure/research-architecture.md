# Architecture Research: progressive-disclosure

## System Overview

Praxrr is a SvelteKit app in a monorepo with a server-first route layer (`src/routes`) backed by a Deno-based app layer under `src/lib/server`, and client state/rendering under `src/lib/client`. Runtime startup is centralized in `hooks.server.ts`, which initializes DB/migrations/PCD/sync jobs and auth context before route handlers execute. Business logic is concentrated in server modules (PCD entity handlers, sync processors, job dispatcher, app DB), while UI behavior is assembled from reusable Svelte components and lightweight stores.

## Relevant Components

- [packages/praxrr-app/src/hooks.server.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/hooks.server.ts): Global startup and middleware bootstrap (config, DB, migrations, jobs, auth wiring).
- [packages/praxrr-app/src/routes/+layout.server.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/+layout.server.ts): Provides per-request layout data (`layoutData`) for nav/auth/session-aware UI.
- [packages/praxrr-app/src/routes/+layout.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/+layout.svelte): Shell composition for all pages and a likely insertion point for global UI controls/state propagation.
- [packages/praxrr-app/src/lib/server/navigation/layoutData.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/navigation/layoutData.ts): Navigation structure generation used by layout across sections.
- [packages/praxrr-app/src/lib/server/navigation/resolver.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/navigation/resolver.ts): Navigation mapping and scope resolution used by sectioned pages.
- [packages/praxrr-app/src/routes/quality-profiles](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles): Multi-section entity management route with nested pages and forms.
- [packages/praxrr-app/src/routes/media-management](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management): Multi-section page patterns and nested forms that are strong candidates for section-level disclosure.
- [packages/praxrr-app/src/lib/client/stores/dataPage.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/stores/dataPage.ts): Existing client persistence pattern for per-page user preferences.
- [packages/praxrr-app/src/lib/client/stores/navScope.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/stores/navScope.ts): Persistent scope state handling between views.
- [packages/praxrr-app/src/lib/client/stores/navIcons.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/stores/navIcons.ts): UI-state persistence store pattern for local per-user settings.
- [packages/praxrr-app/src/lib/client/alerts/store.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/alerts/store.ts): Pattern for cross-app client state + feedback pipeline.
- [packages/praxrr-app/src/lib/client/ui/actions/ActionsBar.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/actions/ActionsBar.svelte): Shared action toolbar component host location for toggles/controls.
- [packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/client/ui/table/ExpandableTable.svelte): Existing expand/collapse implementation pattern (not reusable for form-level disclosure yet).
- [packages/praxrr-app/src/lib/server/db/db.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/db.ts): DB lifecycle and connection management.
- [packages/praxrr-app/src/lib/server/db/queries/users.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/users.ts): User/session context source for per-user preference persistence.
- [packages/praxrr-app/src/lib/server/db/queries/sessions.ts](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/queries/sessions.ts): Session-backed auth context used in server routes.
- [packages/praxrr-app/src/lib/server/db/schema.sql](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/lib/server/db/schema.sql): Canonical database tables; useful for identifying where UI preferences could be persisted.

## Data Flow

Initial request enters SvelteKit routing (`+page.ts`, `+page.server.ts`, or `+server.ts`) and loads data through server-side loaders or API handlers. Server loaders call shared DB query modules and/or PCD query modules, pass typed payloads into components, and render Svelte pages composed from shared form/table components. Mutations usually happen through form actions in `+page.server.ts` (submit/update/create/delete), then pages use client-side stores and actions to reflect dirty state or local persistence.

For progressive disclosure, disclosure state is currently mostly client-side when used: components and pages already use local storage-backed stores for view/source settings and section selection, so a reusable disclosure component can follow the same pattern at form level; cross-route consistency comes from putting the pattern in `src/lib/client/ui` and using it across route forms. For “per-user” persistence, flow must move from session-aware server auth (`hooks.server.ts` + `users`/`sessions`) into DB-backed queries + API endpoints, rather than only localStorage.

## Integration Points

New feature code should plug into:

- UI component layer: add reusable disclosure component under `packages/praxrr-app/src/lib/client/ui` and apply it in section form components such as:
  - [packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/media-management/[databaseId]/media-settings/components/MediaSettingsForm.svelte)
  - [packages/praxrr-app/src/routes/quality-profiles/[databaseId]/components/GeneralForm.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/quality-profiles/[databaseId]/components/GeneralForm.svelte)
  - [packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/GeneralForm.svelte](/home/yandy/Projects/github.com/yandy-r/praxrr/packages/praxrr-app/src/routes/custom-formats/[databaseId]/components/GeneralForm.svelte)
- Preference persistence layer:
  - `src/lib/client/stores` (ephemeral/local UI preference patterns) for immediate toggle UX
  - `src/lib/server/db` + migrations + query modules for server-persisted, per-user preference by section
  - server route/actions (`+page.server.ts` or dedicated `/api/v1` endpoint) for save/load sync and reconciliation.
- Navigation and section context:
  - `src/lib/client/stores/navScope.ts` and layout files for deriving section identity so preference keys are per section.
- Route-level forms that currently rely on local preference patterns and need alignment:
  - media-management detail pages, quality-profile detail subsections, custom-format forms, and any future Arr settings pages.

## Key Dependencies

- SvelteKit + Svelte 5 for routing, server/client rendering, and form actions.
- Deno runtime for backend execution and native SQLite/Kysely integration.
- SQLite app DB (`praxrr.db`) + migration/query modules for persisted state.
- PCD entity and sync pipeline for domain data underlying media/quality/format pages.
- SvelteKit form/data APIs (`actions`, `load`, `fail`, `redirect`) for route mutation and validation.
- Tailwind CSS v4 utility styling and shared component conventions in `src/lib/client/ui`.

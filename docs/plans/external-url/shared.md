# External URL

Profilarr’s Arr instance model currently uses one canonical `url` for both backend Arr API traffic and user-facing "Open in" links, which breaks browser navigation in Docker/internal-network deployments. The feature integrates an optional `external_url` into the existing `arr_instances` contract while preserving `url` for all server communication (`arr/test`, library/release APIs, sync jobs, rename/upgrade flows). Data enters through the existing `InstanceForm` and SvelteKit create/update actions, then propagates through `arrInstancesQueries` and `[id]/+layout.server.ts` into list and library UI surfaces. Implementation should centralize one fallback resolver (`external_url || url`) for all Open-in entry points and keep Arr-type-specific data loading paths unchanged.

## Relevant Files

- `/src/lib/server/db/schema.sql`: Canonical app schema; `arr_instances` table definition and FK ecosystem.
- `/src/lib/server/db/queries/arrInstances.ts`: Arr instance CRUD/types; add `external_url` create/update/read handling.
- `/src/lib/server/db/migrations.ts`: Migration registry that must include new `external_url` migration.
- `/src/routes/arr/components/InstanceForm.svelte`: Shared new/edit form; add optional field and hidden submit plumbing.
- `/src/routes/arr/new/+page.server.ts`: Create action validation/persistence path for new instances.
- `/src/routes/arr/[id]/settings/+page.server.ts`: Update action for add/edit/clear external URL on existing instances.
- `/src/routes/arr/[id]/+layout.server.ts`: Instance loader feeding all nested Arr routes with row data.
- `/src/routes/arr/[id]/library/+page.svelte`: Library page Open-in handlers and row link base URL logic.
- `/src/routes/arr/[id]/library/components/LibraryActionBar.svelte`: Toolbar Open-in action uses resolved browser URL.
- `/src/routes/arr/views/TableView.svelte`: Arr list/table external-link action currently opens `instance.url`.
- `/src/routes/arr/views/CardView.svelte`: Arr card external-link action currently opens `instance.url`.
- `/src/routes/arr/test/+server.ts`: Connection test endpoint that must remain bound to canonical `url`.
- `/src/routes/api/v1/arr/library/+server.ts`: Server-side library fetch path using Arr clients and instance URL.
- `/src/lib/server/utils/arr/factory.ts`: Arr client construction from canonical instance connection fields.

## Relevant Tables

- `arr_instances`: Root Arr instance metadata table; add nullable `external_url` for browser link base.
- `arr_sync_media_management`: Instance-scoped sync configuration; still depends on canonical API URL behavior.
- `arr_sync_delay_profiles_config`: Instance-scoped delay profile sync settings linked by `instance_id`.
- `arr_database_namespaces`: Namespace mapping per instance/database pair; cascades from `arr_instances`.
- `arr_rename_settings`: Per-instance rename settings; confirms broad FK dependency on `arr_instances`.

## Relevant Patterns

**Query-Layer Source of Truth**: Extend Arr instance types and SQL in one place (`arrInstancesQueries`) and let route loaders consume the updated shape. Example: [`/src/lib/server/db/queries/arrInstances.ts`](/src/lib/server/db/queries/arrInstances.ts).

**SvelteKit Action Validation + PRG**: Parse/trim form data, return `fail(...)` on validation, and `redirect(303, ...)` on success for create/update flows. Example: [`/src/routes/arr/new/+page.server.ts`](/src/routes/arr/new/+page.server.ts).

**Layout-Propagated Instance Context**: Load instance once at `[id]` layout and reuse in child routes/components for consistent behavior updates. Example: [`/src/routes/arr/[id]/+layout.server.ts`](/src/routes/arr/[id]/+layout.server.ts).

**UI Fallback Resolver for Open Links**: Compute one browser target (`external_url || url`) and reuse for toolbar and row/card links. Example: [`/src/routes/arr/[id]/library/+page.svelte`](/src/routes/arr/[id]/library/+page.svelte).

**Canonical URL for Server Clients**: Keep backend Arr clients on `instance.url` regardless of browser override fields. Example: [`/src/lib/server/utils/arr/factory.ts`](/src/lib/server/utils/arr/factory.ts).

## Relevant Docs

**`/docs/plans/external-url/feature-spec.md`**: You _must_ read this when implementing requirements, scope boundaries, fallback semantics, and rollout decisions.

**`/docs/plans/external-url/research-technical.md`**: You _must_ read this when modifying schema/query/action/UI files and preserving server/client URL separation.

**`/docs/plans/external-url/research-ux.md`**: You _must_ read this when implementing field labeling, validation feedback, and Open-in consistency across surfaces.

**`/docs/ARCHITECTURE.md`**: You _must_ read this when touching Arr-instance-backed jobs, services, and shared data flow assumptions.

**`/docs/api/v1/paths/arr.yaml`**: You _must_ read this when adjusting library route interactions and ensuring API contract fidelity.

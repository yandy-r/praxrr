# Encrypted Key Storage

Encrypted key storage spans SvelteKit form actions, Arr env reconciliation, database query modules,
and every Arr client call path used by jobs and APIs. `arrInstancesQueries` is the persistence hub
today, while `createArrClient` is the runtime boundary where decrypted credentials are actually
needed. The feature should introduce encrypted credential persistence plus deterministic
fingerprints so duplicate detection and env sync behavior remain intact without plaintext
comparisons. Integration must preserve startup sequencing in `hooks.server.ts`, because migrations,
env reconciliation, and job initialization all touch Arr instance data early.

## Relevant Files

- /packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts: Core Arr persistence and
  duplicate/env lookup behavior.
- /packages/praxrr-app/src/lib/server/db/schema.sql: Current table contracts and foreign-key
  relationships.
- /packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts: Env-managed Arr reconciliation and
  matching logic.
- /packages/praxrr-app/src/routes/arr/new/+page.server.ts: New-instance action receiving raw API
  keys from UI.
- /packages/praxrr-app/src/routes/arr/[id]/settings/+page.server.ts: Update/delete action paths and
  source restrictions.
- /packages/praxrr-app/src/routes/arr/test/+server.ts: Transient connection test flow for submitted
  credentials.
- /packages/praxrr-app/src/lib/server/utils/arr/factory.ts: Arr client factory where runtime key
  usage is centralized.
- /packages/praxrr-app/src/lib/server/utils/arr/base.ts: Shared Arr client header/auth behavior.
- /packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts: Job entrypoint that loads instances
  and creates Arr clients.
- /packages/praxrr-app/src/lib/server/sync/processor.ts: Sync processor consuming Arr instances
  across sections.
- /packages/praxrr-app/src/routes/api/v1/arr/library/+server.ts: API route using enabled instances
  and client creation.
- /packages/praxrr-app/src/routes/api/v1/arr/releases/+server.ts: Release-search API path depending
  on Arr credentials.
- /packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts: Cleanup API path requiring Arr
  client auth.

## Relevant Tables

- `arr_instances`: Canonical Arr instance identity, source, and current API-key storage location.
- `upgrade_configs`: Per-instance upgrade settings, cascades from Arr instance lifecycle.
- `arr_sync_quality_profiles`: Per-instance quality profile sync configuration and scheduling state.
- `arr_sync_delay_profiles_config`: Per-instance delay profile sync schedule and trigger metadata.
- `arr_sync_media_management_config`: Per-instance media management sync settings.
- `arr_sync_metadata_profiles_config`: Per-instance metadata profile sync settings.
- `arr_database_namespaces`: Per-instance database namespace mapping for sync paths.
- `jobs`: Scheduled/queued job definitions including Arr workflows.
- `job_queue`: Pending and active job queue entries tied to handlers.
- `job_runs`: Runtime execution records for Arr job processing.
- `job_run_history`: Historical run outcomes and diagnostics.

## Relevant Patterns

**Queries Module Pattern**: Database access is centralized in typed `*Queries` modules; follow
[`packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts`](packages/praxrr-app/src/lib/server/db/queries/arrInstances.ts).

**Route Action Orchestration**: Server actions validate, call query helpers, and return
`fail`/`redirect`; follow
[`packages/praxrr-app/src/routes/arr/new/+page.server.ts`](packages/praxrr-app/src/routes/arr/new/+page.server.ts).

**Arr Client Factory Boundary**: All Arr HTTP calls flow through a factory, making it the
decrypt-at-use boundary; follow
[`packages/praxrr-app/src/lib/server/utils/arr/factory.ts`](packages/praxrr-app/src/lib/server/utils/arr/factory.ts).

**Env Reconciliation Pattern**: Env-provided instances are normalized and reconciled through one
service; follow
[`packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts`](packages/praxrr-app/src/lib/server/utils/arr/envInstances.ts).

## Relevant Docs

**`docs/plans/encrypted-key-storage/feature-spec.md`**: You _must_ read this when defining behavior,
contracts, and acceptance criteria.

**`docs/plans/encrypted-key-storage/research-technical.md`**: You _must_ read this when designing
encryption helpers, schema changes, and migration steps.

**`docs/plans/encrypted-key-storage/research-business.md`**: You _must_ read this when handling user
workflows, failures, and operational expectations.

**`docs/plans/encrypted-key-storage/research-external.md`**: You _must_ read this when choosing
master-key source and provider integration strategy.

**`docs/plans/encrypted-key-storage/research-recommendations.md`**: You _must_ read this when
sequencing rollout and risk controls.

**`docs/ARCHITECTURE.md`**: You _must_ read this when integrating with startup, auth, and server
subsystem boundaries.

**`docs/api/v1/paths/arr.yaml`**: You _must_ read this when touching Arr API endpoint behavior or
payload expectations.

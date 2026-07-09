# Transparent Automation Engine — Research (Issue #21)

Ground-truth map of existing code surfaces relevant to the Transparent Automation Engine
(`show its work`) feature. All paths are under `packages/praxrr-app/` unless noted.

## Issue intent

Issue #21 is a **design philosophy**: make automated operations self-explaining. Sub-goals:
operation explanations, decision logging, inline documentation, sync narration, error explanations.
Roadmap slot is P3 with the acceptance line: _Automated actions show inputs, decisions, outputs,
and failure reasons in user-facing language._

Key design constraints called out in the issue:

- Implementation approach is **structured records with human-readable templates**.
- **Verbose-mode toggle**: summary by default, full explanation on expand.
- **Sync narration must reuse the same diff data as sync preview** (do not recompute).
- Explanation templates are **versioned** alongside the features they describe.
- **Do not over-explain simple operations** — focus on decisions and trade-offs.
- Praxrr's PCD ops model is inherently auditable — surface that auditability.

## The load-bearing gap

The richest per-change decision data already exists in the **sync preview diff engine**, but the
**apply path throws that granularity away**:

- `src/lib/server/sync/preview/types.ts` defines `EntityChange` (`entityType`, `name`,
  `action: 'create' | 'update' | 'delete' | 'unchanged'`, `remoteId`, `fields`) and `FieldChange`
  (`field`, `type: 'added' | 'changed' | 'removed'`, `current`, `desired`). `current` is the live
  Arr value; `desired` is the PCD value. `SyncPreviewResult` aggregates per-section previews plus a
  `SyncPreviewSummary` (`totalCreates/Updates/Deletes/Unchanged`).
- `src/lib/server/sync/types.ts` `SyncResult` is counts-only (`success`, `itemsSynced`, `error`).
  The only apply-time narration today is a flat string assembled in
  `src/lib/server/jobs/handlers/arrSync.ts` and persisted to `job_run_history.output`.

There is **no shared `explanation` / `reason` / `narration` primitive** anywhere in the codebase.
`reason`-style fields exist only as localized enums (`DriftReason`, auth `loginAnalysis`,
`pcd_op_history.conflict_reason`, `cleanup` skip reasons). This confirms #21's foundation gap: a
reusable, versioned rendering layer over the records that already exist.

## Reusable inputs (do not rebuild these)

- **Preview diff engine** `src/lib/server/sync/preview/` (`orchestrator.ts`, `diff.ts`,
  `sectionDiffs.ts`, `store.ts`, `types.ts`). Entry: `generatePreview(input)`. Produces
  `EntityChange` / `FieldChange`. This is the single richest `what changed and why` surface.
- **Drift detection** `src/lib/server/sync/drift/` (#15, the freshest related feature and the
  pattern to mirror). `check.ts` `checkInstanceDrift` runs `generatePreview` and reuses
  `EntityChange.fields` verbatim, then classifies each change via `ACTION_CATEGORY`
  (`update → drift`, `create → missing`, `delete → unmanaged`). Pure cores `aggregateDrift` and
  `driftSignature` (FNV-1a hash) are separated from a never-throwing IO shell that takes injected
  `DriftCheckDeps`. `DriftEntityChange` = `EntityChange` + `section` + `category`.
- **Logger** `src/lib/server/utils/logger/logger.ts`. Already structured: `LogOptions` carries
  `meta` (arbitrary object) and `source`. File output is JSON. Meta is sanitized via
  `sanitizeLogMeta`.
- **Resolved config** `src/lib/server/pcd/resolved/*` — base/user/override layer breakdown (the
  `why` behind desired state); relevant to decision logging but not required for the first slice.

## Persistence precedent

There is **no general-purpose audit / activity / decisions table**. Each feature persists its own
history:

- Latest-state pattern: drift's `drift_instance_status` (one upserted row per instance, entity
  detail as a JSON `changes` blob). Migration `db/migrations/20260709_create_drift_tables.ts`.
- Append-only pattern: `job_run_history` (general job log) and per-feature `*_runs` tables
  (`upgrade_runs`, `rename_runs`, `startup_pull_runs`), plus `pcd_op_history`.

Migration convention is now **date-based** `YYYYMMDD_description.ts` with an integer `version`
matching the date. Registration is manual and three-step in `db/migrations.ts` (static import,
append to `loadMigrations()`, auto-sort). Query layers are co-located `xxxQueries` object literals in
`db/queries/`.

The first slice should prefer **pure derivation (no persistence)**: narration is computed from the
preview/drift records that are already stored. Persisted decision history is an explicit follow-up
that belongs with the Sync History / Audit Trail work (#17).

## API and contract-first

- Source of truth is the modular OpenAPI under `docs/api/v1/` (`openapi.yaml` +
  `paths/*.yaml` + `schemas/*.yaml`); the live route `routes/api/v1/openapi.json/+server.ts` serves
  `docs/api/v1/openapi.yaml` at runtime.
- The published bundle `packages/praxrr-api/openapi.json` (refs resolved) plus generated
  `packages/praxrr-api/types.ts` and app-side `src/lib/api/v1.d.ts` must be regenerated when the
  contract changes. `packages/praxrr-api/openapi.json` is prettier-gated.
- Route pattern: SvelteKit `+server.ts` exporting typed `RequestHandler`s returning `json(...)`.
  Drift routes (`routes/api/v1/drift/**`) are the freshest example (parse/validate id, 400/404/409/
  429/500 codes, delegate to a persist function plus a centralized response mapper in
  `drift/responses.ts`).

## Client UI surfaces

- **Sync preview UI** (primary operation-result surface) under
  `routes/arr/[id]/sync/components/` — `SyncPreviewPanel.svelte`, `SyncPreviewEntityDiff.svelte`
  (already renders `EntityChange` / `FieldChange`).
- **Drift dashboard** `routes/drift/+page.svelte` and `routes/drift/[instanceId]/+page.svelte`;
  shared `src/lib/client/ui/drift/DriftFieldDiff.svelte` and `driftStatus.ts` status→badge mapping.
- **Alert store** `src/lib/client/alerts/store.ts`: `alertStore.add(type, message, duration?)` with
  `AlertType = 'success' | 'error' | 'warning' | 'info'`.
- Conventions: Svelte 5 without runes (`onclick`, no `$state`/`$derived`), routes over modals,
  `$ui/*` components (`Card`, `Badge`, `EmptyState`).

## Testing conventions

- Deno's built-in runner (`Deno.test`) with `@std/assert` (`assert`, `assertEquals`, `assertExists`).
- Pure functions are tested directly with no DB. DB-backed tests use a `migratedTest` helper that
  swaps `config.setBasePath` to a temp dir, `db.close()` → `db.initialize()` → `runMigrations()`,
  runs, then restores and deletes the temp dir (see `src/tests/sync/drift/persist.test.ts`).
- IO is stubbed by dependency injection (e.g. `DriftCheckDeps`) rather than module mocking.

## CI gates that matter for this change

- `deno task check` (type-check server + client) via the `compatibility-app-check` job.
- `lint-docs`: `markdownlint-cli` + `prettier --check` over `**/*.{md,mdx,json,jsonc,yaml,yml}`.
  This covers these planning docs, `ROADMAP.md`, and any OpenAPI JSON/YAML.
- Deno unit tests are not CI-gated but are expected alongside the change and must pass locally.

## Cross-Arr policy

Never assume Radarr / Sonarr / Lidarr share semantics. Resolve behavior by explicit `arr_type`;
entity naming and field meaning are app-specific. Any narration templating must not hard-code
cross-Arr naming shortcuts and must be driven by the `entityType` / `arr_type` present on each record.

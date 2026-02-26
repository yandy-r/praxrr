# Integration Research: trash-guide-sync

## API Endpoints

### Existing Related Endpoints

- `POST /api/v1/pcd/import` – already validates portable entity payloads, deserializes into the
  specific entity writers, and writes base/user ops before the cache rebuild, so TRaSH-derived
  operations can piggyback on this flow when the JSON is transformed into portable PCD ops.
  (`packages/praxrr-app/src/routes/api/v1/pcd/import/+server.ts:1`)
- `POST /api/v1/arr/cleanup` – master route for scanning/executing namespace cleanup with Arr
  clients; the TRaSH sync will likely reuse the same `arr-instance` client creation pattern when
  checking Arr state before applying quality profiles or CFs.
  (`packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts:1`)
- `GET /api/v1/trash-guide/sources` – lists linked TRaSH Guide sources plus entity counts and sync
  metadata so the UI can show status cards per Arr-type source.
  (`docs/plans/trash-guide-sync/feature-spec.md:339`)
- `POST /api/v1/trash-guide/sources` – links a new TRaSH repository with arr type, score profile,
  and sync strategy metadata, mirroring the existing database linking workflow but scoped to the
  TRaSH adapter. (`docs/plans/trash-guide-sync/feature-spec.md:369`)
- `POST /api/v1/trash-guide/sources/:id/sync` +
  `GET /api/v1/trash-guide/sources/:id/entities/quality-profiles/score-profiles` – manual sync
  trigger plus browseable entities/score profiles for the selected source, providing the
  preview/selection data that downstream sync jobs will consume.
  (`docs/plans/trash-guide-sync/feature-spec.md:387` and
  `docs/plans/trash-guide-sync/feature-spec.md:423`)

### Route Organization

All API v1 routes live under `packages/praxrr-app/src/routes/api/v1/…` with feature folders per
domain (e.g., `/arr/cleanup/+server.ts`). The planned TRaSH layout follows the same pattern:
`routes/api/v1/trash-guide/sources/+server.ts` plus nested `[id]` folders for detail/sync/entity
endpoints to keep the handlers aligned with SvelteKit’s `+server.ts` conventions.
(`packages/praxrr-app/src/routes/api/v1/arr/cleanup/+server.ts:1` and
`docs/plans/trash-guide-sync/feature-spec.md:461`)

## Database

### Relevant Tables

- `database_instances` – stores each linked PCD repo, its sync strategy/conflict strategy metadata,
  and last sync timestamp; the TRaSH source will likely create a synthetic entry here so existing
  processors treat it like any other database.
  (`packages/praxrr-app/src/lib/server/db/schema.sql:278`)
- `arr_sync_quality_profiles` / `arr_sync_media_management` plus their `_config` tables – hold
  per-instance sync selections, triggers, cron schedules, and status flags; TRaSH sync selections
  will feed into these tables (or new `trash_guide_sync_*` joins) so the same scheduler/processor
  code can drive Arr updates. (`packages/praxrr-app/src/lib/server/db/schema.sql:458` and
  `packages/praxrr-app/src/lib/server/db/schema.sql:533`)
- `arr_database_namespaces` – keeps the namespace indices that make collision-free sync suffixes
  possible; any TRaSH “database” still needs an entry here for namespace isolation in the existing
  pipeline. (`packages/praxrr-app/src/lib/server/db/schema.sql:560`)
- `trash_guide_sources`, `trash_guide_sync_config`, `trash_guide_sync_selections`,
  `trash_guide_entity_cache` – metadata-only sources per arr type, per-instance trigger records,
  section/item selections, and cached JSON blobs bridged to PCD ops, including the
  `idx_trash_guide_entity_cache_type` index for efficient lookups.
  (`docs/plans/trash-guide-sync/research-technical.md:139` through
  `docs/plans/trash-guide-sync/research-technical.md:207`)

### Schema Details

`database_instances` enforces git metadata (UUID/local path, conflict strategy, sync strategy/auto
pull, last synced timestamp) and cascades to `pcd_ops`, so TRaSH sources can follow the same insert
path as real PCDs; its foreign keys and indexes (e.g., `idx_database_instances_uuid`) keep lookups
fast. (`packages/praxrr-app/src/lib/server/db/schema.sql:283` and
`packages/praxrr-app/src/lib/server/db/schema.sql:608`) `arr_sync_*` tables all reference
`arr_instances(id)` (and where applicable `database_instances(id)`) with triggers and cron fields
that drive the scheduler/processor state machine, so TRaSH-specific sync configs can piggyback on
those columns plus `sync_status`/`last_synced_at`.
(`packages/praxrr-app/src/lib/server/db/schema.sql:463`–`556`) The new TRaSH tables persist git
clone metadata, `trash_id` lookups, and cached JSON for change detection; each
`trash_guide_sync_config` row ties a `source_id` to an `instance_id` with `trigger`, `sync_status`,
and scheduling fields, while `trash_guide_sync_selections` stores section/item granularity similar
to `arr_sync_quality_profiles`.
(`docs/plans/trash-guide-sync/research-technical.md:139`–`docs/plans/trash-guide-sync/research-technical.md:207`)

## External Services

- The TRaSH Guides GitHub repo (`https://github.com/TRaSH-Guides/Guides`) is the source of truth:
  metadata.json drives discovery, docs/json/{radarr,sonarr} contains CF/quality/profile/naming files
  keyed by `trash_id`, and there are no git rate limits beyond GitHub’s defaults.
  (`docs/plans/trash-guide-sync/feature-spec.md:18`)
- Radarr v3 exposes quality profile, custom format, quality definition, naming, and media management
  endpoints under `/api/v3/...` with `X-Api-Key` auth; the TRaSH sync will push to the same
  endpoints via the existing syncers. (`docs/plans/trash-guide-sync/feature-spec.md:39`)
- Sonarr v3/v4 mirrors those endpoints (but only v4 has custom formats) and also requires
  `X-Api-Key`; the TRaSH importer must keep Radarr/Sonarr semantics separate per the Cross-Arr
  policy. (`docs/plans/trash-guide-sync/feature-spec.md:52`)

## Internal Services

- `PCDManager` orchestrates cloning/parsing/linking, triggers cache compilation, and calls
  `triggerSyncs` after new ops land, so the TrashGuide adapter can reuse the same lifecycle by
  recording metadata in `trash_guide_sources`/`database_instances` and then invoking `triggerSyncs`.
  (`packages/praxrr-app/src/lib/server/pcd/core/manager.ts:5`)
- `sync/processor.ts` evaluates scheduled configs, marks `sync_status`, and runs the registered
  section handlers (`qualityProfiles`, `delayProfiles`, etc.), which will continue to work if TRaSH
  data is compiled into a synthetic database cache.
  (`packages/praxrr-app/src/lib/server/sync/processor.ts:1`)
- `jobs/schedule.ts` schedules sync jobs (`arr.sync.*`, `pcd.sync`, etc.) via `jobQueueQueries` and
  will need a `scheduleTrashGuideSyncForSource()` hook plus the new `'trashguide.sync'` job type so
  the same dispatcher/timers fire the fetch/transform pipeline.
  (`packages/praxrr-app/src/lib/server/jobs/schedule.ts:1`)
- The new `TrashGuide` module files (`fetcher`, `parser`, `transformer`, `manager`, `cache`, plus
  query helpers) act as the internal service layer that pulls JSON, maps `trash_id` → PCD ops,
  caches parsed blobs, and feeds the existing job/sync framework.
  (`docs/plans/trash-guide-sync/feature-spec.md:444`)

## Configuration

- TRaSH linking uses well-known defaults (`https://github.com/TRaSH-Guides/Guides`, branch `master`)
  surfaced via the Database linking UI rather than environment variables, so users opt in per arr
  type. (`docs/plans/trash-guide-sync/feature-spec.md:486`)
- Core env vars for startup auto-link (`PRAXRR_DEFAULT_DB_URL`, `PRAXRR_DEFAULT_DB_BRANCH`,
  `PRAXRR_DEFAULT_DB_NAME`, schema overrides, backups of PAT/credentials, and the empty-string
  opt-out) remain governed by `CLAUDE.md:224`–`CLAUDE.md:238` and should remain untouched while
  TRaSH sources live in the UI flow. (`CLAUDE.md:224`)

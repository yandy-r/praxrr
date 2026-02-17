# Profilarr Architecture

## 1) Purpose & Audience

Profilarr manages configuration for Radarr, Sonarr, and Lidarr by syncing
curated configuration databases (PCDs) into Arr instances. It targets two
audiences:

- **End users** who link a database and sync it to their Arr instance, while
  keeping local tweaks.
- **Database developers** who build, test, and publish the configuration
  database itself.

The system is built around append‑only operations (ops) that can be replayed,
validated, and reviewed. The database is the source of truth; repo files are
exported when publishing.

## 1.5) Tech Stack

- **Runtime:** Deno 2.x
- **Web:** SvelteKit (Vite + adapter‑deno), Svelte 5 (no runes)
- **DB:** SQLite (app DB) + in‑memory cache for compiled PCD state
- **Query layer:** Kysely
- **UI:** Tailwind CSS
- **Parser:** C# microservice (optional for CF/profile testing)
- **SCM:** Git (PCD repos + export flow)

## 2) Glossary

- **Arr** — Radarr/Sonarr/Lidarr instances managed by Profilarr.
- **PCD** — “Profilarr Config Database”: the configuration dataset (custom
  formats, profiles, media settings) stored as ops.
- **Op** — An append‑only SQL operation (create/update/delete) applied to build
  the final configuration state.
- **Base ops** — Published operations that define the database’s canonical
  state. These are what gets pushed to repos.
- **Draft base ops** — Unpublished base ops used by developers while iterating.
- **User ops** — Local overrides stored in the user layer. These are never
  exported; they persist across syncs.
- **Schema layer** — SQL schema from `deps/schema/ops` applied before any ops.
- **Tweaks layer** — Optional SQL tweaks loaded from `tweaks/` (repo‑local).
- **Stable key** — A name/composite key used to identify entities without
  relying on auto‑IDs (e.g., `quality_profile_name`).
- **Value guard** — Old‑value checks in UPDATE/DELETE statements to detect
  upstream changes (guard mismatch ⇒ rowcount 0).
- **Compile** — Building an in‑memory cache by replaying all ops in order.
- **Exporter** — Planned process that materializes base ops into repo files and
  pushes to Git.
- **Parser service** — C# microservice that parses release titles for CF/
  profile testing.
- **Entity testing** — Quality profile evaluation against test entities and
  releases (TMDB + parsed titles).

## 3) Repo Map

Top‑level layout and where each subsystem lives.

**Server**

- `src/lib/server/pcd/` — PCD operations, compiler, cache, writer
- `src/lib/server/db/` — App DB (instances, settings, job queue, ops tables)
- `src/lib/server/sync/` — Sync logic to Arr instances
- `src/lib/server/jobs/` — Job queue, dispatcher, and handlers
- `src/lib/server/upgrades/` — Upgrade engine
- `src/lib/server/rename/` — Rename logic
- `src/lib/server/notifications/` — Notification delivery
- `src/lib/server/utils/` — Shared backend utilities

**Client**

- `src/lib/client/ui/` — UI components
- `src/lib/client/alerts/` — Global alerts
- `src/lib/client/stores/` — Svelte stores
- `src/lib/client/utils/` — Client helpers

**Shared**

- `src/lib/shared/` — Shared types and utilities

**Routes**

- `src/routes/**` — Feature routes
- `src/routes/api/v1/**` — Current API surface

**Services**

- `src/services/parser/` — C# parser microservice

**Docs**

- `docs/DEVELOPMENT.md` — release conventions

## 4) Data Stores

### App DB (profilarr.db)

The main SQLite database stores application state and all PCD ops. This
includes:

- Linked database instances and credentials
- Jobs, settings, notifications
- `pcd_ops` (base + user ops)
- `pcd_op_history` (op application history)

Foreign keys are enforced (`PRAGMA foreign_keys = ON`).

### PCD Ops Tables (in app DB)

- `pcd_ops` is the source of truth for configuration changes.
- Base ops and user ops live side‑by‑side; base drafts are staged before export.
- Ops include `metadata` and `desired_state` for review and UI.

### PCD Cache (in‑memory)

Each compile builds an in‑memory SQLite database by replaying ops in layer
order. This cache powers reads and validation. It is rebuilt after each write.

### Parser Cache

Parser/evaluation results are cached in SQLite to avoid re‑parsing release
titles and re‑evaluating conditions. Cache keys include parser version and
pattern hash.

## 5) App DB (profilarr.db)

### Location & Initialization

The app DB is a SQLite file (`profilarr.db`) managed by `DatabaseManager`
(`src/lib/server/db/db.ts`). On server startup (`src/hooks.server.ts`):

1. `config.init()` creates required paths.
2. `db.initialize()` opens SQLite, enables foreign keys, and configures WAL.
3. `runMigrations()` applies all pending migrations.

Key pragmas:

- `PRAGMA foreign_keys = ON`
- `PRAGMA journal_mode = WAL`
- `PRAGMA synchronous = NORMAL`

### Schema & Migrations

- **Source of truth:** migrations in `src/lib/server/db/migrations/*.ts`.
- **Runner:** `src/lib/server/db/migrations.ts`.
- Migrations are applied in order and recorded in the `migrations` table.
- Each migration has `version`, `name`, `up`, optional `down`, and optional
  `afterUp`.

`src/lib/server/db/schema.sql` is a **reference snapshot**, not a runtime schema
source. New schema changes should be introduced via a new migration and added to
`migrations.ts`.

### Queries

Query helpers live in `src/lib/server/db/queries/`. They wrap raw SQL access for
app state, PCD ops, and supporting data (settings, job queue, caches, etc.).

### PCD Ops in the App DB

PCD operations and history are persisted here:

- `pcd_ops` — base and user ops (DB‑first source of truth)
- `pcd_op_history` — per‑compile apply results

## 5.5) Future: Postgres

SQLite is currently the right fit: local‑first, low overhead, fast compile/cache
loops. A Postgres move would require:

- Replacing the DB access layer (driver + connection pooling)
- Adapting migrations to Postgres dialect
- Auditing raw SQL in `db/queries` for compatibility
- Deciding whether PCD cache remains SQLite (likely) or is re‑implemented

There is no active plan to migrate; it would be a scale or deployment decision.

## 6) PCD System (DB‑first)

Profilarr stores configuration changes as **ops** in the app DB and replays them
into an in‑memory cache. Repo files are imported into the DB; exporting back to
Git is a planned step.

### 6.1 Ops Storage (`pcd_ops`)

Ops live in `pcd_ops` with these key fields:

- `origin`: `base` or `user`
- `state`: `published`, `draft`, `superseded`, `dropped`, `orphaned`
- `source`: `repo`, `local`, or `import`
- `sql`: the compiled SQL
- `metadata` + `desired_state`: JSON for UI/review
- `sequence`: ordering for base drafts (higher than published)

### 6.2 Layer Order (Loader)

Ops are loaded in this order (`src/lib/server/pcd/ops/loadOps.ts`):

1. **Schema** (`deps/schema/ops`)
2. **Base** (published, then drafts)
3. **Tweaks** (`tweaks/`)
4. **User** (published)

### 6.3 Writer Pipeline

Write flow (`src/lib/server/pcd/ops/writer.ts`):

- Compile Kysely queries into SQL.
- Validate against the current cache (constraint checks, FK checks).
- Write to `pcd_ops` (base draft or user published).
- Recompile the cache.

Writers also attempt to **cancel‑out** no‑ops (e.g., delete of a just‑created
entity) without emitting redundant ops.

### 6.4 Cache Build

The cache (`src/lib/server/pcd/database/cache.ts`) is built in‑memory by
replaying all ops. It is used for:

- Reads (UI views)
- Validation for new ops
- Deterministic sync payloads

### 6.5 Guards & Metadata

Updates/deletes include **value guards** so upstream changes can be detected
(rowcount 0 ⇒ guard mismatch). Metadata includes stable keys and changed fields,
used for UI review and conflict resolution.

### 6.6 Op History

Each compile records a row in `pcd_op_history` with:

- `batch_id` (compile run)
- `status` (applied/skipped/error)
- `rowcount` and error details

This powers conflict visibility and audit trails.

### 6.7 Exporter (Planned)

Base drafts will be exported back to repo files for publishing. The exporter
will materialize SQL files, push to Git, and mark ops as `pushed` in the DB.

### 6.8 Schema + Manifest (PCD Spec)

The PCD schema is defined by the **schema PCD** (DDL only). Locally we keep a
reference snapshot at `docs/0.schema.sql`, and the canonical schema repo lives
at:

```
https://github.com/yandy-r/profilarr-schema
```

Every PCD repo includes a `pcd.json` manifest in its root. Key fields:

- `name`, `version`, `description`
- `dependencies` (must include `schema`)
- `profilarr.minimum_version`
- Optional: `arr_types`, `authors`, `license`, `repository`, `tags`, `links`

Example:

```json
{
  "name": "profilarr-db",
  "version": "2.1.35",
  "description": "Seraphys' OCD Playground",
  "arr_types": ["radarr", "sonarr", "whisparr"],
  "dependencies": { "schema": "^1.1.0" },
  "authors": [{ "name": "Yandy-R", "email": "yandy-r@yandy-r.github.io" }],
  "license": "MIT",
  "repository": "https://github.com/yandy-r/profilarr-db",
  "tags": ["4k", "hdr", "remux", "quality", "archival"],
  "links": {
    "homepage": "https://github.com/yandy-r/profilarr-db",
    "issues": "https://github.com/yandy-r/profilarr-db/issues"
  },
  "profilarr": { "minimum_version": "2.0.0" }
}
```

Repository layout:

```
my-pcd/
├── pcd.json
├── ops/
│   ├── 1.create-1080p-Efficient.sql
└── tweaks/
    ├── allow-DV-no-fallback.sql
    └── ban-megusta.sql
```

Schema PCD layout:

```
schema-pcd/
├── pcd.json
└── ops/
    └── 0.schema.sql
```

## 7) Sync System

Profilarr syncs compiled configuration into Arr instances. The sync pipeline:

1. **Read compiled state** from the PCD cache.
2. **Transform** into Arr API payloads.
3. **Push** changes via Arr clients.
4. **Record** sync outcomes (job logs / status).

Key files:

- `src/lib/server/sync/**` — Sync orchestration and per‑entity syncers
- `src/lib/server/utils/arr/**` — Arr HTTP clients + payload types
- `src/routes/arr/**` — UI and configuration for sync strategies

Sync strategies include manual and scheduled runs. Dependencies (e.g., custom
formats referenced by profiles) are synced first.

## 8) Parser Service

Profilarr uses a C# parser microservice to extract structured metadata from
release titles (resolution, source, flags, languages, release group, etc.). This
powers custom format matching and quality profile testing.

**Location:** `src/services/parser/`

**Key pieces:**

- Parsers and models in `src/services/parser/Parsers` and `Models`
- API endpoints in `src/services/parser/Endpoints`

**Client & cache:**

- Client lives under `src/lib/server/utils/arr/parser/`
- Results are cached in SQLite with keys that include parser version

**Why separate service?**

- Keeps heavy parsing logic out of the web server
- Mirrors Arr parsing behavior more closely (via .NET regex)

This service is optional in dev; features depending on parsing will show
warnings when it’s offline.

## 9) Entity Testing (Quality Profiles)

Entity testing lets you validate **quality profile scoring** against real
examples. You add a movie/series (TMDB), attach synthetic or imported releases,
then evaluate custom‑format matches and final scores.

**UI route:** `src/routes/quality-profiles/entity-testing/[databaseId]`

### 9.1 Data Model (PCD Tables)

Entity tests are stored in the PCD schema tables:

- `test_entities` — key = `(type, tmdb_id)` (movie/series)
- `test_releases` — key = `(entity_type, entity_tmdb_id, title)` plus an `id`

Releases store JSON arrays for `languages`, `indexers`, and `flags` alongside
`size_bytes` and the raw `title`.

### 9.2 CRUD Ops

Entity testing ops live in
`src/lib/server/pcd/entities/qualityProfiles/entityTests/`:

- **Create entities:** bulk insert; skips duplicates by `(type, tmdb_id)`.
- **Delete entity:** deletes releases first, then deletes entity with value
  guards.
- **Create releases:** single or bulk insert; bulk skips duplicate titles per
  entity.
- **Update/delete releases:** guarded by title/size/languages/indexers/flags.

Ops can target **base** or **user** layers depending on whether the database has
base write access.

### 9.3 Evaluation Flow

Evaluation is driven by the API endpoint:
`src/routes/api/v1/entity-testing/evaluate/+server.ts`.

1. **Parse releases** in batch via the parser service (cached).
2. **Extract patterns** from all custom format conditions.
3. **Match patterns** against release titles in batch.
4. **Evaluate CFs** per release and return match results.

The UI then computes profile scores using `allCfScores()` from
`src/lib/server/pcd/entities/qualityProfiles/scoring/read.ts`. If the parser is
offline, the endpoint returns `parserAvailable: false` and skips CF matching.

### 9.4 Inputs

Entity tests are created in three ways:

- **TMDB search** (adds test entities)
- **Manual release entry** (title + size + languages/indexers/flags)
- **Import from Arr** (pulls recent releases via configured Arr instances)

## 10) Custom Formats

Custom formats (CFs) define **match logic** (conditions) and optional **tests**
used for quality profile scoring and entity testing.

**UI routes:** `src/routes/custom-formats/**`

### 10.1 Data Model

Key tables:

- `custom_formats` — name, description, `include_in_rename`
- `custom_format_conditions` — base condition rows
- Type tables: `condition_patterns`, `condition_languages`, `condition_sources`,
  `condition_resolutions`, `condition_quality_modifiers`,
  `condition_release_types`, `condition_indexer_flags`, `condition_sizes`,
  `condition_years`
- `custom_format_tests` — per‑format test cases
- `tags` + `custom_format_tags` — tagging
- `regular_expressions` — referenced by `condition_patterns`

### 10.2 General (Name/Description/Tags)

Server logic lives under `src/lib/server/pcd/entities/customFormats/general/`:

- **Create:** inserts `custom_formats`, inserts tags (if missing), links tags.
- **Update:** guarded updates on name/description/include_in_rename; handles tag
  adds/removals; prevents duplicate names (case‑insensitive).
- **Delete:** deletes the format; FKs cascade to tags, conditions, and tests.

### 10.3 Conditions

Conditions are edited as a single operation:
`src/lib/server/pcd/entities/customFormats/conditions/update.ts`.

Flow:

1. Validate unique condition names (case‑insensitive).
2. Enforce **single value** for single‑select types (e.g., source, language).
3. Delete removed conditions (cascade clears type tables).
4. Insert new conditions + type‑specific rows.
5. Update existing conditions (base fields + type‑specific rows).

Read helpers (`conditions/read.ts`) support:

- Single‑format evaluation
- Batch evaluation (all formats)
- Lightweight list views

### 10.4 Tests & Evaluation

Tests live in `src/lib/server/pcd/entities/customFormats/tests/`:

- Create/update/delete with value guards
- Uniqueness enforced per `(custom_format_name, title, type)` (case‑insensitive)

Evaluation lives in `customFormats/evaluator.ts`:

- Extracts regex patterns from conditions
- Uses parser output to evaluate each condition type
- Produces match info for entity testing and CF previews

Parser‑dependent evaluation is used by the **entity testing** API to compute CF
matches and scoring.

## 11) Quality Profiles

Quality profiles define **quality ordering**, **upgrade rules**, and **custom
format scores**. They’re the bridge between CF matching and final decisions.

**UI routes:** `src/routes/quality-profiles/**`

### 11.1 Data Model

Core tables:

- `quality_profiles` — name, description, upgrade flags and thresholds
- `quality_profile_tags` + `tags`
- `quality_profile_languages` — language selection (currently “simple”)
- `quality_profile_qualities` — ordered list of qualities/groups
- `quality_groups` + `quality_group_members` — group definitions
- `quality_profile_custom_formats` — CF scores per `arr_type`
- Reference tables: `qualities`, `languages`, `custom_formats`

### 11.2 General (Name/Description/Tags/Language)

Server logic lives under `src/lib/server/pcd/entities/qualityProfiles/general/`:

- **Create:** inserts profile with defaults; tags; seeds all qualities as
  enabled; inserts a single “simple” language if selected.
- **Update:** guarded updates on name/description; handles tag adds/removals and
  language changes; prevents duplicate names (case‑insensitive).

### 11.3 Qualities (Ordering + Groups)

Qualities are edited as a single all‑or‑nothing operation:
`src/lib/server/pcd/entities/qualityProfiles/qualities/update.ts`.

Flow:

1. Validate only one item is marked `upgrade_until`.
2. Delete all existing `quality_profile_qualities`, `quality_group_members`, and
   `quality_groups` with value guards.
3. Re‑insert groups, group members, and ordered items.

This ensures deterministic ordering and group membership. The UI exposes both
individual qualities and quality groups in the ordered list.

### 11.4 Scoring (Profile Settings + CF Scores)

Scoring updates live in `scoring/update.ts`:

- Profile‑level settings: `minimum_custom_format_score`, `upgrade_until_score`,
  `upgrade_score_increment` (guarded).
- CF scores per `arr_type` (`all`, `radarr`, `sonarr`).
  - **Insert** when a score is newly set.
  - **Delete** when a score is cleared.
  - **Update** when a score changes (guarded).

Reads (`scoring/read.ts`) fall back to `arr_type = 'all'` when no type‑specific
score exists.

### 11.5 Delete

Deleting a profile explicitly removes: tags, languages, qualities, groups, and
CF scores, then the profile row itself. Metadata includes counts for each
category.

## 12) Media Management

Media management configs are stored as **named presets** for Radarr, Sonarr,
and Lidarr: Naming, Media Settings, and Quality Definitions. Each Arr app has
dedicated tables and entity operations; there is no cross‑Arr table reuse or
fallback behavior. Each preset is a distinct entity with its own CRUD ops and
value guards.

**UI routes:** `src/routes/media-management/**`

### 12.1 Naming

Tables:

- `radarr_naming`
- `sonarr_naming`
- `lidarr_naming`

Ops live in `src/lib/server/pcd/entities/mediaManagement/naming/`:

- **Create:** insert a new named config (case‑insensitive name check).
- **Update:** guarded update; supports rename with collision checks.
- **Delete:** guarded delete using all fields as value guards.

Each Arr variant stores format strings and flags specific to its domain.
Radarr uses movie formats; Sonarr uses episode/season formats; Lidarr uses
artist/album/track formats.

### 12.2 Media Settings

Tables:

- `radarr_media_settings`
- `sonarr_media_settings`
- `lidarr_media_settings`

Ops live in `mediaManagement/media-settings/`:

- **Create:** insert named config (case‑insensitive name check).
- **Update:** guarded update; supports rename with collision checks.
- **Delete:** guarded delete.

Settings currently include `propers_repacks` and `enable_media_info`.

### 12.3 Quality Definitions

Tables:

- `radarr_quality_definitions`
- `sonarr_quality_definitions`
- `lidarr_quality_definitions`

Ops live in `mediaManagement/quality-definitions/`:

- **Create:** insert all entries for a named config (requires unique
  `quality_name` per config).
- **Update:** delete all current entries (guarded), then insert new set.
- **Delete:** delete all entries for the named config (guarded).

Quality definitions are list‑style configs; updates are applied as a full
replace to keep ordering and sizes consistent. Lidarr quality definitions
use Lidarr‑native quality names (e.g., "FLAC", "MP3‑320", "ALAC") resolved
through `quality_api_mappings` with `arr_type = 'lidarr'`.

### 12.4 Lidarr Migration

Lidarr entities were promoted from Sonarr‑backed reuse to first‑class tables.
Existing installations are migrated automatically via PCD base‑op migrations
that copy legacy rows, normalize names, and seed Lidarr‑native defaults. See
[migration runbook](plans/enhance-lidarr-support/migration-runbook.md) for
operator steps and rollback procedures.

## 13) Regular Expressions

Regular expressions are reusable patterns referenced by custom format
conditions. They are first‑class, tagged entities with full CRUD support.

**UI routes:** `src/routes/regular-expressions/**`

### 13.1 Data Model

- `regular_expressions` — name, pattern, optional description, optional regex101
  id
- `regular_expression_tags` + `tags` — tagging

### 13.2 CRUD Ops

Ops live in `src/lib/server/pcd/entities/regularExpressions/`:

- **Create:** insert regex; insert tags + link; rejects duplicate names
  (case‑insensitive).
- **Update:** guarded updates on name/pattern/description/regex101 id; tag
  adds/removals; rename collision checks.
- **Delete:** removes tag links then deletes regex with value guards.

Regular expressions are referenced by `condition_patterns` in custom format
conditions, so updates can affect CF evaluation and testing.

## 14) Delay Profiles

Delay profiles control **release delay rules** (torrent/usenet) and optional
minimum CF score gates.

**UI routes:** `src/routes/delay-profiles/**`

### 14.1 Data Model

- `delay_profiles` — name, preferred protocol, delays, bypass rules, min score

### 14.2 CRUD Ops

Ops live in `src/lib/server/pcd/entities/delayProfiles/`:

- **Create:** insert with protocol‑aware constraints:
  - `only_torrent` ⇒ `usenet_delay` is NULL
  - `only_usenet` ⇒ `torrent_delay` is NULL
  - `bypass_if_above_custom_format_score = false` ⇒ min score is NULL
- **Update:** guarded update with the same constraint logic.
- **Delete:** guarded delete across all fields.

Name uniqueness is enforced case‑insensitively on create/rename.

## 15) Rename System

Rename is a **server‑side job** that scans Arr libraries and issues rename
commands when files/folders don’t match the current naming config.

**UI route:** `src/routes/arr/[id]/rename`

### 15.1 Flow

Core logic lives in `src/lib/server/rename/`:

- **processor.ts** orchestrates Radarr/Sonarr runs.
- **logger.ts** records structured logs and persists runs.

Processing steps:

1. Fetch library + tags.
2. Filter items by ignore tag.
3. Request rename previews from Arr.
4. If dry‑run: record results only.
5. If live: trigger rename commands; optionally rename folders + refresh.

### 15.2 Settings & History

Settings are stored in the app DB via `arrRenameSettingsQueries` and include:
`enabled`, `dryRun`, `renameFolders`, `ignoreTag`, `schedule`,
`summaryNotifications`.

Run history is stored via `renameRunsQueries` and shown in the UI. Each run
records counts, timing, errors, and a list of renamed items.

### 15.3 Notifications

Rename runs can emit notifications (e.g., Discord) based on status:
`rename.success`, `rename.partial`, `rename.failed`. Summary vs detailed mode is
driven by the per‑instance settings.

## 16) Jobs

Profilarr uses an event‑driven **job queue** for background tasks (syncing,
renames, upgrades, log cleanup, backups). Jobs are queued when configuration
changes or events occur. Scheduled jobs are represented by a single queue row
that reschedules itself after each run.

### 16.1 Core Components

- **Dispatcher:** `src/lib/server/jobs/dispatcher.ts` — wakes on the earliest
  due job, claims it, and executes the handler.
- **Registry:** `src/lib/server/jobs/queueRegistry.ts` +
  `src/lib/server/jobs/handlers/**` — maps job types to handlers.
- **Scheduler:** `src/lib/server/jobs/schedule.ts` — creates/updates scheduled
  queue rows from config.
- **Queue helpers:** `src/lib/server/db/queries/jobQueue.ts`,
  `src/lib/server/db/queries/jobRunHistory.ts`,
  `src/lib/server/jobs/queueService.ts`.
- **Initializer:** `src/lib/server/jobs/init.ts` — recovers running jobs,
  schedules all jobs, and starts the dispatcher.

### 16.2 Storage

Jobs are persisted in SQLite:

- `job_queue` — scheduled and manual job instances (`run_at`, `payload`,
  `status`, `dedupe_key`, `cooldown_until`).
- `job_run_history` — per‑run history (status, duration, error/output).

`jobs` and `job_runs` are deprecated and kept for one release before removal.

Queries: `src/lib/server/db/queries/jobQueue.ts`,
`src/lib/server/db/queries/jobRunHistory.ts`.

### 16.3 Job Types

- `arr.sync` — per Arr instance; runs all configured sections in order.
- `arr.rename` — per Arr instance.
- `arr.upgrade` — per Arr instance; hard cooldown enforced.
- `pcd.sync` — per database instance; respects `sync_strategy` and `auto_pull`.
- `backup.create`, `backup.cleanup`, `logs.cleanup`.

### 16.4 Lifecycle

1. Scheduled configs call `schedule*` to upsert a deduped queue row.
2. Manual runs enqueue one‑off rows (or “Run now” sets `run_at` to now).
3. Dispatcher claims the next due job, executes the handler, records history.
4. Scheduled jobs reschedule via `rescheduleAt`; manual jobs finish.

### 16.5 UI & Manual Triggers

Jobs are managed in **Settings → Jobs** (`src/routes/settings/jobs/**`). “Run
now” sets the queue row’s `run_at` to the current time and wakes the dispatcher.
Manual upgrades remain dry‑run only and respect cooldowns.

## 17) Notifications

Profilarr ships a **pluggable notification system** with a central manager,
service definitions, and delivery history.

**UI routes:** `src/routes/settings/notifications/**`

### 17.1 Core Components

- **Manager:** `src/lib/server/notifications/NotificationManager.ts` —
  dispatches notifications to enabled services and records history.
- **Builder:** `src/lib/server/notifications/builder.ts` — fluent API for
  constructing notifications.
- **Definitions:** `src/lib/server/notifications/definitions/**` — reusable
  notification builders (rename, upgrade, test).

### 17.2 Notifiers

Notifiers live under `src/lib/server/notifications/notifiers/`:

- **Discord** is currently implemented (webhook + embed builder).
- The `BaseHttpNotifier` + shared webhook client (`base/webhookClient.ts`)
  handle rate limiting and HTTP dispatch.

### 17.3 Storage

Notifications are stored in SQLite:

- `notification_services` — configured destinations + enabled types
- `notification_history` — delivery history (status, error, metadata)

Queries: `notificationServicesQueries` and `notificationHistoryQueries`.

### 17.4 Types

`src/lib/server/notifications/types.ts` defines:

- Notification type IDs
- Service config shape (Discord today)
- Payload structure (generic + Discord‑specific)

### 17.5 Future Services + Notification Suite

Potential notifier targets:

- Ntfy
- Telegram
- Apprise (fan‑out gateway)
- Email (SMTP)
- Slack
- Pushover / Gotify
- Pushbullet
- Web Push
- Generic Webhooks
- Arr ecosystem clients (LunaSea, NZB360, Helmarr, RuDarr)

Potential notification suite to standardize:

- **PCD lifecycle:** linked/unlinked, updates available, sync success/failure
- **Sync jobs:** per‑instance sync success/failure + partials
- **Rename jobs:** success/partial/failed (already)
- **Upgrade jobs:** success/partial/failed (already)
- **Health:** failing jobs, parser offline, repo auth errors

## 18) Upgrades

The upgrade system automates **manual search + upgrade selection** for Radarr.
It evaluates filters against library items, then triggers searches for selected
items on a schedule.

**UI route:** `src/routes/arr/[id]/upgrades`

### 18.1 Config & Scheduling

Upgrade configs are stored per instance in `upgrade_configs`:

- `enabled`, `dry_run`, `schedule` (minutes)
- `filter_mode` (`round_robin` or `random`)
- `filters` JSON + `current_filter_index`

Queries live in `src/lib/server/db/queries/upgradeConfigs.ts`. The job system
polls for **due configs** (based on `last_run_at` + schedule).

### 18.2 Processing Pipeline

Core logic lives in `src/lib/server/upgrades/processor.ts`:

1. Fetch Radarr library + profiles + movie files.
2. Normalize items for filter evaluation (`normalize.ts`).
3. Apply filter rules (`shared/upgrades/filters`).
4. Apply filter‑level cooldown tags (`cooldown.ts`).
5. Select items via selector (oldest/newest/random/lowest score).
6. Trigger interactive searches (dry‑run) or live searches.
7. Record a structured run log + optional notification.

### 18.3 Cooldown & Dry‑Run

- **Cooldown:** items are tagged with `profilarr-{filter}` so filters only
  re‑search after the pool is exhausted (tags reset).
- **Dry‑run cache:** prevents repeated dry‑run selections within a TTL.

### 18.4 Storage & History

Run history is stored in `upgrade_runs` and shown in the UI. Logs include filter
funnel counts, selected items, score deltas, and errors.

### 18.5 Notifications

Upgrade runs emit notifications (success/partial/failed) when enabled.

## 19) Auth & Security

Profilarr supports local auth, OIDC, API keys, and session management. The
primary flow is enforced in `src/hooks.server.ts` via the auth middleware.

**Auth module:** `src/lib/server/utils/auth/`

### 19.1 Auth Modes

Controlled by `AUTH` env:

- `on` (default): username/password login + sessions
- `local`: skip auth for local IPs
- `off`: trust external proxy (no auth checks)
- `oidc`: OIDC login (no local password required)

Details and flow diagrams live in `src/lib/server/utils/auth/README.md`.

### 19.2 Session & API Key

- **Session cookie:** `session` (httpOnly, sameSite=lax).
- **Sliding expiration:** sessions extend when past halfway.
- **API key:** `X-Api-Key` header or `apikey` query param.

Session and API key settings are stored in `auth_settings` and `sessions`
tables, managed via `authSettingsQueries` and `sessionsQueries`.

### 19.3 OIDC

OIDC flow lives in `src/routes/auth/oidc/*` and `auth/oidc.ts`:

- Discovery + token exchange
- ID token decode + basic verification
- Session created after successful login

### 19.4 Routes

Auth and security routes:

- `/auth/setup`, `/auth/login`, `/auth/logout`
- `/auth/oidc/login`, `/auth/oidc/callback`
- `/settings/security` (password, API key, sessions)

### 19.5 Data Model

- `users` — single local admin (OIDC users stored as `oidc:<sub>`)
- `sessions` — multi‑session support + metadata
- `auth_settings` — session duration + API key (singleton)

## 20) Frontend Architecture

The client UI library lives under `src/lib/client/ui/` and provides reusable
Svelte components grouped by purpose. Styling is Tailwind‑first with
component‑local class composition.

### 20.1 UI Library Inventory

**Actions (`ui/actions/`)**

- `ActionsBar.svelte` — horizontal button grouping with shared borders/rounding.
- `ActionButton.svelte` — icon button with optional hover dropdown.
- `SearchAction.svelte` — search input with responsive modal for mobile.
- `ViewToggle.svelte` — “cards vs table” dropdown toggle.

**Arr (`ui/arr/`)**

- `Score.svelte` — score display with sign/color.
- `CustomFormatBadge.svelte` — label + score pill.

**Badge (`ui/badge/`)**

- `Badge.svelte` — status/label pill with variants + mono option.

**Button (`ui/button/`)**

- `Button.svelte` — primary/secondary/danger/ghost, icon support, responsive
  size.

**Card (`ui/card/`)**

- `StickyCard.svelte` — sticky header/footer card with blur/transparent
  variants.

**Dropdown (`ui/dropdown/`)**

- `Dropdown.svelte` — positioning + fixed mode for overflow containers.
- `DropdownItem.svelte` — selectable row with optional icon/danger/selected.
- `DropdownSelect.svelte` — button‑style select with dropdown list.
- `CustomGroupManager.svelte` — add/remove custom groups (tags UI).

**Form (`ui/form/`)**

- `FormInput.svelte` — labeled field wrapper (inputs/textarea + password
  toggle).
- `Input.svelte` — compact inline input (responsive support).
- `NumberInput.svelte` — numeric input w/ custom steppers + min/max blockers.
- `Select.svelte` — custom select with keyboard nav.
- `Autocomplete.svelte` — searchable dropdown select (single/multi).
- `MarkdownInput.svelte` — markdown editor + preview + toolbar.
- `TagInput.svelte` — tag entry with chips + duplicate guard.
- `RangeScale.svelte` — draggable multi‑marker scale.
- `KeyValueList.svelte` — editable key/value grid (version or text mode).
- `IconCheckbox.svelte` — icon‑based checkbox with color variants.

**Meta (`ui/meta/`)**

- `JsonView.svelte` — JSON/SQL syntax highlighting for metadata blocks.

**Modal (`ui/modal/`)**

- `Modal.svelte` — confirm/alert modal with header/body/footer.
- `InfoModal.svelte` — lightweight info dialog.
- `DirtyModal.svelte` — unsaved‑changes guard (hooks into dirty store).

**Navigation (`ui/navigation/`)**

- `navbar/*` — top bar, theme toggle, accent picker.
- `pageNav/*` — left sidebar groups + version block.
- `bottomNav/BottomNav.svelte` — mobile nav bar.
- `tabs/Tabs.svelte` — tabs + breadcrumbs/back button.

**State (`ui/state/`)**

- `EmptyState.svelte` — empty list CTA template.

**Table (`ui/table/`)**

- `Table.svelte` — sortable table with responsive card layout.
- `ExpandableTable.svelte` — expandable rows + sorting + responsive cards.
- `TableActionButton.svelte` — small icon button for row actions.
- `ReorderableList.svelte` — drag‑to‑reorder list.

**Toggle (`ui/toggle/`)**

- `Toggle.svelte` — two‑state switch with color variants.

### 20.2 Candidate Cleanups / Componentization

**Unify responsive breakpoints**

- Many components duplicate `matchMedia` logic (Button, Table, ExpandableTable,
  SearchAction, Tabs).
- Consider a shared `useMediaQuery` action or store.

**Consolidate selection inputs**

- `Select`, `DropdownSelect`, and `Autocomplete` overlap.
- Consider a single “Select” component with search/compact/responsive modes.

**Standardize icon buttons**

- `ActionButton` and `TableActionButton` share patterns.
- Consider a single `IconButton` base with size/variant props.

**Form field consistency**

- `FormInput` handles labels/descriptions, but other inputs don’t.
- Consider a `FormField` wrapper for label/help/error slots.

**Modal variants**

- `Modal` and `InfoModal` share layout logic.
- Consider a single modal with variant props and slot‑only body.

**Table components**

- `Table` and `ExpandableTable` duplicate sorting + responsive layouts.
- Potential shared table core + “expandable” extension.

**Color/variant mappings**

- `IconCheckbox` and `Toggle` embed many variant class branches.
- Consider a shared palette map (centralized colors).

## 21) Utilities & Core Services

Shared backend utilities live under `src/lib/server/utils/` and are consumed
across PCD, sync, jobs, and routes. Cross‑runtime helpers live in
`src/lib/shared/utils/`.

### 21.1 Logger

- `utils/logger/logger.ts` — colored console + JSON file logs with daily
  rotation.
- Log settings are stored in SQLite (`log_settings`) and read at runtime
  (`logSettings`).
- `utils/logger/reader.ts` powers the log viewer UI (filter + parse).
- `utils/logger/startup.ts` prints the ASCII banner and environment summary.

### 21.2 Config & Paths

`utils/config/config.ts` defines a singleton config that:

- Reads env (`APP_BASE_PATH`, `PORT`, `HOST`, `AUTH`, `PARSER_*`, `OIDC_*`).
- Resolves app paths (`config.paths.*`) for logs/data/backups/databases.
- `config.init()` ensures core directories exist before startup.

### 21.3 HTTP Client (OOP Base)

The shared HTTP stack lives in `utils/http/`:

- `BaseHttpClient` handles pooling, timeouts, retries/backoff, and JSON parsing.
- `HttpError` standardizes failures with status + response payload.
- This base client is extended by Arr, parser, TMDB, and AI clients.

### 21.4 Arr Client Layer

Arr integration is an object‑oriented stack:

- `utils/arr/base.ts` extends `BaseHttpClient` and injects API key handling.
- `utils/arr/clients/*` implement app‑specific endpoints (Radarr, Sonarr, Lidarr).
- `createArrClient()` selects a client by type.
- `utils/arr/defaults.ts` provides default delay profiles.
- `utils/arr/releaseImport.ts` normalizes + groups releases for entity testing.
- `utils/arr/parser/*` wraps the C# parser service (see Parser Service).

### 21.5 Git & GitHub Helpers

- `utils/git/*` wraps local repo operations (status, diff, commits, ops files).
- `utils/github/cache.ts` caches repo metadata + avatars in the app DB with TTL.

### 21.6 Markdown

`utils/markdown/markdown.ts` renders markdown to sanitized HTML and provides a
plain‑text `stripMarkdown()` helper for previews.

### 21.7 TMDB

`utils/tmdb/client.ts` calls TMDB search endpoints and validates API keys using
the shared HTTP client.

### 21.8 AI Client

`utils/ai/client.ts` talks to OpenAI‑compatible APIs and can generate commit
message suggestions for ops (optional, settings‑gated).

### 21.9 Cache & Shared Helpers

- `utils/cache/cache.ts` is a simple in‑memory TTL cache.
- `shared/utils/*` covers UUIDs, SQLite timestamp normalization, and semver
  helpers.
- `client/utils/*` includes small UI helpers (e.g., `clickOutside`, `regex101`).

## 22) Scripts & Tooling

Project scripts live under `scripts/` and are run via `deno task` or directly.

### 22.1 Dev Workflow

- `scripts/dev.ts` runs the **parser + server** concurrently with colored logs.
  It sets dev env vars (APP_BASE_PATH, PARSER_HOST, VITE_CHANNEL, etc.).

### 22.2 Schema / Type Generation

- `scripts/generate-pcd-types.ts` pulls the schema SQL (GitHub or local) and
  generates `src/lib/shared/pcd/types.ts` via SQLite introspection.

### 22.3 Validation Utilities

- `scripts/validate-condition-values.ts` validates condition values in SQL
  against the enum sets in `shared/pcd`.

### 22.4 Tests

- `scripts/test.ts` is a test runner wrapper with alias support (filters,
  upgrades, jobs, logger).

### 22.5 Codebase Stats

- `scripts/stats.sh` runs `scc` over the repo and prints per‑module stats.

## 23) API v1

The current API surface lives under `src/routes/api/v1/` and is the target for
all future API work. Legacy routes outside `/api/v1` should be migrated into
this namespace and then removed.

### 23.1 Contract‑First Workflow

Preferred flow:

1. **Define OpenAPI first** (paths, schemas, auth, error shapes).
2. **Generate types** from the spec (client + server types).
3. **Implement handlers** to match the contract.

This keeps request/response contracts stable and minimizes drift between UI, API
consumers, and backend code.

### 23.2 Documentation

We should publish API docs from the OpenAPI spec. Options to consider:

- **Custom docs site** (TMDB‑style: rich examples + narrative guides)
- **ReadMe** (readme.com) for hosted API docs + changelogs + SDK guides
- **Scalar** or **Stoplight Elements** for a polished interactive UI
- **Redoc** / **Swagger UI** for a quick, low‑maintenance option
- **Docusaurus** + OpenAPI plugin if we want a full docs portal

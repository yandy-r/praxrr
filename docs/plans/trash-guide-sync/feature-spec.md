# Feature Spec: TRaSH Guide Sync

## Executive Summary

TRaSH Guide Sync imports and auto-synchronizes TRaSH Guides-recommended custom formats, quality
profiles, quality definitions, and naming conventions into Radarr/Sonarr instances. TRaSH JSON data
routes through the existing PCD ops pipeline as a virtual database instance, reusing conflict
resolution, value-guard validation, cache compilation, preview, and multi-instance sync. This
PCD-first approach maximizes code reuse (~80% exists) while delivering advantages over
Recyclarr/Configarr: visual diff previews, layered user overrides, selective entity tracking, and
multi-database composition. The main new work is the transformer mapping TRaSH JSON schemas into
PCD-compatible SQL operations.

## External Dependencies

### APIs and Services

#### TRaSH Guides Repository

- **Repository**: [TRaSH-Guides/Guides](https://github.com/TRaSH-Guides/Guides)
- **Documentation**: [TRaSH Guides Website](https://trash-guides.info/) |
  [Contributing Spec](https://github.com/TRaSH-Guides/Guides/blob/master/CONTRIBUTING.md)
- **Data Location**: JSON files under `docs/json/{radarr,sonarr}/` organized by entity type
- **Discovery**: `metadata.json` at repo root provides directory paths for all JSON data per Arr
  type
- **Key Data Files**:
  - `docs/json/{arr_type}/cf/*.json` - Custom format definitions (~207 for Radarr), each keyed by
    `trash_id` (MD5 hex hash) with `trash_scores` per profile and `specifications` conditions
  - `docs/json/{arr_type}/cf-groups/*.json` - CF group definitions (~20 for Radarr), collections of
    CF references by `trash_id`
  - `docs/json/{arr_type}/quality-profiles/*.json` - Quality profile definitions (~25 for Radarr)
    with quality tiers, CF score assignments via `formatItems`, and upgrade logic
  - `docs/json/{arr_type}/quality-size/*.json` - Quality definition files with min/preferred/max
    size limits per quality tier
  - `docs/json/{arr_type}/naming/*.json` - Naming convention templates for folder/file naming
- **Rate Limits**: None for git operations; GitHub API limits apply only if using raw URL fetches
- **Pricing**: Free, public repository

#### Radarr API v3

- **Documentation**: [Radarr API](https://radarr.video/docs/api/)
- **Authentication**: `X-Api-Key` header
- **Key Endpoints**:
  - `GET/POST/PUT/DELETE /api/v3/qualityprofile` - Quality profile CRUD
  - `GET/POST/PUT/DELETE /api/v3/customformat` - Custom format CRUD
  - `GET/PUT /api/v3/qualitydefinition` - Quality definitions (no create/delete)
  - `GET/PUT /api/v3/config/naming` - Naming configuration (singleton)
  - `GET/PUT /api/v3/config/mediamanagement` - Media management configuration
- **Differences from Sonarr**: Radarr uses profile-level language setting; no release profiles;
  movie-specific naming tokens

#### Sonarr API v3/v4

- **Documentation**: [Sonarr API](https://sonarr.tv/docs/api/)
- **Authentication**: `X-Api-Key` header
- **Key Endpoints**: Same pattern as Radarr with episode-specific additions
- **Key Difference**: Sonarr v3 lacks custom format support entirely (v4+ required); uses CFs for
  language instead of profile-level setting; has episode-specific naming tokens and release profiles

### Libraries

| Library                    | Version         | Purpose                              | Installation            |
| -------------------------- | --------------- | ------------------------------------ | ----------------------- |
| `$utils/git/`              | (existing)      | Git clone/pull/status for TRaSH repo | Already in codebase     |
| `@jsr/db__sqlite` + Kysely | (existing)      | In-memory SQLite cache compilation   | Already in codebase     |
| `crypto.subtle`            | (Deno built-in) | Content hashing for change detection | Built into Deno runtime |

No new external dependencies required.

### External Documentation

- [TRaSH Guides - Collection of Custom Formats (Radarr)](https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/):
  CF documentation and recommended scores
- [TRaSH Guides - How to Import Custom Formats](https://trash-guides.info/Radarr/Radarr-import-custom-formats/):
  Official import guide
- [Recyclarr Wiki](https://recyclarr.dev/wiki/): Competitor implementation reference
- [Configarr Repository](https://github.com/raydak-labs/configarr): TypeScript competitor reference

## Business Requirements

### User Stories

**Primary User: Self-Hoster**

- As a self-hoster, I want to import TRaSH Guide recommended custom formats into my PCD so that I
  get curated quality scoring without manually copying dozens of format definitions
- As a self-hoster, I want to import TRaSH Guide quality profiles (e.g., "Remux + WEB 1080p") so I
  can get a battle-tested quality hierarchy and score configuration out of the box
- As a self-hoster, I want to import TRaSH Guide quality definitions (size limits per quality) so my
  instances reject unreasonably large or small files
- As a self-hoster, I want to import TRaSH Guide naming conventions so my library follows
  standardized, Plex/Emby/Jellyfin-friendly file naming
- As a self-hoster, I want scheduled auto-sync from TRaSH Guides so that when the guide maintainers
  update a CF regex or add a new CF, my instances automatically get those changes
- As a self-hoster, I want to preview what changes will be applied before a TRaSH Guide sync pushes
  to my Arr instances, so I can verify nothing unexpected happens
- As a self-hoster, I want to sync TRaSH Guide data to multiple Arr instances selectively

**Secondary User: Power User**

- As a power user, I want to override specific TRaSH-sourced settings (e.g., tweak a CF score) and
  have my overrides preserved when the guide updates upstream
- As a power user, I want to cherry-pick which TRaSH Guide entities to import rather than take
  everything
- As a power user, I want to combine TRaSH Guide data with my own PCD database so TRaSH provides the
  base and I layer custom tweaks on top
- As a power user, I want conflict resolution when a TRaSH update changes something I have
  overridden, with options to keep my override, accept the upstream change, or be asked each time
- As a power user, I want to run TRaSH Guide sync independently from PCD sync -- they are separate
  upstream sources with potentially different schedules

### Business Rules

1. **TRaSH Guide data is a PCD data source, not a bypass**
   - TRaSH Guide JSON must be ingested through the PCD ops pipeline as base ops in a TRaSH-backed
     `database_instance`, not pushed directly to Arr instances
   - Validation: All TRaSH data must pass through cache compilation before sync
   - Exception: None. This ensures user ops, conflict detection, and preview infrastructure all work

2. **TRaSH entities are keyed by `trash_id`**
   - Each TRaSH CF and quality profile has a stable `trash_id` (32-char hex hash). This must be
     stored as the stable identity key so updates match correctly across guide revisions
   - Validation: Import rejects entities missing `trash_id`
   - Exception: Quality definitions and naming configs are singletons per `arr_type` (no `trash_id`)

3. **Arr-type specificity is mandatory**
   - TRaSH Guide data is organized by Arr type. Data for one Arr type must never be applied to
     another
   - Validation: Each entity import must carry its `arr_type` and fail-fast on mismatch
   - Exception: None. Aligns with Cross-Arr Semantic Validation Policy

4. **Conflict strategy governs override behavior**
   - When TRaSH updates conflict with user ops, `conflict_strategy` on the `database_instance`
     governs: `override` (re-create user op with new values), `align` (drop user op, accept
     upstream), `ask` (mark as `conflicted_pending`)
   - Validation: Conflict detection uses existing PCD value-guard system

5. **Dependency ordering: CFs before quality profiles**
   - Custom formats must be synced to Arr instances before quality profiles that reference them,
     since QP payloads require CF IDs from the Arr instance

### Edge Cases

| Scenario                                                                 | Expected Behavior                                                          | Notes                                     |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------- |
| TRaSH repo structure changes                                             | Fail with clear errors; don't silently import corrupted data               | Validate against `metadata.json` manifest |
| Partial guide availability (e.g., Radarr CFs present but Sonarr missing) | Succeed for available data, log warnings for missing                       | Per-entity error isolation                |
| Same `trash_id` in both Radarr and Sonarr guides                         | Treat as different entities; key includes `arr_type` + `trash_id`          | Different semantics per Arr app           |
| TRaSH marks CF as deprecated/removed                                     | Base op marked `orphaned`; cleanup scan detects stale CFs on Arr instances | Uses existing `markBaseOrphaned` logic    |
| CF has no `trash_scores.default` key                                     | Default score to 0 for missing profiles                                    | Transformer handles gracefully            |
| Shallow clone branch force-pushed                                        | Detect via git pull failure; re-clone automatically                        | Store `last_commit_hash` for detection    |
| Namespace collision with existing PCD entity names                       | Handled automatically by namespace suffix system                           | Uses `arr_database_namespaces`            |
| User links both PCD database and TRaSH source with overlapping CF names  | Each source gets its own namespace suffix; no collision                    | Existing multi-database infrastructure    |

### Success Criteria

- [ ] Self-hoster can link a TRaSH Guides repository as a PCD database instance
- [ ] TRaSH custom formats, quality profiles, quality definitions, and naming configs are ingested
      as base ops in `pcd_ops`
- [ ] `trash_id` is used as the stable identity key for all TRaSH-sourced entities
- [ ] Scheduled auto-sync pulls TRaSH Guide updates on a configurable interval
- [ ] After TRaSH sync, configured Arr instances automatically receive updated settings via
      `on_pull` trigger
- [ ] User can preview changes before sync via the existing preview system
- [ ] User ops (overrides) survive TRaSH Guide updates, with conflicts handled per
      `conflict_strategy`
- [ ] Multi-instance sync works: different instances can sync different TRaSH profiles
- [ ] Arr-type validation prevents cross-Arr misapplication of TRaSH data
- [ ] Stale TRaSH entities (removed from guide) are detected and cleaned up
- [ ] Feature works for Radarr and Sonarr at minimum
- [ ] No modification required to existing sync pipeline (processor, registry, handlers, preview)

## Technical Specifications

### Architecture Overview

```text
                    +-----------------------------+
                    |   TRaSH Guides Git Repo     |
                    |  (github.com/TRaSH-Guides)  |
                    +-------------+---------------+
                                  |
                         git clone / pull (shallow)
                                  |
                    +-------------v---------------+
                    |   TrashGuideParser           |
                    |   $trashguide/parser.ts      |
                    |                             |
                    |  - Parse CF JSON            |
                    |  - Parse QP JSON            |
                    |  - Parse QD/Naming JSON     |
                    |  - Validate trash_id        |
                    +-------------+---------------+
                                  |
                         parsed TRaSH entities
                                  |
                    +-------------v---------------+
                    |   TrashGuideTransformer      |
                    |   $trashguide/transformer.ts |
                    |                             |
                    |  - Map to PCD SQL ops       |
                    |  - Resolve trash_id refs    |
                    |  - Apply score profiles     |
                    +-------------+---------------+
                                  |
                         PCD base ops (origin=base, source=trash)
                                  |
                    +-------------v---------------+
                    |   Existing PCD Pipeline      |
                    |   pcd_ops -> cache compile   |
                    |                             |
                    |  - Write to pcd_ops table   |
                    |  - Content-hash dedup       |
                    |  - Value-guard conflicts    |
                    |  - In-memory SQLite cache   |
                    +-------------+---------------+
                                  |
                    +-------------v---------------+
                    |   Existing Sync Pipeline     |
                    |   $sync/processor.ts         |
                    |                             |
                    |  - Section handlers         |
                    |  - BaseSyncer subclasses    |
                    |  - Preview system           |
                    |  - Namespace isolation      |
                    +-------------+---------------+
                                  |
                    +-------------v---------------+
                    |   Arr Instances              |
                    |   (Radarr / Sonarr)          |
                    +-----------------------------+
```

### Data Models

#### TRaSH Custom Format JSON Schema (Input)

```typescript
interface TrashCustomFormat {
  trash_id: string; // 32-char hex hash
  trash_scores: Record<string, number>; // e.g., { "default": -10000, "german": -35000 }
  trash_regex?: string; // regex101.com reference URL
  name: string;
  includeCustomFormatWhenRenaming: boolean;
  specifications: TrashSpecification[];
}

interface TrashSpecification {
  name: string;
  implementation: string; // e.g., "ReleaseTitleSpecification", "LanguageSpecification"
  negate: boolean;
  required: boolean;
  fields: {
    value: string;
    exceptLanguage?: boolean;
  };
}
```

#### TRaSH Quality Profile JSON Schema (Input)

```typescript
interface TrashQualityProfile {
  trash_id: string;
  name: string;
  trash_description: string;
  trash_url: string;
  upgradeAllowed: boolean;
  cutoff: string; // Quality tier name
  minFormatScore: number;
  cutoffFormatScore: number;
  minUpgradeFormatScore: number;
  language: string; // e.g., "original"
  items: TrashQualityItem[];
  formatItems: Record<string, string>; // CF name -> trash_id
}
```

#### New Database Tables

**`trash_guide_sources`** - Metadata for linked TRaSH Guide sources (one per arr_type):

| Field              | Type       | Constraints                  | Description                          |
| ------------------ | ---------- | ---------------------------- | ------------------------------------ |
| `id`               | `INTEGER`  | `PRIMARY KEY AUTOINCREMENT`  | Source ID                            |
| `name`             | `TEXT`     | `NOT NULL UNIQUE`            | User-friendly name                   |
| `repository_url`   | `TEXT`     | `NOT NULL`                   | Git URL (default: TRaSH Guides repo) |
| `branch`           | `TEXT`     | `NOT NULL DEFAULT 'master'`  | Git branch                           |
| `local_path`       | `TEXT`     | `NOT NULL`                   | Where repo is cloned locally         |
| `arr_type`         | `TEXT`     | `NOT NULL`                   | Target: `radarr` or `sonarr`         |
| `score_profile`    | `TEXT`     | `NOT NULL DEFAULT 'default'` | TRaSH score profile to apply         |
| `sync_strategy`    | `INTEGER`  | `NOT NULL DEFAULT 0`         | 0=manual, >0=check every X minutes   |
| `auto_pull`        | `INTEGER`  | `NOT NULL DEFAULT 0`         | 0=notify only, 1=auto-pull           |
| `last_commit_hash` | `TEXT`     |                              | Last synced commit hash              |
| `enabled`          | `INTEGER`  | `NOT NULL DEFAULT 1`         | Master on/off                        |
| `created_at`       | `DATETIME` | `DEFAULT CURRENT_TIMESTAMP`  |                                      |
| `updated_at`       | `DATETIME` | `DEFAULT CURRENT_TIMESTAMP`  |                                      |

**`trash_guide_entity_cache`** - Persistent intermediate cache to avoid re-parsing all JSON files on
every startup:

| Field          | Type       | Constraints                                                | Description                                                  |
| -------------- | ---------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| `id`           | `INTEGER`  | `PRIMARY KEY AUTOINCREMENT`                                |                                                              |
| `source_id`    | `INTEGER`  | `NOT NULL FK -> trash_guide_sources(id) ON DELETE CASCADE` | Source reference                                             |
| `trash_id`     | `TEXT`     | `NOT NULL`                                                 | TRaSH hex identifier                                         |
| `entity_type`  | `TEXT`     | `NOT NULL`                                                 | `custom_format`, `quality_profile`, `quality_size`, `naming` |
| `name`         | `TEXT`     | `NOT NULL`                                                 | Entity display name                                          |
| `json_data`    | `TEXT`     | `NOT NULL`                                                 | Full raw JSON blob                                           |
| `file_path`    | `TEXT`     | `NOT NULL`                                                 | Source file path in repo                                     |
| `content_hash` | `TEXT`     | `NOT NULL`                                                 | SHA-256 for change detection                                 |
| `fetched_at`   | `DATETIME` | `DEFAULT CURRENT_TIMESTAMP`                                |                                                              |

**Indexes**: `UNIQUE (source_id, trash_id)`, `idx_entity_type ON (source_id, entity_type)`

**`trash_id_mappings`** - Lookup table mapping TRaSH identifiers to PCD entity names:

| Field         | Type      | Constraints                                                | Description                               |
| ------------- | --------- | ---------------------------------------------------------- | ----------------------------------------- |
| `trash_id`    | `TEXT`    | `NOT NULL`                                                 | TRaSH hex identifier                      |
| `arr_type`    | `TEXT`    | `NOT NULL`                                                 | `radarr` or `sonarr`                      |
| `entity_type` | `TEXT`    | `NOT NULL`                                                 | `custom_format`, `quality_profile`, etc.  |
| `entity_name` | `TEXT`    | `NOT NULL`                                                 | PCD entity name                           |
| `source_id`   | `INTEGER` | `NOT NULL FK -> trash_guide_sources(id) ON DELETE CASCADE` | Which TRaSH source this mapping came from |
|               |           | `PRIMARY KEY (trash_id, arr_type, source_id)`              |                                           |

**Indexes**: `idx_trash_id_lookup ON (trash_id, arr_type)`,
`idx_entity_name ON (entity_name, arr_type)`

**Schema Migrations**:

- Migration N: `create_trash_guide_tables` - Creates `trash_guide_sources`,
  `trash_guide_entity_cache`, and `trash_id_mappings` tables with all indexes
- Migration N+1: Add `trash` to `pcd_ops.source` CHECK constraint (if not already a free text
  column)

### API Design

#### `GET /api/v1/trash-guide/sources`

**Purpose**: List all configured TRaSH guide sources **Authentication**: Required

**Response (200)**:

```json
{
  "sources": [
    {
      "id": 1,
      "name": "TRaSH Guides (Radarr)",
      "repositoryUrl": "https://github.com/TRaSH-Guides/Guides",
      "branch": "master",
      "arrType": "radarr",
      "scoreProfile": "default",
      "enabled": true,
      "lastSyncedAt": "2026-02-25T12:00:00Z",
      "lastCommitHash": "abc123def",
      "entityCounts": {
        "customFormats": 207,
        "qualityProfiles": 25,
        "qualitySizes": 1,
        "naming": 1
      }
    }
  ]
}
```

#### `POST /api/v1/trash-guide/sources`

**Purpose**: Link a new TRaSH guide source **Authentication**: Required

**Request**:

```json
{
  "name": "TRaSH Guides (Radarr)",
  "repositoryUrl": "https://github.com/TRaSH-Guides/Guides",
  "branch": "master",
  "arrType": "radarr",
  "scoreProfile": "default"
}
```

**Response (201)**: Full source object **Errors**: `409` name conflict, `422` invalid `arrType`

#### `POST /api/v1/trash-guide/sources/:id/sync`

**Purpose**: Trigger manual sync (pull + reparse + recompile) **Authentication**: Required

**Response (200)**:

```json
{
  "success": true,
  "hasUpdates": true,
  "commitsBehind": 3,
  "entitiesUpdated": 12
}
```

#### `GET /api/v1/trash-guide/sources/:id/entities`

**Purpose**: List available entities from a TRaSH source **Query params**:
`?type=custom_format&search=BR-DISK`

**Response (200)**:

```json
{
  "entities": [
    {
      "trashId": "ed38b889b31be83fda192888e2286d83",
      "type": "custom_format",
      "name": "BR-DISK",
      "scores": { "default": -10000, "german": -35000 },
      "group": "Unwanted"
    }
  ]
}
```

#### `GET /api/v1/trash-guide/sources/:id/score-profiles`

**Purpose**: List available score profiles across all CFs

**Response (200)**:

```json
{
  "scoreProfiles": ["default", "german", "french-vostfr", "french-multi"]
}
```

#### Additional Endpoints

- `PUT /api/v1/trash-guide/sources/:id` - Update source configuration
- `DELETE /api/v1/trash-guide/sources/:id` - Unlink source and delete local clone
- `GET /api/v1/trash-guide/sources/:id/quality-profiles` - List available quality profiles with
  detail

### System Integration

#### Files to Create

- `packages/praxrr-app/src/lib/server/trashguide/index.ts` - Public API re-exports
- `packages/praxrr-app/src/lib/server/trashguide/manager.ts` - TrashGuideManager lifecycle
  orchestration
- `packages/praxrr-app/src/lib/server/trashguide/fetcher.ts` - Git clone/pull + file reading
- `packages/praxrr-app/src/lib/server/trashguide/parser.ts` - JSON parsing for TRaSH schemas
- `packages/praxrr-app/src/lib/server/trashguide/transformer.ts` - TRaSH -> PCD ops transformation
- `packages/praxrr-app/src/lib/server/trashguide/types.ts` - TypeScript interfaces for TRaSH JSON
- `packages/praxrr-app/src/lib/server/db/queries/trashGuideSources.ts` - Source CRUD queries
- `packages/praxrr-app/src/lib/server/db/queries/trashGuideEntityCache.ts` - Entity cache queries
- `packages/praxrr-app/src/lib/server/db/queries/trashIdMappings.ts` - trash_id <-> PCD entity
  lookup queries
- `packages/praxrr-app/src/lib/server/db/migrations/YYYYMMDD_create_trash_guide_tables.ts` -
  Migration (sources, entity cache, id mappings)
- `packages/praxrr-app/src/lib/server/jobs/handlers/trashGuideSync.ts` - Job handler for scheduled
  sync
- `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/+server.ts` - GET/POST sources
- `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/+server.ts` - GET/PUT/DELETE by ID
- `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/sync/+server.ts` - POST trigger
  sync
- `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/entities/+server.ts` - GET
  entities
- `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/quality-profiles/+server.ts` - GET
  quality profiles
- `packages/praxrr-app/src/routes/api/v1/trash-guide/sources/[id]/score-profiles/+server.ts` - GET
  score profiles

#### Files to Modify

- `packages/praxrr-app/src/lib/server/jobs/queueTypes.ts` - Add `'trashguide.sync'` to `JobType`
  union
- `packages/praxrr-app/src/lib/server/jobs/display.ts` - Add display name for new job type
- `packages/praxrr-app/src/lib/server/jobs/schedule.ts` - Add `scheduleTrashGuideSyncForSource()`,
  call from `scheduleAllJobs()`
- `packages/praxrr-app/src/lib/server/jobs/handlers/index.ts` - Import new handler
- `packages/praxrr-app/src/hooks.server.ts` - Initialize TrashGuideManager after PCD init
- `packages/praxrr-app/src/lib/server/db/migrations.ts` - Register new migration
- `packages/praxrr-app/deno.json` - Add `$trashguide/` path alias

#### Configuration

- TRaSH Guides repo URL and branch are well-known defaults in the linking UI (not env vars)
- Users opt in to TRaSH Guides as a source through the Database linking flow

## UX Considerations

### User Workflows

#### Primary Workflow: Sync Dashboard

1. **User opens Sync page**
   - System: Renders dashboard with status cards per Arr instance, each showing last sync time,
     status indicator (synced/pending/failed/in-progress), and database source tags
   - System: Cards with failures float to top (sorted by severity); global summary bar: "5 instances
     synced, 1 pending, 0 failed"

2. **User notices pending changes**
   - System: Amber badge indicates upstream TRaSH Guide changes waiting
   - User: Clicks card to drill into instance detail

3. **User reviews changes**
   - System: Shows Terraform-style plan/apply preview with progressive disclosure (summary counts ->
     section-level changes -> entity-level before/after -> field-level diffs)
   - User: Reviews, clicks "Apply" to execute sync

4. **Sync executes**
   - System: Real-time progress via SSE (or polling fallback), section-by-section completion
   - System: Toast notification on completion with summary

#### Setup Workflow: First-Time Configuration

1. **User navigates to Databases page**
   - User: Clicks "Link Database" and selects "TRaSH Guides" well-known source option
   - System: Pre-fills repo URL (`https://github.com/TRaSH-Guides/Guides`) and branch (`master`)

2. **User configures source**
   - User: Selects Arr type (Radarr/Sonarr), score profile (default/german/etc.), and sync interval
   - System: Clones repo (shallow), parses all JSON, auto-imports all entities as read-only base ops
   - System: Shows entity count summary (e.g., "207 custom formats, 25 quality profiles imported")

3. **User configures Arr instance sync**
   - User: Goes to instance settings, selects TRaSH source, picks which quality profiles to sync
   - System: Sets trigger (on_pull, schedule, or manual)
   - Note: All entities are imported but users choose _which_ to sync per instance

4. **User wants to customize a TRaSH entity**
   - User: Finds TRaSH CF/QP in entity browser, clicks "Duplicate to My Database"
   - System: Creates editable copy in user's PCD database with `source=local`
   - User: Edits the duplicate freely; original TRaSH entity remains read-only

#### Error Recovery Workflow

1. **Sync failure occurs**
   - System: Failed card shown with red indicator, error message, and timestamp

2. **User investigates**
   - User: Clicks card to see detailed error (git fetch failed, API timeout, etc.)
   - System: Shows per-entity success/failure breakdown for partial failures

3. **User recovers**
   - System: Offers "Retry" button for transient errors, "Reconfigure" for persistent issues

### UI Patterns

| Component         | Pattern                                       | Notes                                                   |
| ----------------- | --------------------------------------------- | ------------------------------------------------------- |
| Sync dashboard    | Card grid with global status bar              | Severity-first sorting; instance cards with source tags |
| Diff preview      | Progressive disclosure (4 levels)             | Summary -> sections -> entities -> fields               |
| Schedule config   | Interval presets (15m, 30m, 1h, 6h, 12h, 24h) | Cron for advanced users only                            |
| Progress feedback | SSE-driven real-time updates                  | Fallback to polling; section-by-section completion      |
| Entity browser    | Searchable grouped list                       | Groups from TRaSH CF groups; individual CF selection    |
| Error display     | Inline error cards with recovery actions      | Toast for background errors; inline for user-triggered  |

### Accessibility Requirements

- ARIA live regions for sync status updates
- Keyboard navigable entity selection (space to toggle, arrow keys to move)
- Color-independent status indicators (icons + text alongside color coding)
- Focus management during sync progress updates

### Performance UX

- **Loading States**: Skeleton cards on dashboard; inline progress bar during sync; spinner on
  entity list load
- **Optimistic Updates**: Immediately show "syncing" state on button click before server confirms
- **Real-Time Updates**: SSE for sync progress (`/api/v1/sync/events`); 5-second polling fallback
- **Error Feedback**: Error toast within 2 seconds of failure; detailed error inline within 5
  seconds

## Recommendations

### Implementation Approach

**Recommended Strategy**: PCD-First Pipeline (Option A). TRaSH data flows through existing PCD ops
system as base ops in a virtual database instance. The main new code is the parser/transformer
layer.

**Phasing**:

1. **Phase 1 - Foundation**: TRaSH Guide repository linking, JSON parsing, custom format import as
   PCD base ops, basic entity browser UI, `trashguide.sync` job type
2. **Phase 2 - Quality Profiles**: Quality profile import with CF score mapping, quality definitions
   import, profile selection UI with one-click apply
3. **Phase 3 - Full Sync**: Scheduled auto-sync with diff detection, naming convention import, media
   management settings, notifications for sync events
4. **Phase 4 - Polish**: Cross-instance template application, sync history/analytics, three-way
   conflict resolution UI, import/export configurations

### Technology Decisions

| Decision               | Recommendation                               | Rationale                                                                                           |
| ---------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Integration model      | Dedicated table + PCD ops pipeline           | Clean separation from `database_instances`; TRaSH transformer produces PCD-compatible ops for cache |
| Git clone strategy     | Shallow clone (`--depth 1`)                  | Reduces storage from ~200MB to ~30MB; `git pull` works for forward-only updates                     |
| Change detection       | Git diff (primary) + content hash (fallback) | `git diff --name-only <last_commit>..HEAD -- docs/json/` is zero I/O overhead                       |
| Score profile handling | Per-source selection (single profile)        | Simplest mental model; `score_profile` column on `trash_guide_sources`                              |
| Arr-type separation    | One source per `arr_type`                    | Avoids confusing UI; aligns with guide data organization and Cross-Arr policy                       |

### Quick Wins

- **TRaSH Guide browser**: Read-only JSON parsing + UI display requires zero schema changes and
  provides immediate discovery value
- **`trash_id` lookup table**: Simple mapping enables future guide-backed references
- **Job type registration**: Adding `trashguide.sync` to `JobType` union wires up scheduling
  infrastructure with minimal effort

### Future Enhancements

- **Smart three-way conflict resolution**: Show previous TRaSH version, new TRaSH version, user
  version for informed choice
- **TRaSH Guide changelog**: Parse git commit history to show what changed between versions
- **Cross-instance templates**: Apply same TRaSH profile to multiple instances with one action
- **Configarr YAML import**: Support Recyclarr/Configarr configuration file formats as import
  sources
- **Analytics dashboard**: Track CF activity, score distribution, sync frequency over time

## Risk Assessment

### Technical Risks

| Risk                                                                          | Likelihood | Impact | Mitigation                                                                                  |
| ----------------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------- |
| TRaSH JSON schema changes without notice                                      | Medium     | High   | Pin to known-good commit; validate JSON against expected schema; detect via `metadata.json` |
| Schema impedance mismatch (`trash_id`/`trash_scores` not in PCD schema)       | High       | Medium | Resolved: `trash_id_mappings` lookup table in app DB; do not modify PCD schema columns      |
| Custom format condition type mismatches between TRaSH JSON and PCD conditions | High       | Medium | Build comprehensive mapping table with verified parity per Arr type                         |
| Race condition between TRaSH sync and manual PCD edits                        | Low        | Medium | Leverage existing `claimSync()`/`setStatusPending()` atomic state machine                   |
| Large TRaSH repo clone slow on first link                                     | Medium     | Low    | Shallow clone; progress feedback in UI; reuse local cache across re-links                   |
| Sonarr v3 lacks custom format support                                         | High       | Low    | Scope to Sonarr v4+ or clearly document limitation                                          |

### Integration Challenges

- **PCD ops source taxonomy**: Current `pcd_ops.source` may need a new `trash` value via migration
- **Entity naming collisions**: Handled by existing namespace suffix system, but TRaSH data needs a
  virtual database association
- **`trash_scores` mapping to PCD**: CF scores per profile need mapping to
  `quality_profile_custom_formats` table rows; profile name resolution required
- **Quality definition sync**: TRaSH quality sizes use min/max/preferred values mapping to Arr's
  `qualityDefinitions` endpoint, bridged via `mediaManagement` sync section

### Security Considerations

- **Git credentials**: TRaSH Guides is public; private fork support via existing encrypted
  credential system
- **JSON injection**: TRaSH regex patterns stored as data in PCD ops; existing `cache.validateSql()`
  prevents SQL injection
- **Repository trust**: Warn users when pointing to non-official TRaSH Guides forks

## Task Breakdown Preview

### Phase 1: Foundation

**Focus**: TRaSH Guide linking, JSON parsing, custom format import, entity browser

**Tasks**:

- Data source infrastructure (git clone, `metadata.json` parsing, job type registration)
- Custom format transformer (TRaSH CF JSON -> PCD ops)
- Import pipeline integration with `importBaseOps` flow
- Database migration for `trash_guide_sources` and `trash_guide_entity_cache`
- API endpoints for source CRUD and entity listing
- Entity browser UI page

**Parallelization**: Data source infrastructure + API endpoint scaffolding can run in parallel with
transformer development; UI can start once API contracts are defined

### Phase 2: Quality Profiles

**Focus**: Quality profile import, quality definitions, profile selection UI

**Dependencies**: Phase 1 completion (CF infrastructure required for QP score mapping)

**Tasks**:

- Quality profile transformer (TRaSH QP JSON -> PCD ops with quality tiers, groups, CF scores)
- Quality definitions transformer (quality sizes -> PCD quality definitions)
- Profile selection UI with one-click apply
- Preview integration for TRaSH profile imports

### Phase 3: Full Sync

**Focus**: Scheduled auto-sync, naming conventions, notifications

**Dependencies**: Phase 2 completion

**Tasks**:

- Scheduled sync handler with diff detection and notifications
- Naming convention transformer
- Media management settings sync
- Notification types (`TRASH_SYNC_SUCCESS`, `TRASH_SYNC_FAILED`, `TRASH_UPDATES_AVAILABLE`)
- Selective sync UI (choose which entities to track)

## Decisions (Resolved)

1. **TRaSH data storage model** -> **Dedicated `trash_guide_sources` table**
   - Avoids muddying `database_instances` with synthetic rows that don't behave like real PCD
     databases. Keeps separation clean. The TRaSH transformer still produces PCD-compatible ops that
     feed into the cache -- reuse without abstraction leak.

2. **`trash_id` storage strategy** -> **Separate lookup table (`trash_id_mappings`) in app DB**
   - Avoids coupling `praxrr-schema` to a specific external data source. Table maps `trash_id` +
     `arr_type` -> `entity_type` + `entity_name` + `source_id`. Extensible for future guide sources.

3. **Import behavior on link** -> **Auto-import all entities**
   - TRaSH entities are reference data. Import everything on link; users selectively _sync_ what
     they want to their Arr instances at the instance configuration level.

4. **Default linking behavior** -> **Selectable well-known trusted source (not auto-linked)**
   - TRaSH Guides appears as a first-class "well-known source" option in the Database linking flow
     with pre-filled URL/branch. Not auto-linked -- respects user agency while making the common
     path easy.

5. **TRaSH entity mutability** -> **Read-only with duplicate-and-edit**
   - TRaSH base ops are immutable reference data that update with the guide. To customize, user
     duplicates the entity into their own PCD database (creating a `source=local` copy) and edits
     freely. Original stays pristine for future updates.

## Research References

For detailed findings, see:

- [research-external.md](./research-external.md): TRaSH Guides data format, Arr APIs,
  Recyclarr/Configarr competitor analysis
- [research-business.md](./research-business.md): User stories, business rules, workflows, existing
  codebase integration analysis
- [research-technical.md](./research-technical.md): Architecture design, data models, API contracts,
  system constraints
- [research-ux.md](./research-ux.md): Dashboard design, diff/preview UX, DevOps dashboard patterns,
  competitive analysis
- [research-recommendations.md](./research-recommendations.md): Implementation strategy, phasing,
  risk assessment, alternative approaches

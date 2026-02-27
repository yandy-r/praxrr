# TRaSH Guide Sync

## Overview

TRaSH Guide Sync imports configuration entities from TRaSH Guides repositories directly into Praxrr.
[TRaSH Guides](https://trash-guides.info/) is a community-maintained collection of recommended
settings for Arr media-management apps. Praxrr clones a TRaSH Guides git repository, parses its JSON
entity definitions, caches them locally with content hashing, maintains stable TRaSH ID mappings for
rename and change detection, and can push updates to connected Arr instances.

Supported entity types:

- **Custom Formats** -- format definitions with specifications and scores.
- **Quality Profiles** -- quality profile definitions with quality items and format items.
- **Quality Sizes** -- quality size definitions with min/preferred/max per quality.
- **Naming** -- naming templates for media file organization.

Supported Arr types: `radarr`, `sonarr`.

## User workflow

## 1) Add a TRaSH guide source

- Navigate to `/databases/new/trash-guide` in the UI.
- Provide a name, repository URL, branch (defaults to `master`), and target Arr type (`radarr` or
  `sonarr`).
- On save, Praxrr clones the repository, reads `metadata.json` to discover entity file paths, parses
  all JSON entities, persists the entity cache and TRaSH ID mappings, and creates sync config rows
  for every matching Arr instance.

Constraints:

- Source names are unique (case-insensitive).
- The same repository URL + branch + Arr type combination cannot be registered twice.
- Arr type cannot be changed after creation.
- Repository URL must use `http` or `https`.

## 2) Browse cached entities

- Open `/databases/trash/{id}` to view the source overview and entity counts.
- Use the entities API to query the parsed entity cache with filtering by type and search by name.
  Pagination uses offset-based cursors.

## 3) Configure sync per Arr instance

When a source is created, Praxrr automatically creates sync config rows for every Arr instance whose
type matches the source Arr type. Each sync config has a trigger that controls when syncs fire:

- `none` -- sync disabled for this instance.
- `manual` -- sync only runs when triggered by the user.
- `on_pull` -- sync fires automatically after a successful TRaSH source pull.
- `on_change` -- sync fires when entity cache content changes.
- `schedule` -- sync runs on a recurring interval.

## 4) Sync the source

There are three ways to trigger a sync:

1. **Manual sync** -- call the sync API endpoint or use the UI action. Manual syncs always pull and
   re-parse, even when no upstream commits are detected.
2. **Scheduled sync** -- configure `syncStrategy` (interval in minutes) and enable `autoPull`. The
   job scheduler enqueues `trashguide.sync` jobs automatically. Missed schedule windows enqueue one
   immediate catch-up run.
3. **On-pull triggers** -- after a successful git pull, Praxrr fires `on_pull` sync events to all
   connected Arr instances whose sync config trigger is `on_pull`.

The sync flow:

1. Validate the source exists and is enabled.
2. Run `git fetch` and compare local/remote HEADs to detect upstream changes.
3. If updates are available (or this is a manual trigger): run `git pull`.
4. Parse all JSON entity files discovered via `metadata.json` paths.
5. Transform entities into portable format, build TRaSH ID mappings, detect renames and upstream
   deletions, compute diffs.
6. Replace the entity cache and TRaSH ID mappings in the database. Update sync metadata (last synced
   timestamp, last commit hash).
7. Fire `on_pull` sync events to connected Arr instances.

## 5) Monitor sync jobs

Sync jobs run as `trashguide.sync` in the background job queue. The job handler:

- Skips disabled sources and sources with schedule disabled (for scheduled triggers).
- Checks if updates are available before pulling (scheduled triggers skip pull when no upstream
  changes exist).
- Respects the `autoPull` flag -- when disabled, the job reports available updates without pulling.
- Retries transient git/network errors with exponential backoff (max 3 attempts, delay starts at 1
  minute, capped at 15 minutes).
- Automatically reschedules the next run for scheduled triggers.

## 6) Update a source

- Send a partial update via `PUT /api/v1/trash-guide/sources/{id}`.
- If `repositoryUrl` changes, Praxrr clones to a new path, parses, persists, then swaps paths
  atomically. The old clone directory is removed.
- `arrType` cannot be changed after creation (returns 422).
- `name` changes are validated against uniqueness constraints.

## 7) Delete a source

- Delete via `DELETE /api/v1/trash-guide/sources/{id}` or the UI.
- Removes the source record, its sync configs, entity cache, TRaSH ID mappings, and the local git
  clone directory.

## Practical API examples

```bash
# List all TRaSH sources
curl -sS "http://localhost:6868/api/v1/trash-guide/sources"

# Create a new TRaSH source for Radarr
curl -sS -X POST "http://localhost:6868/api/v1/trash-guide/sources" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "TRaSH Radarr",
    "repositoryUrl": "https://github.com/TRaSH-Guides/Guides",
    "arrType": "radarr",
    "branch": "master",
    "autoPull": true,
    "enabled": true,
    "syncStrategy": 360
  }'

# Create a new TRaSH source for Sonarr
curl -sS -X POST "http://localhost:6868/api/v1/trash-guide/sources" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "TRaSH Sonarr",
    "repositoryUrl": "https://github.com/TRaSH-Guides/Guides",
    "arrType": "sonarr",
    "autoPull": true,
    "enabled": true,
    "syncStrategy": 360
  }'

# Get a specific source by id
curl -sS "http://localhost:6868/api/v1/trash-guide/sources/1"

# Update source settings (partial patch)
curl -sS -X PUT "http://localhost:6868/api/v1/trash-guide/sources/1" \
  -H "Content-Type: application/json" \
  -d '{
    "syncStrategy": 720,
    "autoPull": false
  }'

# Delete a source
curl -sS -X DELETE "http://localhost:6868/api/v1/trash-guide/sources/1"

# Trigger a manual sync
curl -sS -X POST "http://localhost:6868/api/v1/trash-guide/sources/1/sync"

# List cached entities (with optional filters)
curl -sS "http://localhost:6868/api/v1/trash-guide/sources/1/entities"

# Filter entities by type
curl -sS "http://localhost:6868/api/v1/trash-guide/sources/1/entities?type=custom_format"

# Search entities by name with pagination
curl -sS "http://localhost:6868/api/v1/trash-guide/sources/1/entities?search=x265&limit=20&offset=0"
```

## API reference

| Method   | Path                                        | Description                       |
| -------- | ------------------------------------------- | --------------------------------- |
| `GET`    | `/api/v1/trash-guide/sources`               | List all configured TRaSH sources |
| `POST`   | `/api/v1/trash-guide/sources`               | Create a new TRaSH source         |
| `GET`    | `/api/v1/trash-guide/sources/{id}`          | Get a specific source             |
| `PUT`    | `/api/v1/trash-guide/sources/{id}`          | Update a source (partial patch)   |
| `DELETE` | `/api/v1/trash-guide/sources/{id}`          | Delete a source and its clone     |
| `POST`   | `/api/v1/trash-guide/sources/{id}/sync`     | Enqueue a manual sync job         |
| `GET`    | `/api/v1/trash-guide/sources/{id}/entities` | List cached entities for a source |

### Create/Update fields

| Field           | Type      | Required | Notes                                               |
| --------------- | --------- | -------- | --------------------------------------------------- |
| `name`          | `string`  | create   | Unique source name                                  |
| `repositoryUrl` | `string`  | create   | HTTP/HTTPS git repository URL                       |
| `arrType`       | `string`  | create   | `radarr` or `sonarr`. Immutable after creation      |
| `branch`        | `string`  | no       | Git branch. Defaults to `master`                    |
| `scoreProfile`  | `string`  | no       | Score set profile name                              |
| `autoPull`      | `boolean` | no       | Auto-pull on scheduled sync. Defaults to `true`     |
| `enabled`       | `boolean` | no       | Enable/disable the source. Defaults to `true`       |
| `syncStrategy`  | `integer` | no       | Schedule interval in minutes. `0` disables schedule |

### Entity query parameters

| Parameter | Type      | Notes                                                                |
| --------- | --------- | -------------------------------------------------------------------- |
| `type`    | `string`  | Filter: `custom_format`, `quality_profile`, `quality_size`, `naming` |
| `search`  | `string`  | Case-insensitive name search                                         |
| `arrType` | `string`  | Must match source Arr type (validation only)                         |
| `limit`   | `integer` | Page size (1--200, default 50)                                       |
| `offset`  | `integer` | Offset for pagination (default 0)                                    |
| `cursor`  | `string`  | Cursor-based pagination (alternative to offset)                      |

### Source response shape

```json
{
  "source": {
    "id": 1,
    "name": "TRaSH Radarr",
    "repositoryUrl": "https://github.com/TRaSH-Guides/Guides",
    "branch": "master",
    "arrType": "radarr",
    "scoreProfile": "",
    "autoPull": true,
    "enabled": true,
    "syncStrategy": 360,
    "lastSyncedAt": "2026-02-27T12:00:00.000Z",
    "lastCommitHash": "abc1234def5678...",
    "entityCounts": {
      "customFormats": 150,
      "qualityProfiles": 12,
      "qualitySizes": 3,
      "naming": 2
    }
  }
}
```

## Architecture

```
                            +--------------------+
                            |   TRaSH Guides     |
                            |   Git Repository   |
                            +--------+-----------+
                                     |
                              git clone / pull
                                     |
                            +--------v-----------+
                            |     Fetcher         |
                            | (clone, checkout,   |
                            |  pull, discover)    |
                            +--------+-----------+
                                     |
                           metadata.json discovery
                                     |
                            +--------v-----------+
                            |     Parser          |
                            | (read JSON files,   |
                            |  validate entities) |
                            +--------+-----------+
                                     |
                            +--------v-----------+
                            |    Transformer      |
                            | (portable format,   |
                            |  rename detection,  |
                            |  diff computation)  |
                            +--------+-----------+
                                     |
                     +---------------+----------------+
                     |               |                |
              +------v-----+  +-----v------+  +------v------+
              | Entity     |  | TRaSH ID   |  | Sync        |
              | Cache DB   |  | Mappings   |  | Triggers    |
              +------------+  +------------+  +------+------+
                                                     |
                                              +------v------+
                                              | Arr Sync    |
                                              | Pipeline    |
                                              +-------------+
```

### Database tables

| Table                         | Purpose                                                |
| ----------------------------- | ------------------------------------------------------ |
| `trash_guide_sources`         | Source configuration (name, URL, branch, arr type)     |
| `trash_guide_entity_cache`    | Parsed entity cache with content hashing               |
| `trash_id_mappings`           | Stable TRaSH ID to entity name mappings                |
| `trash_guide_sync_config`     | Per-instance sync config (PK: instance_id + source_id) |
| `trash_guide_sync_selections` | Per-instance entity selections for sync                |

### Key modules

| Module                                  | Role                                       |
| --------------------------------------- | ------------------------------------------ |
| `$lib/server/trashguide/manager.ts`     | Main orchestrator for CRUD and sync        |
| `$lib/server/trashguide/fetcher.ts`     | Git operations and metadata.json discovery |
| `$lib/server/trashguide/parser.ts`      | JSON entity file parsing and validation    |
| `$lib/server/trashguide/transformer.ts` | Portable format conversion and diff logic  |
| `$jobs/handlers/trashGuideSync.ts`      | Job handler for `trashguide.sync` jobs     |
| `$jobs/helpers/trashGuideSchedule.ts`   | Schedule management for sync sources       |
| `$jobs/helpers/trashGuideSyncQueue.ts`  | Manual sync queue and deduplication        |

## Troubleshooting

- `TRaSH source name already exists`: Source names must be unique. Rename the existing source or
  choose a different name.

- `TRaSH source repository already exists for this branch and arrType`: The same repository URL,
  branch, and Arr type combination is already registered. Use the existing source or change one of
  those parameters.

- `TRaSH source arrType cannot be changed once created`: Arr type is immutable. Delete the source
  and recreate it with the correct Arr type.

- `Invalid TRaSH source arrType`: Supported values are `radarr` and `sonarr`.

- `TRaSH metadata file not found`: The cloned repository does not contain a `metadata.json` at the
  repository root. Verify the repository URL points to a valid TRaSH Guides repository.

- `TRaSH metadata has no json_paths entry for "<arrType>"`: The repository metadata does not list
  paths for the selected Arr type. Verify the branch contains data for your target application.

- `Git branch/ref error`: The specified branch does not exist in the remote repository. Check the
  branch name.

- `Git authentication failed`: The repository requires credentials. For private repositories,
  configure a personal access token.

- `Git network failure`: Transient network issue. Scheduled syncs retry automatically with
  exponential backoff (up to 3 attempts). Manual syncs can be retried immediately.

- `TRaSH sync is already running for this source` (409): A sync job for this source is already in
  the queue or running. Wait for it to complete.

- `TRaSH source disabled` / `TRaSH source schedule is disabled`: Enable the source or set a valid
  `syncStrategy` value greater than 0.

- Sync completes but entity counts seem wrong: Check `parsedFiles` and `failedFiles` in the sync
  result. Files that fail JSON validation are counted as failed but do not block the overall sync.

- Entities show stale data after upstream update: Trigger a manual sync. Scheduled syncs only pull
  when upstream commits are detected via `git fetch`.

## Related docs

- [Feature guides index](./README.md)
- [Link, Bridge, Sync](./link-bridge-sync.md)
- [Portable Import/Export](./portable-import-export.md)
- [Entity Testing](./entity-testing.md)

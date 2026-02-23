# Link, Bridge, Sync

## Overview

This workflow is the core Praxrr loop:

1. Link one or more PCD databases.
2. Bridge Arr media-management instances.
3. Configure sync sections and triggers per instance.
4. Push and maintain settings over time.

## User workflow

## 1) Link a database

- Go to `/databases` and add a PCD (or use `/databases/new`).
- Set sync strategy for automatic PCD pull checks if needed.
- Use the database changes view to pull upstream updates.

When a pull succeeds, Praxrr recompiles cache data and can trigger Arr sync for sections configured
with `on_pull`.

## 2) Bridge an Arr instance

- Go to `/arr` and add an Arr instance (`/arr/new`).
- Provide `name`, `type`, `url`, and API key.
- Test connectivity before save (`/arr/test`).

Important behavior:

- Duplicate instance detection uses API key fingerprinting.
- API keys are encrypted before persistence.
- Disabled instances remain configured but are excluded from sync runs.

## 3) Configure sync per instance

- Open `/arr/{id}/sync`.
- Configure these sections:
  - `Media Management` (naming, quality definitions, media settings)
  - `Quality Profiles`
  - `Delay Profiles`
  - `Metadata Profiles` (Lidarr-only)
- Choose a trigger per section:
  - `manual`
  - `schedule` (cron)
  - `on_pull`
  - `on_change`

Dependency rule:

- Quality profile sync requires media management and delay profile config to be selected and saved.

## 4) Run sync and monitor

- Use each section's sync action to enqueue jobs.
- Jobs run as `arr.sync.<section>` in the background queue.
- Scheduled sections are automatically rescheduled.

## 5) Optional cleanup for stale configs

- Scan stale Arr-side configs with `/api/v1/arr/cleanup` (`action=scan`).
- Execute removal using prior scan output (`action=execute`).
- Profiles currently assigned in Arr are skipped with reason `Profile is assigned to media`.

## Practical API examples

```bash
# Inspect library (paged, filtered, sorted)
curl -sS "http://localhost:6868/api/v1/arr/library?instanceId=1&page=1&pageSize=100&query=anime&sortKey=title&sortDirection=asc"

# Invalidate cached library data for an instance
curl -sS -X DELETE "http://localhost:6868/api/v1/arr/library?instanceId=1"

# Cleanup dry-run (scan only)
curl -sS -X POST "http://localhost:6868/api/v1/arr/cleanup" \
  -H "Content-Type: application/json" \
  -d '{"instanceId":1,"action":"scan"}'
```

## Troubleshooting

- `Quality profiles require ...`:
  Save media management and delay profile sections first.
- `Metadata profile sync is supported only for Lidarr instances`:
  Metadata profile section is gated to Lidarr.
- Sync jobs fail with credential errors and the instance disables itself:
  Re-check Arr credential key configuration and recreate API key material.
- Cleanup keeps some quality profiles:
  Arr rejected deletion because the profile is still assigned to media.
- Library data looks stale:
  Invalidate cache with `DELETE /api/v1/arr/library?instanceId=...`.

## Related docs

- [Feature guides index](./README.md)
- [Entity Testing](./entity-testing.md)
- [Portable Import/Export](./portable-import-export.md)
- [OpenAPI paths: Arr](../api/v1/paths/arr.yaml)

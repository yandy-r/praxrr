---
title: Sync Pipeline
description: Arr sync section registry, per-arr_type dispatch, preview orchestrator, execution path, triggers, and relationship to arr.sync jobs.
---

The **sync pipeline** transforms compiled PCD state into Arr API operations. Preview
(dry-run) and execution are separate code paths. Section support is declared per
`arr_type` in `mappings.ts` — Radarr, Sonarr, and Lidarr do not share identical
semantics even when API shapes look similar.

User workflows: [Syncing Profiles](/guides/syncing-profiles/). This page covers internals.

## Section Registry

Sync work is organized into sections registered in `sync/registry.ts`:

| Section            | Handler import                |
| ------------------ | ----------------------------- |
| `qualityProfiles`  | `qualityProfiles/handler.ts`  |
| `delayProfiles`    | `delayProfiles/handler.ts`    |
| `mediaManagement`  | `mediaManagement/handler.ts`  |
| `metadataProfiles` | `metadataProfiles/handler.ts` |

Each section implements `SectionHandler` with syncers extending `BaseSyncer`. Handlers
register via side-effect imports in `sync/processor.ts`.

## Per-`arr_type` Dispatch

`sync/mappings.ts` defines supported sections per app:

| Arr type | Supported sections                              |
| -------- | ----------------------------------------------- |
| `radarr` | qualityProfiles, delayProfiles, mediaManagement |
| `sonarr` | qualityProfiles, delayProfiles, mediaManagement |
| `lidarr` | all four including metadataProfiles             |

`isSyncSectionSupported()` and related helpers **fail fast** with explicit error messages
when a section is requested for an unsupported `arr_type`. Media management subsections
(mediaSettings, naming, qualityDefinitions) are also gated per app.

## Preview Path (Read-Only)

Preview never mutates Arr state:

1. API: `POST /api/v1/sync/preview` (see OpenAPI reference)
2. `processor.ts` → `generatePreview()` in `preview/orchestrator.ts`
3. Orchestrator walks `SYNC_SECTION_ORDER`, invokes section syncers in preview mode
4. Returns per-section creates/updates/deletes and accumulated errors

Preview is safe to repeat while resolving PCD conflicts or selection mismatches.

## Execution Path

Execution runs through job handlers and direct processor calls:

| Trigger     | Entry point                                                       |
| ----------- | ----------------------------------------------------------------- |
| `on_pull`   | `triggerSyncs()` after PCD git pull                               |
| `on_change` | `triggerSyncs()` after PCD file/ops change                        |
| `schedule`  | Cron evaluation in `evaluateScheduledSyncs()` → `arr.sync.*` jobs |
| Manual      | UI or API enqueue of sync jobs                                    |

`arr.sync.*` job handlers invoke section syncers with live Arr clients from
`arrInstanceClients.ts`. Concurrency for multi-instance preview is bounded; execution
uses similar batching in `processor.ts`.

Startup pull marks instances active to prevent redundant `on_pull` fanout while
reconstructing selections from live Arr state.

## Pipeline Flow

```mermaid
flowchart LR
  PCD["Compiled PCD cache"]
  Preview["preview/orchestrator"]
  Jobs["arr.sync.* jobs"]
  Arr["Arr HTTP APIs"]

  PCD --> Preview
  PCD --> Jobs
  Preview -. read-only .-> Arr
  Jobs --> Arr
```

In prose: both preview and execution read compiled PCD state. Preview diffs against Arr
without writes. Jobs perform the actual push.

## Contract Notes

- Do not assume cross-Arr field parity when reading or extending syncers.
- Config names used as sync lookup keys must match persisted identifiers exactly.
- Quality profile compatibility filtering uses app-compatible quality names, not
  `arr_type='all'` scores alone.

## Source References

- `packages/praxrr-app/src/lib/server/sync/processor.ts`
- `packages/praxrr-app/src/lib/server/sync/preview/orchestrator.ts`
- `packages/praxrr-app/src/lib/server/sync/mappings.ts`
- `packages/praxrr-app/src/lib/server/sync/registry.ts`
- `packages/praxrr-app/src/lib/server/jobs/handlers/arrSync.ts`

## Related

- [PCD System](/app/pcd-system/) — compiled state preview and sync read from
- [Job System](/app/jobs/) — `arr.sync.*` scheduling and execution
- [Syncing Profiles](/guides/syncing-profiles/) — user guide
- [Architecture Overview](/app/architecture/) — data flow summary
- [Troubleshooting](/guides/troubleshooting/) — preview and sync errors

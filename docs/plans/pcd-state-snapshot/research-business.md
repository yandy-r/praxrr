# Business Research: PCD State Snapshots

## Executive Summary

Snapshots are a safety feature for administrators making configuration changes that propagate to Arr
instances. They provide a reliable rewind marker without adding heavy backup infrastructure.

This second pass refines business behavior to avoid duplicate/ambiguous captures and to keep API scope
explicit per database.

## Primary User Stories

- As an admin, I want automatic snapshots before risky operations so I can recover quickly.
- As an admin, I want manual "save points" before major edits.
- As an admin, I want snapshot history scoped to a specific database.
- As an admin, I want old auto snapshots pruned automatically.

## Business Rules

1. Snapshot ownership is always one database.
2. Auto snapshots run before pull and before Arr sync execution.
3. Manual snapshots are user-triggered and never deduplicated.
4. Snapshot failures never block operational workflows.
5. Auto snapshots are retained with bounded defaults.

## Workflow Definitions

### Auto Snapshot Before Pull

1. Pull flow begins.
2. System captures a `pull` snapshot for target database.
3. Pull/import/compile proceeds regardless of snapshot result.

### Auto Snapshot Before Arr Sync

1. Arr sync job resolves selected sections.
2. System resolves distinct target database IDs from section configs.
3. System captures `sync` snapshot(s) for those DBs.
4. Sync section execution proceeds regardless of snapshot result.

### Manual Snapshot

1. User submits optional description for database-scoped endpoint.
2. System stores `manual` snapshot.
3. Response includes full marker metadata.

## Retention and Lifecycle

- Auto snapshots:
  - max count per DB: `50`
  - max age: `30 days`
- Manual snapshots:
  - not auto-pruned in MVP
  - removed only explicitly or by cascade on DB unlink

## Data Ownership and Deletion

- `database_instances` is parent.
- `pcd_snapshots` rows cascade on unlink.
- Snapshot metadata is operational history; no extra PII introduced.

## Operational Transparency

Minimum required metadata in list/detail:

- created timestamp
- trigger (`pull`, `sync`, `manual`)
- op boundary and counts
- target instance IDs when trigger is `sync`

## Business Risks

| Risk                             | Impact                          | Mitigation                                     |
| -------------------------------- | ------------------------------- | ---------------------------------------------- |
| Too many auto snapshots          | Storage growth, noisy history   | Inline pruning + dedupe defaults               |
| Ambiguous ownership              | Wrong snapshot used for restore | Path-scoped database routes + ownership checks |
| Duplicate pull captures          | Confusing history               | Pull hook centralized in `PCDManager.sync()`   |
| Snapshot failure blocks workflow | Operational disruption          | Explicit non-blocking behavior                 |

## Open Items (Deferred)

- User-labeled protected snapshots excluded from pruning.
- Restore UX and restoration policy decisions.
- Snapshot sharing/export behavior.

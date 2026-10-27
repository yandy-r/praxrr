# Local Overrides

## Overview

Local overrides are published **user-layer operations** in a linked Praxrr Config Database (PCD).
They record local creates, edits, renames, and deletes on top of the upstream **base** layer and
persist across database pulls. The Local overrides manager lets you inspect those operations and
remove them without editing the upstream repository.

An entity counts as locally modified when at least one published user operation maps to its current
name. This is an operation-based indicator, not a claim that its current values differ from upstream:
two edits that cancel each other out still count until their operations are reverted.

The manager covers custom formats, quality profiles, regular expressions, delay profiles, naming,
media settings, quality definitions, and Lidarr metadata profiles. Arr-scoped entities are tracked
separately: a Radarr naming configuration does not mark a Sonarr configuration of the same name.

## Find locally modified entities

The **Locally modified** badge appears beside affected entities in table and card views. Use
**Show only locally modified** in the list's actions bar to hide unmodified rows. The toggle is
remembered per list and database and works alongside existing search and source filters.

The badge and filter are available on:

- Custom formats
- Quality profiles
- Regular expressions
- Delay profiles
- Media management: naming, media settings, and quality definitions
- Lidarr metadata profiles

Rows sourced directly from TRaSH Guides are not marked as local PCD edits. Deleted entities no longer
have a list row; review their operations in the database's Local overrides tab instead.

## Review a database's overrides

1. Open **Databases** and select the linked database.
2. Open **Local overrides**, between **Conflicts** and **Tweaks**
   (`/databases/{databaseId}/overrides`).
3. Search by entity name, type, Arr app, or change kind.
4. Expand a row to inspect **Field changes from upstream** and its individual operations.

Each row identifies the entity's current name, type, Arr app where applicable, and whether it was
**Created**, **Deleted**, or **Modified** locally. It also shows operation count, last-change time,
and a pending-conflict badge when applicable. The expanded view compares upstream base values with
the resolved state, then lists the operation IDs, titles, changed fields, and latest statuses.

A row can have operations but no field differences when edits net out to the upstream values.
Operations that cannot safely be attributed to a supported entity are counted in an information
notice. They are not individually manageable here, but they remain eligible for **Undo last change**.

The database must be available with a built cache. Otherwise the page reports that local overrides
cannot be loaded.

## Revert local operations

### Revert all for one entity

Choose **Revert all** on the entity's row and confirm. This removes all of that entity's published
user operations from the active configuration and recompiles the database:

- An upstream entity returns to its upstream state.
- An entity created only locally is removed.
- An upstream entity deleted locally is restored from upstream.

“Revert all” applies to that row, not to every entity in the database. Operations are soft-dropped:
their records and audit history are retained rather than deleted.

### Revert selected operations

Expand the entity, select operation checkboxes, choose **Revert selected**, and confirm. Unselected
operations stay active. The server rejects an unsafe partial selection, such as removing an earlier
field change that a later operation still relies on. Select the related operations together, or use
Revert all when you intend to discard the entity's entire local override.

Some saves create explicit operation groups spanning entities, such as deleting a custom format and
updating quality-profile scores that reference it. A revert that would split a required group is
rejected first. The confirmation then lists the related entities and offers **Revert group together**;
review that wider scope before confirming again.

Other dependent operations are not silently cascaded. If recompilation would introduce a new
conflict or change operations outside the planned set, the attempt is rolled back and an error is
shown. Resolve the reported dependency or conflict before retrying.

## Undo last change

**Undo last change** targets the latest still-published local action across the **whole database**,
not the last row you selected or the last search result. Review the listed entity names and confirm.
A single action can include several operations and several entities.

Every mutating HTTP request is one action: it shares an `action_id` across all its user operations.
A scheduled or manual job run is its own action, and each automatic conflict override applied during
recompilation is a separate action rather than part of the save that triggered it. Outside these
contexts, a single writer call falls back to one action of its own. Historical operations are not
backfilled because their original save boundaries cannot be reconstructed; they fall back to
`group_id`, then to a single operation. Undoing an older multi-operation save may therefore require
more than one undo.

Undo can reactivate previously applied edits that the undone action superseded, so undoing a delete
can restore the local edits that preceded it. This includes conflict overrides: undoing a manual or
automatic override reactivates the original published operation it replaced, and the conflict that
was pending on that operation may return after the recompile. The UI sends the action ID it
displayed: if another change has since become the latest action, undo is rejected as stale and the
page refreshes instead of undoing a different action. With no published user operations, the button
is disabled.

There is no redo button. To reapply a reverted change, edit the entity again.

## API

All paths below are relative to `/api/v1`. Browser sessions use normal application authentication;
API tokens need **read** for GET and **admin** for both POST endpoints.

| Method | Path                                                     | Purpose                                                              |
| ------ | -------------------------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/pcd/{databaseId}/overrides`                            | List overrides, field differences, operations, and the latest action |
| POST   | `/pcd/{databaseId}/overrides/{entityType}/{name}/revert` | Revert all or selected operations for one entity                     |
| POST   | `/pcd/{databaseId}/overrides/undo`                       | Undo the latest local action                                         |

Use the current resolved name after a rename, URL-encoded as a path segment. Names are preserved
exactly, including whitespace; empty names are rejected. Names containing `/` are supported: encode
the slash as `%2F` so the name resolves as a single path segment.

The `entityType` values are `delayProfile`, `regularExpression`, `customFormat`, `qualityProfile`,
`naming`, `mediaSettings`, `qualityDefinitions`, and `lidarrMetadataProfile`.

For GET filtering and the revert target:

- `naming`, `mediaSettings`, and `qualityDefinitions` require explicit `arrType=radarr|sonarr|lidarr`.
- `lidarrMetadataProfile` requires `arrType=lidarr`.
- The four Arr-agnostic types reject `arrType` when that entity type is supplied.
- GET without an entity type may use `arrType` as a filter. Its `lastAction` is always database-wide.

Revert accepts an optional JSON body: omit `opIds` to revert all operations for the entity, or pass
1–1000 positive operation IDs for a selection. `cascadeGroup` defaults to `false`. Undo accepts an
optional `expectedActionId` copied from GET's `lastAction.actionId`. POST bodies are limited to 8 KB.

```bash
# Review local overrides (read-scoped token)
curl -sS -H 'X-Api-Key: <token>' \
  'http://localhost:6868/api/v1/pcd/1/overrides'

# Revert selected operations on a regex (admin-scoped token)
curl -sS -X POST -H 'X-Api-Key: <token>' -H 'Content-Type: application/json' \
  -d '{"opIds":[42,43]}' \
  'http://localhost:6868/api/v1/pcd/1/overrides/regularExpression/My%20Pattern/revert'
```

A successful revert returns `revertedOpIds`, `cascadedEntities`, `remainingOpIds`, and
`resolvedMatchesBase`. The latter is `null` for a partial revert or when the entity is absent from
both layers. Undo returns `undoneActionId`, `revertedOpIds`, `reactivatedOpIds`, and affected `entities`.

### Error reasons

Missing targets and safety rejections use `{error, reason, blockingOpIds?, entities?}`. The optional
fields identify blocking operations or related entities where available.

| Status | `reason`                | Meaning / recovery                                                                            |
| ------ | ----------------------- | --------------------------------------------------------------------------------------------- |
| 404    | `entity_not_found`      | No local overrides map to the current entity name; refresh the list.                          |
| 404    | `op_not_found`          | A selected ID does not belong to the requested entity.                                        |
| 404    | `nothing_to_undo`       | No published user operations remain.                                                          |
| 409    | `group_dependency`      | Selection splits a required group; review related entities before opting into `cascadeGroup`. |
| 409    | `dependent_ops`         | Remaining operations depend on a selected create or rename.                                   |
| 409    | `selection_blocked`     | Partial selection is unsafe because of field overlap, rename, or operation ordering.          |
| 409    | `op_not_revertible`     | A selected operation is no longer published; refresh before retrying.                         |
| 409    | `conflict_after_revert` | Recompilation would introduce a new conflict; the attempt was rolled back.                    |
| 409    | `collateral_ops`        | Recompilation would affect operations outside the planned set; the attempt was rolled back.   |
| 409    | `stale_action`          | The displayed action is no longer the latest; re-read before undoing.                         |

Invalid parameters or JSON, oversized bodies, unavailable databases, and unbuilt caches return 400;
unauthenticated requests return 401. Insufficient token scope returns 403. Unexpected failures return 500. These use the usual `{error}` response.

See the [endpoint reference](../api/endpoints.md#pcd-local-overrides),
[OpenAPI paths](../api/v1/paths/pcd-overrides.yaml), and
[schemas](../api/v1/schemas/pcd-overrides.yaml) for the full wire contract.

## Limitations and safety notes

- **Net-zero edits keep the badge.** An empty field diff is not proof that no user operations exist.
- **Create/delete cancellation cannot be undone.** When the writer cancels a local create with a
  later delete, it drops the create without writing a delete operation (`cancelOutCreate`). There is
  no published delete action for Undo to reverse.
- **No automatic snapshot is created** by revert or undo. If you need a recoverable checkpoint,
  create a manual snapshot in the database's Snapshots tab first.
- **Promoting local edits to upstream/base is not supported here.** This manager reviews and removes
  user operations; it does not turn them into base drafts or repository commits.
- **Revert is a PCD change, not an Arr rollback.** Review the resulting configuration and use your
  configured sync workflow to apply it to an Arr instance.

## Related documentation

- [Feature guides index](./README.md)
- [Link, Bridge, Sync](./link-bridge-sync.md)
- [Portable Import/Export](./portable-import-export.md)
- [API authentication](../api/authentication.md)
- [API v1 OpenAPI](../api/v1/openapi.yaml)

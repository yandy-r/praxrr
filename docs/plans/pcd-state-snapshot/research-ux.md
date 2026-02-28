# UX Research: PCD State Snapshots

## Executive Summary

Snapshot UX should prioritize confidence and traceability over feature density. The user needs to quickly
answer three questions:

1. What changed risk context (`pull` vs `sync` vs `manual`)?
2. How old is this marker?
3. Is this a likely restore candidate?

## Core UX Flows

### Snapshot List (per database)

Route:

- `/databases/[id]/snapshots`

Required fields per row:

- timestamp
- trigger badge (`Before Pull`, `Before Sync`, `Manual`)
- optional description
- op counts (`base/user`)
- target instance chips for sync snapshots

Controls:

- filter by `type`
- pagination
- create manual snapshot action

### Snapshot Detail

Route:

- `/databases/[id]/snapshots/[snapshotId]`

Required sections:

- metadata summary
- `opsWrittenSince`
- fingerprint present/missing indicator
- destructive action: delete with confirmation
- future action placeholder: restore

### Manual Create

Interaction:

- inline or modal-light form
- optional description field
- fast success/failure toast

## Messaging Rules

- Auto snapshot success should be quiet or low-noise.
- Auto snapshot failure should be warning-level and explicit that operation continued.
- Trigger labels must convey pre-risk semantics.

## Accessibility

- Badge meaning cannot rely on color alone.
- Keyboard-accessible row navigation and action controls.
- Confirmation dialogs must be focus-trapped and escapable.

## Performance UX

Targets:

- list load under 200ms typical
- manual create under 500ms typical

Feedback:

- skeleton list state
- loading state for create/delete actions

## UX Risks and Mitigation

| Risk                           | Mitigation                                             |
| ------------------------------ | ------------------------------------------------------ |
| Timeline noise from autos      | Type filter defaults + concise row metadata            |
| Confusion over trigger meaning | Use explicit copy: "Before Pull", "Before Sync"        |
| Wrong-database actions         | Keep routes DB-scoped and show DB name in page heading |

## Deferred UX (Post-MVP)

- Snapshot diff against current state.
- Restore confirmation with impact preview.
- Protected manual snapshots (pin/bookmark).

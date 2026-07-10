---
title: Syncing Profiles
description: Sync preview, triggers, dry-run behavior, and base vs user ops.
---

Sync pushes compiled PCD configuration to connected Arr instances. Each instance
has independent sync selections, triggers, and preview state per section.

## Sync sections

Depending on `arr_type`, an instance may expose:

- **Quality profiles** (with dependent custom formats)
- **Delay profiles**
- **Media management**
- **Metadata profiles** (Lidarr)

Open **Arr → {instance} → Sync** to enable profiles from each linked PCD and
configure when pushes run.

## Sync triggers

Each section supports a trigger mode:

| Trigger     | When sync runs                       |
| ----------- | ------------------------------------ |
| `on_change` | After local PCD or selection changes |
| `on_pull`   | After the PCD repository is pulled   |
| `schedule`  | On a cron expression (UTC)           |

Scheduled syncs use standard cron syntax (for example `0 * * * *` hourly).
Praxrr evaluates schedules during the job processor cycle.

Optional startup pull (`PULL_ON_START=true`) reconstructs selections from live
Arr state without immediately overwriting remote configuration.

## Preview before apply

**Sync Preview** generates a read-only diff between desired PCD state and the
current Arr API state:

1. On the **Sync** page, open the preview panel.
2. Praxrr fetches remote entities and compares field-level changes.
3. Review summary counts: creates, updates, deletes, unchanged.

Preview runs per section (quality profiles, delay profiles, etc.). Quality
profile preview includes custom formats referenced by selected profiles.

Preview does not modify Arr. Use it as a dry-run gate before **Apply Preview**,
**Sync now**, or enabling aggressive triggers.

### Apply the reviewed preview

**Apply Preview** authorizes only what you reviewed: the displayed instance and Arr
family, the eligible sections you selected, their effective configuration, and the
underlying desired PCD and live Arr evidence. Praxrr keeps the corresponding review
binding privately in memory for the preview's limited lifetime; it is not durable across
a restart.

Before anything is written, Praxrr:

1. Claims the preview and all selected sections so another sync cannot take over that
   reviewed work.
2. Reloads the exact instance and dispatches explicitly as Radarr, Sonarr, or Lidarr.
3. Rebuilds the PCD/config evidence, live Arr evidence, and material plan separately for
   every selected section.
4. Confirms every selected section still matches the review before allowing the first
   write.

If any selected evidence changed or cannot be verified, the entire apply stops with
zero writes. The alert names the affected evidence class and sections, says that nothing
was applied, and keeps the old diff visible as read-only evidence. Choose **Generate a
new preview**, review the replacement diff, and apply that new preview instead. An
invalidated preview cannot be retried.

The entries in a preview are planned changes. After a matched apply begins, confirmed
outcomes show what Arr actually accepted, skipped, or failed and may link to Sync
History. Planned changes and confirmed outcomes are deliberately displayed separately;
a plan is never treated as proof that a remote write happened.

Praxrr validates all selected sections before its first write, but the supported Arr
APIs do not provide one shared transaction or conditional-write mechanism. A separate
external Arr editor can still race between Praxrr's final read and write. If you expect
concurrent edits, coordinate them and generate a fresh preview immediately before Apply.

## Run a sync

- **Sync now** on a section pushes pending changes immediately.
- **Save** persists selection and trigger changes without syncing.
- Background jobs process pending syncs with bounded concurrency across
  instances.

The sync pipeline for each section:

1. Fetch selected entities from the compiled PCD cache.
2. Transform to Arr-specific API payloads.
3. Push creates, updates, and deletes through the Arr REST client.

Logs for each run appear under **Arr → {instance} → Logs**.

## Base ops vs user ops

PCD state has two layers:

- **Base ops:** Published canonical state from the linked repository. Updated
  when you pull upstream changes.
- **User ops:** Local overrides that persist across pulls. Stored as append-only
  SQL operations in `pcd_ops`.

When upstream base ops change the same field you edited locally, Praxrr uses
value guards to detect conflicts. Resolve conflicts on the database **Changes**
or **Conflicts** pages before expecting sync to apply cleanly.

## Pull upstream changes

When the PCD remote has new commits:

1. Open **Databases → {database}** and pull or sync the repository.
2. Review **Changes** for diffs against your local user ops.
3. Resolve conflicts if prompted.
4. Re-run **Preview** on affected instances before syncing.

Non-Git local-path PCD sources skip commit history features but still support
entity editing and sync.

## Conflict resolution

If sync fails because remote Arr state diverged:

1. Check the reviewed-preview alert or preview errors for the affected evidence and
   section.
2. Compare PCD **Changes** with Arr UI state.
3. Adjust user ops or Arr selections, then generate and review a new preview.

Avoid blind force-syncing over manual Arr edits you intend to keep.

## Next steps

- [Quality Profiles](./quality-profiles/) — profile structure and scoring
- [Custom Formats](./custom-formats/) — format entities synced with profiles
- [Troubleshooting](./troubleshooting/) — sync error messages

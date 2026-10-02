---
title: Feature Tour
description: A visual walkthrough of Praxrr — curate, sync, verify, and observe your Arr configuration.
---

A quick visual tour of what Praxrr does, captured from a live instance linked to the default
[Praxrr-DB](https://github.com/yandy-r/praxrr-db) and synced to real Radarr, Sonarr, and Lidarr
instances.

![Praxrr — media automation, perfected in practice](../../../assets/screenshots/hero.png)

## Curate

### Quality profiles

Every profile in a linked configuration database is browsable at a glance — target resolution,
codec and audio focus, expected sizes, and how many custom formats it scores. Profiles are shared
across apps and compiled to each Arr's native format on sync.

![Quality profile catalog](../../../assets/screenshots/quality-profiles.png)

### Per-app custom format scoring

One scoring table drives Radarr, Sonarr, and Lidarr. Scores can differ per app, and each row shows
which apps a custom format applies to. See [Quality Profiles](/guides/quality-profiles/).

![Custom format scoring per Arr app](../../../assets/screenshots/profile-scoring.png)

### Custom formats and conditions

Custom formats are tagged, app-scoped, and built from reusable conditions — resolution, source,
release group, release title patterns, and more. See [Custom Formats](/guides/custom-formats/).

![Custom format catalog](../../../assets/screenshots/custom-formats.png)

![Custom format conditions editor](../../../assets/screenshots/custom-format-conditions.png)

### Shared regular expressions

Patterns are first-class entities shared across custom formats, so a fix lands everywhere at once.
Patterns use .NET-compatible regex syntax, matching the Arr apps.

![Shared regular expressions](../../../assets/screenshots/regular-expressions.png)

### Quality goals

Describe what you want in plain terms — best quality, smallest size, balanced, or 4K HDR — and
fine-tune with sliders. Praxrr shows the generated scores and thresholds before anything is applied.

![Quality goals](../../../assets/screenshots/quality-goals.png)

## Sync

### Connect your Arr instances

Add instances by URL and API key in the UI, or declare them with environment variables. See
[Connecting Arr Instances](/guides/connecting-arr-instances/).

![Arr instances](../../../assets/screenshots/arr-instances.png)

### Choose what to sync

Pick media management configs, quality profiles, and delay profiles per instance, then sync
manually, on pull, on change, or on a schedule. See [Syncing Profiles](/guides/syncing-profiles/).

![Per-instance sync configuration](../../../assets/screenshots/arr-sync.png)

### See your library through your profiles

The library view scores every file against its assigned profile, so you can see at a glance which
releases meet the target, which can still upgrade, and which a profile rejects outright.

![Radarr library with custom format scores](../../../assets/screenshots/arr-library.png)

## Verify

### Score simulator

Paste a release title, pick a profile, and see the parsed metadata, every custom format match, and
the final score — before a single grab happens. Requires the optional parser service.

![Score simulator](../../../assets/screenshots/score-simulator.png)

### Cross-Arr parity map

Radarr, Sonarr, and Lidarr look alike but do not behave alike. The parity map shows which entities
each app supports and documents the known semantic differences Praxrr enforces during sync.

![Cross-Arr parity map](../../../assets/screenshots/parity-map.png)

### Dependency graph and resolved config

Trace which custom formats each profile scores and which patterns each format uses, then inspect the
fully resolved state Praxrr will apply — with the layer each value came from.

![Dependency graph](../../../assets/screenshots/dependency-graph.png)

![Resolved config viewer](../../../assets/screenshots/resolved-config.png)

## Observe

### Sync history

Every sync run is a durable audit entry — trigger, instance, per-section outcome, and the number of
changes applied. Export as JSON or CSV.

![Sync history](../../../assets/screenshots/sync-history.png)

### Drift detection

Scheduled checks compare each instance's live configuration with the resolved PCD state and flag
drifted, missing, or unmanaged entities.

![Drift detection](../../../assets/screenshots/drift.png)

### Database history

Configuration databases are Git repositories. Browse commits, incoming changes, conflicts, local
tweaks, and snapshots for each linked database.

![Database commit history](../../../assets/screenshots/database-commits.png)

### Security posture

A read-only audit of authentication mode and Arr connection transport, with concrete steps to reach
a hardened setup.

![Security posture](../../../assets/screenshots/security-posture.png)

## Next steps

- [Install Praxrr](/getting-started/installation/)
- [Run your first sync](/getting-started/quick-start/)
- [Regenerate these screenshots](/app/screenshots/)

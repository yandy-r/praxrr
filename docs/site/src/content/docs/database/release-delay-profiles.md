---
title: Release & Delay Profiles
description: Curated delay profiles and the status of legacy release profiles.
---

## Delay profiles

The database includes **3 delay profiles**—one per Arr app—each preferring Usenet with
a short Usenet delay:

| Profile                | Preferred protocol | Usenet delay (min) | Torrent delay (min) |
| ---------------------- | ------------------ | -----------------: | ------------------: |
| Prefer Usenet (Lidarr) | prefer_usenet      |                  5 |                   0 |
| Prefer Usenet (Radarr) | prefer_usenet      |                 20 |                   0 |
| Prefer Usenet (Sonarr) | prefer_usenet      |                 10 |                   0 |

All three profiles set `bypassIfHighestQuality: false`, `bypassIfAboveCfScore: false`, and
`minimumCfScore: 0`.

## Release profiles (superseded)

There is **no** `entities/release-profiles/` directory in the current database. Release-profile
behavior is handled through **custom format scores** in quality profiles (for example streaming
service, release group tier, and unwanted CF penalties).

If you migrated from older TRaSH-style release profile lists, map those preferences to CF scores on
the relevant [quality preset](/database/quality-profiles/presets/) instead.

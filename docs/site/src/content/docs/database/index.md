---
title: PCD Database Overview
description: How the curated Praxrr configuration database is structured, versioned, and synced.
---

The **Praxrr Database** (PCD) is the curated configuration package in
[`packages/praxrr-db`](https://github.com/yandy-r/praxrr/tree/main/packages/praxrr-db). It ships
portable entities—custom formats, quality profiles, delay profiles, and Arr-specific defaults—that
Praxrr compiles and syncs to linked Radarr, Sonarr, and Lidarr instances.

Current package version: **0.1.0** (`pcd.json`). Supported Arr types: **radarr**, **sonarr**,
**lidarr**. Minimum Praxrr version: **2.1.0**.

## Data layout

| Directory                       | Contents                                               |
| ------------------------------- | ------------------------------------------------------ |
| `entities/custom-formats/`      | 253 portable custom format definitions                 |
| `entities/quality-profiles/`    | 14 quality profiles (11 shared video + 3 Lidarr audio) |
| `entities/delay-profiles/`      | 3 per-Arr delay profiles                               |
| `entities/media-management/`    | Naming, media settings, quality definitions per Arr    |
| `entities/metadata-profiles/`   | Lidarr metadata profile defaults                       |
| `entities/regular-expressions/` | Shared regex entities referenced by CF conditions      |

YAML under `entities/` is the canonical source. Legacy SQL fixtures were removed during the
SQL-to-YAML cutover; seed data is YAML-only.

## How entities relate

1. **Custom formats** define release matching rules and optional rename tokens.
2. **Quality profiles** assign CF scores, set quality tier order, and define `upgradeUntil` targets.
3. **Delay profiles** control Usenet vs torrent preference and grab delays per Arr app.
4. **Media management** and **metadata profiles** provide Arr-specific defaults bundled with the database.

See [Custom Formats catalog](/database/custom-formats/) and
[Quality Profiles](/database/quality-profiles/) for the full curated set.

## Category legend (custom formats)

Each of the 253 custom formats appears in exactly one documentation category (first tag
match wins):

| Priority | Tag match                                                     | Doc page                                                           |
| -------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1        | Banned, AI-upscale                                            | [Unwanted](/database/custom-formats/unwanted/)                     |
| 2        | Release Group, Release Group Tier                             | [Release Groups](/database/custom-formats/release-groups/)         |
| 3        | Streaming Service                                             | [Streaming Services](/database/custom-formats/streaming-services/) |
| 4        | Audio                                                         | [Audio](/database/custom-formats/audio/)                           |
| 5        | Codec, HDR, Colour Grade                                      | [Codecs & HDR](/database/custom-formats/codecs-hdr/)               |
| 6        | Edition, Flag, Enhancement, Repack, Freeleech, Golden Popcorn | [Editions & Flags](/database/custom-formats/editions-flags/)       |
| 7        | Language, Anime                                               | [Language & Anime](/database/custom-formats/language-anime/)       |
| 8        | (default) Quality, Source, Storage, resolution, SD            | [Resolution & Source](/database/custom-formats/resolution-source/) |

## Sync and versioning

- Link the database in Praxrr setup or point `PRAXRR_DEFAULT_DB_URL` at the published mirror.
- Pull upstream changes to receive new base ops; local user ops persist across pulls.
- Preview instance sync before applying profile or CF changes.

## Related docs

- [Mirror README](/database/readme/) — package README imported at build time
- [Changelog](/database/changelog/) — entity history highlights
- [Lidarr support](/database/lidarr/) — audio profiles and v1 scope
- [Release & delay profiles](/database/release-delay-profiles/)

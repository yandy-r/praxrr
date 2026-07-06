---
title: Custom Formats Catalog
description: Overview of all curated custom formats, scoring tiers, and category groupings.
---

The Praxrr Database defines **253 custom formats** (CFs). Each CF has a name,
description, optional tags, and condition set compiled to Arr-specific payloads on sync.

## Scoring and tiers

Quality profiles assign numeric scores to CFs. Positive scores prefer matching releases; large
negative scores (often **-999999**) block unwanted matches. Tier CFs (for example _1080p Quality
Tier 1_) rank release groups and sources within a profile's target quality band.

Profiles also set `minimumScore`, `upgradeUntilScore`, and `upgradeScoreIncrement` to control
when Radarr or Sonarr upgrades existing files.

## Category index

| Category                                                           | Count | Summary                                                                    |
| ------------------------------------------------------------------ | ----: | -------------------------------------------------------------------------- |
| [Audio](/database/custom-formats/audio/)                           |    20 | Custom formats for audio codecs and channel layouts.                       |
| [Codecs & HDR](/database/custom-formats/codecs-hdr/)               |    22 | Custom formats for video codecs, HDR, and colour grading.                  |
| [Editions & Flags](/database/custom-formats/editions-flags/)       |    21 | Custom formats for editions, flags, enhancements, repacks, and freeleech.  |
| [Language & Anime](/database/custom-formats/language-anime/)       |    10 | Custom formats for language rules and anime-specific matching.             |
| [Release Groups](/database/custom-formats/release-groups/)         |    94 | Custom formats for release group names and tier rankings.                  |
| [Resolution & Source](/database/custom-formats/resolution-source/) |    42 | Custom formats for resolution, source type, quality tiers, and SD content. |
| [Streaming Services](/database/custom-formats/streaming-services/) |    32 | Custom formats that identify streaming platform WEB-DLs.                   |
| [Unwanted & Banned](/database/custom-formats/unwanted/)            |    12 | Custom formats that block or penalize unwanted releases.                   |

## Primary category rule

When a CF has multiple tags, documentation lists it under the **first** matching category in the
priority table on the [database overview](/database/). This keeps each format documented exactly once
while preserving all tags in the table.

## Arr scope

Most video CFs use `arrType: all` or separate Radarr/Sonarr scores in profiles. Lidarr-specific
CFs are documented in the [Lidarr guide](/database/lidarr/).

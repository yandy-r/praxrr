---
title: Quality Profiles
description: How curated quality profiles structure tiers, upgrades, and custom format scoring.
---

The database ships **14 quality profiles**: **11 shared video presets** for Radarr and Sonarr, plus
**3 Lidarr audio profiles**. Video presets share the same CF score mappings per Arr type; only
Lidarr profiles use `arrType: lidarr` scores.

## Profile mechanics

| Field                | Purpose                                                                |
| -------------------- | ---------------------------------------------------------------------- |
| `orderedItems`       | Quality tier order; groups collapse multiple source qualities          |
| `upgradeUntil`       | Marks the target tier for automatic upgrades                           |
| `minimumScore`       | Minimum total CF score for a grab                                      |
| `upgradeUntilScore`  | Score ceiling that stops upgrades                                      |
| `customFormatScores` | Per-CF scores keyed by `arrType` (`radarr`, `sonarr`, `all`, `lidarr`) |

## Video presets

Shared Radarr + Sonarr presets are documented in [Presets](/database/quality-profiles/presets/).

| Profile           | Tags                                                    |
| ----------------- | ------------------------------------------------------- |
| 1080p Balanced    | 1080p, Balanced Focused, Lossy Audio, h264, x264        |
| 1080p Compact     | 1080p, Compact Focused, Lossy Audio, h265, x265         |
| 1080p Efficient   | 1080p, Efficient Focused, Lossy Audio, h265, x265       |
| 1080p Quality     | 1080p, Lossy Audio, Quality Focused, h264, x264         |
| 1080p Quality HDR | 1080p, HDR, Lossy Audio, Quality Focused, x264, x265    |
| 1080p Remux       | 1080p, Lossless Audio, Remux Focused, h264, x264, x265  |
| 2160p Balanced    | 2160p, Balanced Focused, HDR, Lossy Audio, h265, x264   |
| 2160p Efficient   | 2160p, Efficient Focused, Lossy Audio, h265, x265       |
| 2160p Quality     | 2160p, HDR, Lossless Audio, Quality Focused, h265, x265 |
| 2160p Remux       | 2160p, HDR, Lossless Audio, Remux Focused, h265, x265   |
| 720p Quality      | 720p, Lossy Audio, Quality Focused, h264, x264          |

## Lidarr audio profiles

Lidarr profiles are covered in the [Lidarr guide](/database/lidarr/):

- **Lidarr - Lossy (Praxrr)**
- **Lidarr - High Quality Lossy (Praxrr)**
- **Lidarr - Lossless (Praxrr)**

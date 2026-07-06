---
title: sonarr_naming
description: Sonarr file and folder naming configuration.
---

## Purpose

Sonarr naming configuration with episode, series, and season folder format strings plus multi-episode style settings.

## Columns

| Column                            | Type         | Nullable | Default           | Description |
| --------------------------------- | ------------ | -------- | ----------------- | ----------- |
| `name`                            | VARCHAR(100) | No       | —                 | —           |
| `rename`                          | INTEGER      | No       | 1                 | —           |
| `standard_episode_format`         | TEXT         | No       | —                 | —           |
| `daily_episode_format`            | TEXT         | No       | —                 | —           |
| `anime_episode_format`            | TEXT         | No       | —                 | —           |
| `series_folder_format`            | TEXT         | No       | —                 | —           |
| `season_folder_format`            | TEXT         | No       | —                 | —           |
| `replace_illegal_characters`      | INTEGER      | No       | 1                 | —           |
| `colon_replacement_format`        | INTEGER      | No       | 4                 | —           |
| `custom_colon_replacement_format` | TEXT         | Yes      | —                 | —           |
| `multi_episode_style`             | INTEGER      | No       | 5                 | —           |
| `created_at`                      | TEXT         | No       | CURRENT_TIMESTAMP | —           |
| `updated_at`                      | TEXT         | No       | CURRENT_TIMESTAMP | —           |

## Relationships

No foreign key relationships.

## Constraints

- **Primary key:** (name)
- **Arr-type note:** Sonarr-only. `colon_replacement_format` is an integer (default 4), unlike Radarr string enum. Includes `standard_episode_format`, `daily_episode_format`, and `anime_episode_format`.

## Related

- See [Structure](/schema/structure/) for arr-specific media management overview.

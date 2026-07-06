---
title: lidarr_naming
description: Lidarr file and folder naming configuration.
---

## Purpose

Lidarr naming configuration with track and artist folder format strings. Uses integer `colon_replacement_format` like Sonarr.

## Columns

| Column                            | Type         | Nullable | Default           | Description |
| --------------------------------- | ------------ | -------- | ----------------- | ----------- |
| `name`                            | VARCHAR(100) | No       | —                 | —           |
| `rename`                          | INTEGER      | No       | 1                 | —           |
| `standard_track_format`           | TEXT         | No       | —                 | —           |
| `artist_name`                     | TEXT         | No       | —                 | —           |
| `multi_disc_track_format`         | TEXT         | No       | —                 | —           |
| `artist_folder_format`            | TEXT         | No       | —                 | —           |
| `replace_illegal_characters`      | INTEGER      | No       | 1                 | —           |
| `colon_replacement_format`        | INTEGER      | No       | 4                 | —           |
| `custom_colon_replacement_format` | TEXT         | Yes      | —                 | —           |
| `created_at`                      | TEXT         | No       | CURRENT_TIMESTAMP | —           |
| `updated_at`                      | TEXT         | No       | CURRENT_TIMESTAMP | —           |

## Relationships

No foreign key relationships.

## Constraints

- **Primary key:** (name)
- **Arr-type note:** Lidarr-only. Columns include `standard_track_format`, `multi_disc_track_format`, and `artist_folder_format` — distinct from Radarr movie or Sonarr episode formats.

## Related

- See [Structure](/schema/structure/) for arr-specific media management overview.

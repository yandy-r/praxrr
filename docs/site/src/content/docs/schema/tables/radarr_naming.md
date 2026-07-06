---
title: radarr_naming
description: Radarr file and folder naming configuration.
---

## Purpose

Radarr naming configuration with movie-specific format strings. Supports named configurations referenced during Radarr sync.

## Columns

| Column                       | Type         | Nullable | Default           | Description |
| ---------------------------- | ------------ | -------- | ----------------- | ----------- |
| `name`                       | VARCHAR(100) | No       | —                 | —           |
| `rename`                     | INTEGER      | No       | 1                 | —           |
| `movie_format`               | TEXT         | No       | —                 | —           |
| `movie_folder_format`        | TEXT         | No       | —                 | —           |
| `replace_illegal_characters` | INTEGER      | No       | 1                 | —           |
| `colon_replacement_format`   | VARCHAR(20)  | No       | 'smart'           | —           |
| `created_at`                 | TEXT         | No       | CURRENT_TIMESTAMP | —           |
| `updated_at`                 | TEXT         | No       | CURRENT_TIMESTAMP | —           |

## Relationships

No foreign key relationships.

## Constraints

- **Primary key:** (name)
- **CHECK:** CHECK (colon_replacement_format IN ('delete', 'dash', 'spaceDash', 'spaceDashSpace', 'smart'))
- CHECK on `colon_replacement_format`: `delete`, `dash`, `spaceDash`, `spaceDashSpace`, `smart`.
- **Arr-type note:** Radarr-only. `colon_replacement_format` uses string enum values (`delete`, `dash`, `spaceDash`, `spaceDashSpace`, `smart`). Sonarr uses an integer enum for the same concept — do not assume parity.

## Related

- See [Structure](/schema/structure/) for arr-specific media management overview.

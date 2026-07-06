---
title: quality_api_mappings
description: Maps canonical Praxrr qualities to arr-specific API names.
---

## Purpose

Translates canonical Praxrr quality names to arr-specific API names. Absence of a row means the quality does not exist for that arr type. Most names are identical across applications, but some differ (for example, `Remux-1080p` maps to `Bluray-1080p Remux` in Sonarr).

## Columns

| Column         | Type         | Nullable | Default           | Description        |
| -------------- | ------------ | -------- | ----------------- | ------------------ |
| `quality_name` | VARCHAR(100) | No       | —                 | —                  |
| `arr_type`     | VARCHAR(20)  | No       | —                 | 'radarr', 'sonarr' |
| `api_name`     | VARCHAR(100) | No       | —                 | —                  |
| `created_at`   | TEXT         | No       | CURRENT_TIMESTAMP | —                  |

## Relationships

**References:**

- [qualities](/schema/tables/qualities/) — qualities (quality_name)

- FOREIGN KEY (quality_name) REFERENCES qualities(name) ON DELETE CASCADE ON UPDATE CASCADE

## Constraints

- **Primary key:** (quality_name, arr_type)
- **Arr-type note:** The `arr_type` column is `'radarr'` or `'sonarr'` in current seed data. Lidarr mappings use the same table pattern with `arr_type = 'lidarr'`. Do not assume API name parity across arr types.

## Related

- [qualities](/schema/tables/qualities/)

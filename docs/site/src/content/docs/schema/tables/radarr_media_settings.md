---
title: radarr_media_settings
description: Radarr general media settings.
---

## Purpose

Radarr general media settings including propers/repacks preference and media info probing.

## Columns

| Column              | Type         | Nullable | Default           | Description |
| ------------------- | ------------ | -------- | ----------------- | ----------- |
| `name`              | VARCHAR(100) | No       | —                 | —           |
| `propers_repacks`   | VARCHAR(50)  | No       | 'doNotPrefer'     | —           |
| `enable_media_info` | INTEGER      | No       | 1                 | —           |
| `created_at`        | TEXT         | No       | CURRENT_TIMESTAMP | —           |
| `updated_at`        | TEXT         | No       | CURRENT_TIMESTAMP | —           |

## Relationships

No foreign key relationships.

## Constraints

- **Primary key:** (name)
- **CHECK:** CHECK (propers_repacks IN ('doNotPrefer', 'preferAndUpgrade', 'doNotUpgradeAutomatically'))
- CHECK on `propers_repacks`: `doNotPrefer`, `preferAndUpgrade`, `doNotUpgradeAutomatically`.
- **Arr-type note:** Radarr-only. `propers_repacks` CHECK values match Sonarr but column sets differ from Lidarr media settings.

## Related

- See [Structure](/schema/structure/) for arr-specific media management overview.

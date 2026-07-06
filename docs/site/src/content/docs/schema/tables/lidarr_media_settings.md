---
title: lidarr_media_settings
description: Lidarr general media settings.
---

## Purpose

Lidarr general media settings including propers/repacks preference and media info probing.

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
- **Arr-type note:** Lidarr-only. Same CHECK constraint on `propers_repacks` as Radarr/Sonarr but no cross-arr column parity beyond that.

## Related

- See [Structure](/schema/structure/) for arr-specific media management overview.

---
title: lidarr_metadata_profiles
description: Lidarr metadata profile definitions.
---

## Purpose

Lidarr metadata profiles define which primary types, secondary types, and release statuses are allowed when syncing to Lidarr. Lidarr-specific; no Radarr or Sonarr equivalent.

## Columns

| Column        | Type         | Nullable | Default           | Description |
| ------------- | ------------ | -------- | ----------------- | ----------- |
| `id`          | INTEGER      | Yes      | —                 | —           |
| `name`        | VARCHAR(100) | No       | —                 | —           |
| `description` | TEXT         | Yes      | —                 | —           |
| `created_at`  | TEXT         | No       | CURRENT_TIMESTAMP | —           |
| `updated_at`  | TEXT         | No       | CURRENT_TIMESTAMP | —           |

## Relationships

**Referenced by:**

- [lidarr_metadata_profile_primary_types](/schema/tables/lidarr_metadata_profile_primary_types/)
- [lidarr_metadata_profile_secondary_types](/schema/tables/lidarr_metadata_profile_secondary_types/)
- [lidarr_metadata_profile_release_statuses](/schema/tables/lidarr_metadata_profile_release_statuses/)

## Constraints

- **Primary key:** (id)
- **Unique:** UNIQUE (name)
- **Arr-type note:** Lidarr-only metadata profile system with no Radarr/Sonarr counterpart.

## Related

- [lidarr_metadata_profile_primary_types](/schema/tables/lidarr_metadata_profile_primary_types/)
- [lidarr_metadata_profile_secondary_types](/schema/tables/lidarr_metadata_profile_secondary_types/)
- [lidarr_metadata_profile_release_statuses](/schema/tables/lidarr_metadata_profile_release_statuses/)

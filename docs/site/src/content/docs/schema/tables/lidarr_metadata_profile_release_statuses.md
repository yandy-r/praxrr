---
title: lidarr_metadata_profile_release_statuses
description: Release status allowances for Lidarr metadata profiles.
---

## Purpose

Stores release status rows for each Lidarr metadata profile. The `allowed` flag controls whether the status is permitted.

## Columns

| Column                  | Type         | Nullable | Default | Description |
| ----------------------- | ------------ | -------- | ------- | ----------- |
| `metadata_profile_name` | VARCHAR(100) | No       | —       | —           |
| `status_id`             | INTEGER      | No       | —       | —           |
| `name`                  | VARCHAR(100) | No       | —       | —           |
| `allowed`               | INTEGER      | No       | 0       | —           |

## Relationships

**References:**

- [lidarr_metadata_profiles](/schema/tables/lidarr_metadata_profiles/) — lidarr_metadata_profiles (metadata_profile_name)

- FOREIGN KEY (metadata_profile_name) REFERENCES lidarr_metadata_profiles(name) ON DELETE CASCADE ON UPDATE CASCADE

## Constraints

- **Primary key:** (metadata_profile_name, status_id)
- **Arr-type note:** Lidarr-only.

## Related

- [lidarr_metadata_profiles](/schema/tables/lidarr_metadata_profiles/)

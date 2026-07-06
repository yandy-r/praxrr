---
title: quality_groups
description: Groups of equivalent qualities within a single profile.
---

## Purpose

Quality groups combine multiple qualities treated as equivalent within a single profile. Groups are profile-scoped: the UNIQUE constraint on `(quality_profile_name, name)` means two profiles can each have a group called `HD` with different member qualities.

## Columns

| Column                 | Type         | Nullable | Default           | Description |
| ---------------------- | ------------ | -------- | ----------------- | ----------- |
| `id`                   | INTEGER      | Yes      | —                 | —           |
| `quality_profile_name` | VARCHAR(100) | No       | —                 | —           |
| `name`                 | VARCHAR(100) | No       | —                 | —           |
| `created_at`           | TEXT         | No       | CURRENT_TIMESTAMP | —           |
| `updated_at`           | TEXT         | No       | CURRENT_TIMESTAMP | —           |

## Relationships

**References:**

- [quality_profiles](/schema/tables/quality_profiles/) — quality_profiles (quality_profile_name)

**Referenced by:**

- [quality_group_members](/schema/tables/quality_group_members/)
- [quality_profile_qualities](/schema/tables/quality_profile_qualities/)

- FOREIGN KEY (quality_profile_name) REFERENCES quality_profiles(name) ON DELETE CASCADE ON UPDATE CASCADE

## Constraints

- **Primary key:** (id)
- **Unique:** UNIQUE(quality_profile_name, name)

## Related

- [quality_profiles](/schema/tables/quality_profiles/)
- [quality_group_members](/schema/tables/quality_group_members/)
- [quality_profile_qualities](/schema/tables/quality_profile_qualities/)

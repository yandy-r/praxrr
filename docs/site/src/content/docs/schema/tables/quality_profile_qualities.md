---
title: quality_profile_qualities
description: Ordered quality list for a profile.
---

## Purpose

Orders qualities and quality groups within a profile by `position`. Each row references either a single quality or a quality group (never both). The `enabled` flag controls activation; `upgrade_until` marks the upgrade ceiling (at most one per profile).

## Columns

| Column                 | Type         | Nullable | Default | Description                                                 |
| ---------------------- | ------------ | -------- | ------- | ----------------------------------------------------------- |
| `id`                   | INTEGER      | Yes      | —       | —                                                           |
| `quality_profile_name` | VARCHAR(100) | No       | —       | —                                                           |
| `quality_name`         | VARCHAR(100) | Yes      | —       | References a single quality by name                         |
| `quality_group_name`   | VARCHAR(100) | Yes      | —       | OR references a quality group by name (within this profile) |
| `position`             | INTEGER      | No       | —       | Display order in the profile                                |
| `enabled`              | INTEGER      | No       | 1       | Whether this quality/group is enabled                       |
| `upgrade_until`        | INTEGER      | No       | 0       | Stop upgrading at this quality                              |

## Relationships

**References:**

- [quality_profiles](/schema/tables/quality_profiles/) — quality_profiles (quality_profile_name)
- [qualities](/schema/tables/qualities/) — qualities (quality_name)
- [quality_groups](/schema/tables/quality_groups/) — quality_groups (quality_profile_name, quality_group_name)

- FOREIGN KEY (quality_profile_name) REFERENCES quality_profiles(name) ON DELETE CASCADE ON UPDATE CASCADE
- FOREIGN KEY (quality_name) REFERENCES qualities(name) ON DELETE CASCADE ON UPDATE CASCADE
- FOREIGN KEY (quality_profile_name, quality_group_name) REFERENCES quality_groups(quality_profile_name, name) ON DELETE CASCADE ON UPDATE CASCADE

## Constraints

- **Primary key:** (id)
- **CHECK:** CHECK ((quality_name IS NOT NULL AND quality_group_name IS NULL) OR (quality_name IS NULL AND quality_group_name IS NOT NULL))
- CHECK: exactly one of `quality_name` or `quality_group_name` must be set.
- Partial unique index `idx_one_upgrade_until_per_profile` enforces at most one `upgrade_until = 1` row per profile.

## Related

- [quality_profiles](/schema/tables/quality_profiles/)
- [qualities](/schema/tables/qualities/)
- [quality_groups](/schema/tables/quality_groups/)

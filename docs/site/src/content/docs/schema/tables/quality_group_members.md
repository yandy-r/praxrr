---
title: quality_group_members
description: Defines which qualities belong to which quality groups.
---

## Purpose

All qualities in a group are treated as equivalent. Uses composite stable keys `(quality_profile_name, quality_group_name)` and `quality_name`.

## Columns

| Column                 | Type         | Nullable | Default | Description |
| ---------------------- | ------------ | -------- | ------- | ----------- |
| `quality_profile_name` | VARCHAR(100) | No       | —       | —           |
| `quality_group_name`   | VARCHAR(100) | No       | —       | —           |
| `quality_name`         | VARCHAR(100) | No       | —       | —           |

## Relationships

**References:**

- [quality_groups](/schema/tables/quality_groups/) — quality_groups (quality_profile_name, quality_group_name)
- [qualities](/schema/tables/qualities/) — qualities (quality_name)

- FOREIGN KEY (quality_profile_name, quality_group_name) REFERENCES quality_groups(quality_profile_name, name) ON DELETE CASCADE ON UPDATE CASCADE
- FOREIGN KEY (quality_name) REFERENCES qualities(name) ON DELETE CASCADE ON UPDATE CASCADE

## Constraints

- **Primary key:** (quality_profile_name, quality_group_name, quality_name)

## Related

- [quality_groups](/schema/tables/quality_groups/)
- [qualities](/schema/tables/qualities/)

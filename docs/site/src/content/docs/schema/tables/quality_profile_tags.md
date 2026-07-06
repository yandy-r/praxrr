---
title: quality_profile_tags
description: Junction table linking quality profiles to tags.
---

## Purpose

Links quality profiles to tags using stable name-based composite keys.

## Columns

| Column                 | Type         | Nullable | Default | Description |
| ---------------------- | ------------ | -------- | ------- | ----------- |
| `quality_profile_name` | VARCHAR(100) | No       | —       | —           |
| `tag_name`             | VARCHAR(50)  | No       | —       | —           |

## Relationships

**References:**

- [quality_profiles](/schema/tables/quality_profiles/) — quality_profiles (quality_profile_name)
- [tags](/schema/tables/tags/) — tags (tag_name)

- FOREIGN KEY (quality_profile_name) REFERENCES quality_profiles(name) ON DELETE CASCADE ON UPDATE CASCADE
- FOREIGN KEY (tag_name) REFERENCES tags(name) ON DELETE CASCADE ON UPDATE CASCADE

## Constraints

- **Primary key:** (quality_profile_name, tag_name)

## Related

- [quality_profiles](/schema/tables/quality_profiles/)
- [tags](/schema/tables/tags/)

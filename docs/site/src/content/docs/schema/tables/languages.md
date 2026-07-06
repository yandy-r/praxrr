---
title: languages
description: Languages for profile configuration and custom format conditions.
---

## Purpose

Languages used for quality profile language requirements and language-type custom format conditions. Seeded with 64 entries sourced from Radarr and Sonarr upstream, including special values such as `Unknown`, `Any`, and `Original`.

## Columns

| Column       | Type        | Nullable | Default           | Description |
| ------------ | ----------- | -------- | ----------------- | ----------- |
| `id`         | INTEGER     | Yes      | —                 | —           |
| `name`       | VARCHAR(30) | No       | —                 | —           |
| `created_at` | TEXT        | No       | CURRENT_TIMESTAMP | —           |
| `updated_at` | TEXT        | No       | CURRENT_TIMESTAMP | —           |

## Relationships

**Referenced by:**

- [quality_profile_languages](/schema/tables/quality_profile_languages/)
- [condition_languages](/schema/tables/condition_languages/)

## Constraints

- **Primary key:** (id)
- **Unique:** UNIQUE (name)

## Related

- [quality_profile_languages](/schema/tables/quality_profile_languages/)
- [condition_languages](/schema/tables/condition_languages/)

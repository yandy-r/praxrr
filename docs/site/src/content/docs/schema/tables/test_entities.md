---
title: test_entities
description: Movies and series used for quality profile testing.
---

## Purpose

Stores real movies and series from TMDB for quality profile testing. Composite UNIQUE on `(type, tmdb_id)` ensures each entity is registered once.

## Columns

| Column        | Type    | Nullable | Default           | Description |
| ------------- | ------- | -------- | ----------------- | ----------- |
| `id`          | INTEGER | Yes      | —                 | —           |
| `type`        | TEXT    | No       | —                 | —           |
| `tmdb_id`     | INTEGER | No       | —                 | —           |
| `title`       | TEXT    | No       | —                 | —           |
| `year`        | INTEGER | Yes      | —                 | —           |
| `poster_path` | TEXT    | Yes      | —                 | —           |
| `created_at`  | TEXT    | No       | CURRENT_TIMESTAMP | —           |
| `updated_at`  | TEXT    | No       | CURRENT_TIMESTAMP | —           |

## Relationships

**Referenced by:**

- [test_releases](/schema/tables/test_releases/)

## Constraints

- **Primary key:** (id)
- **Unique:** UNIQUE(type, tmdb_id)
- **CHECK:** type: CHECK (type IN ('movie', 'series')
- CHECK on `type`: `movie`, `series`.

## Related

- [test_releases](/schema/tables/test_releases/)

---
title: test_releases
description: Sample releases attached to test entities.
---

## Purpose

Sample releases attached to test entities via composite FK `(entity_type, entity_tmdb_id)`. The `languages`, `indexers`, and `flags` columns store JSON arrays as TEXT.

## Columns

| Column           | Type    | Nullable | Default           | Description |
| ---------------- | ------- | -------- | ----------------- | ----------- |
| `id`             | INTEGER | Yes      | —                 | —           |
| `entity_type`    | TEXT    | No       | —                 | —           |
| `entity_tmdb_id` | INTEGER | No       | —                 | —           |
| `title`          | TEXT    | No       | —                 | —           |
| `size_bytes`     | INTEGER | Yes      | —                 | —           |
| `languages`      | TEXT    | No       | '[]'              | —           |
| `indexers`       | TEXT    | No       | '[]'              | —           |
| `flags`          | TEXT    | No       | '[]'              | —           |
| `created_at`     | TEXT    | No       | CURRENT_TIMESTAMP | —           |
| `updated_at`     | TEXT    | No       | CURRENT_TIMESTAMP | —           |

## Relationships

**References:**

- [test_entities](/schema/tables/test_entities/) — test_entities (entity_type, entity_tmdb_id)

- FOREIGN KEY (entity_type, entity_tmdb_id) REFERENCES test_entities(type, tmdb_id) ON DELETE CASCADE

## Constraints

- **Primary key:** (id)
- **CHECK:** entity_type: CHECK (entity_type IN ('movie', 'series')
- CHECK on `entity_type`: `movie`, `series`.
- Index `idx_test_releases_entity` on `(entity_type, entity_tmdb_id)`.

## Related

- [test_entities](/schema/tables/test_entities/)

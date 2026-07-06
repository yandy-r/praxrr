---
title: lidarr_quality_definitions
description: Lidarr quality size definitions.
---

## Purpose

Lidarr-specific quality size limits keyed by configuration `name` and canonical `quality_name`. Used when syncing quality definitions to Lidarr instances.

## Columns

| Column           | Type         | Nullable | Default           | Description |
| ---------------- | ------------ | -------- | ----------------- | ----------- |
| `name`           | VARCHAR(100) | No       | —                 | —           |
| `quality_name`   | VARCHAR(100) | No       | —                 | —           |
| `min_size`       | INTEGER      | No       | 0                 | —           |
| `max_size`       | INTEGER      | No       | —                 | —           |
| `preferred_size` | INTEGER      | No       | —                 | —           |
| `created_at`     | TEXT         | No       | CURRENT_TIMESTAMP | —           |
| `updated_at`     | TEXT         | No       | CURRENT_TIMESTAMP | —           |

## Relationships

**References:**

- [qualities](/schema/tables/qualities/) — qualities (quality_name)

- FOREIGN KEY (quality_name) REFERENCES qualities(name) ON DELETE CASCADE ON UPDATE CASCADE

## Constraints

- **Primary key:** (name, quality_name)
- **Arr-type note:** Lidarr-only table. Radarr and Sonarr use sibling tables with the same shape but separate rows.

## Related

- [qualities](/schema/tables/qualities/)

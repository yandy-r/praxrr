---
title: radarr_quality_definitions
description: Radarr quality size definitions.
---

## Purpose

Radarr-specific quality size limits (min, max, preferred) keyed by configuration `name` and canonical `quality_name`. Used when syncing quality definitions to Radarr instances.

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
- **Arr-type note:** Radarr-only table. Sonarr and Lidarr use sibling tables with the same shape but separate rows.

## Related

- [qualities](/schema/tables/qualities/)

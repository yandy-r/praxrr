---
title: qualities
description: Individual quality definitions (video and audio).
---

## Purpose

Individual quality definitions such as `1080p Bluray` or `2160p REMUX`. Contains video qualities from Radarr/Sonarr and audio qualities from Lidarr. The canonical `name` is the stable FK reference across all tables.

## Columns

| Column       | Type         | Nullable | Default           | Description |
| ------------ | ------------ | -------- | ----------------- | ----------- |
| `id`         | INTEGER      | Yes      | —                 | —           |
| `name`       | VARCHAR(100) | No       | —                 | —           |
| `created_at` | TEXT         | No       | CURRENT_TIMESTAMP | —           |
| `updated_at` | TEXT         | No       | CURRENT_TIMESTAMP | —           |

## Relationships

**Referenced by:**

- [quality_api_mappings](/schema/tables/quality_api_mappings/)
- [quality_group_members](/schema/tables/quality_group_members/)
- [quality_profile_qualities](/schema/tables/quality_profile_qualities/)
- [radarr_quality_definitions](/schema/tables/radarr_quality_definitions/)
- [sonarr_quality_definitions](/schema/tables/sonarr_quality_definitions/)
- [lidarr_quality_definitions](/schema/tables/lidarr_quality_definitions/)

## Constraints

- **Primary key:** (id)
- **Unique:** UNIQUE (name)

## Related

- [quality_api_mappings](/schema/tables/quality_api_mappings/)
- [quality_group_members](/schema/tables/quality_group_members/)
- [quality_profile_qualities](/schema/tables/quality_profile_qualities/)
- [radarr_quality_definitions](/schema/tables/radarr_quality_definitions/)
- [sonarr_quality_definitions](/schema/tables/sonarr_quality_definitions/)
- [lidarr_quality_definitions](/schema/tables/lidarr_quality_definitions/)

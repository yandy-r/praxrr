---
title: Tables
description: Categorized index of all 42 PCD schema tables with links to per-table reference pages.
---

This index lists all 42 tables defined in `0.schema.sql`. Each page documents purpose, columns,
relationships, and constraints. The DDL in [`packages/praxrr-schema/ops/0.schema.sql`](https://github.com/yandy-r/praxrr/blob/main/packages/praxrr-schema/ops/0.schema.sql) is the authority for column definitions.

Cross-cutting references:

- [Condition Types](/schema/condition-types/) — the nine condition types and dispatch model
- [Migration Paths](/schema/migrations/) — OSQL, layers, and value guards

## Core entities (6)

Independent tables with no foreign key dependencies. Can be populated in any order.

| Table                                                        | Description                               |
| ------------------------------------------------------------ | ----------------------------------------- |
| [tags](/schema/tables/tags/)                                 | Reusable labels for multiple entity types |
| [languages](/schema/tables/languages/)                       | Languages for profiles and conditions     |
| [regular_expressions](/schema/tables/regular_expressions/)   | Regex patterns for pattern conditions     |
| [qualities](/schema/tables/qualities/)                       | Individual quality definitions            |
| [quality_api_mappings](/schema/tables/quality_api_mappings/) | Canonical-to-arr API name mappings        |
| [custom_formats](/schema/tables/custom_formats/)             | Custom format definitions                 |

## Profiles and junctions (10)

Quality profiles, quality groups, condition dispatch, and many-to-many junction tables.

| Table                                                                            | Description                                |
| -------------------------------------------------------------------------------- | ------------------------------------------ |
| [quality_profiles](/schema/tables/quality_profiles/)                             | Media acquisition strategy definitions     |
| [quality_groups](/schema/tables/quality_groups/)                                 | Equivalent quality groups within a profile |
| [custom_format_conditions](/schema/tables/custom_format_conditions/)             | Condition parent table (type dispatch)     |
| [regular_expression_tags](/schema/tables/regular_expression_tags/)               | Regex ↔ tag junction                       |
| [custom_format_tags](/schema/tables/custom_format_tags/)                         | Custom format ↔ tag junction               |
| [quality_profile_tags](/schema/tables/quality_profile_tags/)                     | Profile ↔ tag junction                     |
| [quality_profile_languages](/schema/tables/quality_profile_languages/)           | Profile language requirements              |
| [quality_group_members](/schema/tables/quality_group_members/)                   | Qualities belonging to groups              |
| [quality_profile_qualities](/schema/tables/quality_profile_qualities/)           | Ordered profile quality list               |
| [quality_profile_custom_formats](/schema/tables/quality_profile_custom_formats/) | Custom format scores per profile           |

## Condition types (9)

Type-specific child tables keyed by `(custom_format_name, condition_name)`.

| Table                                                                      | Condition type     |
| -------------------------------------------------------------------------- | ------------------ |
| [condition_patterns](/schema/tables/condition_patterns/)                   | `pattern`          |
| [condition_languages](/schema/tables/condition_languages/)                 | `language`         |
| [condition_indexer_flags](/schema/tables/condition_indexer_flags/)         | `indexer_flag`     |
| [condition_sources](/schema/tables/condition_sources/)                     | `source`           |
| [condition_resolutions](/schema/tables/condition_resolutions/)             | `resolution`       |
| [condition_quality_modifiers](/schema/tables/condition_quality_modifiers/) | `quality_modifier` |
| [condition_sizes](/schema/tables/condition_sizes/)                         | `size`             |
| [condition_release_types](/schema/tables/condition_release_types/)         | `release_type`     |
| [condition_years](/schema/tables/condition_years/)                         | `year`             |

## Media management (9)

Arr-specific configuration tables. Each arr type has separate tables — do not assume column parity.

| Table                                                                    | Arr type |
| ------------------------------------------------------------------------ | -------- |
| [radarr_quality_definitions](/schema/tables/radarr_quality_definitions/) | Radarr   |
| [sonarr_quality_definitions](/schema/tables/sonarr_quality_definitions/) | Sonarr   |
| [lidarr_quality_definitions](/schema/tables/lidarr_quality_definitions/) | Lidarr   |
| [radarr_naming](/schema/tables/radarr_naming/)                           | Radarr   |
| [sonarr_naming](/schema/tables/sonarr_naming/)                           | Sonarr   |
| [lidarr_naming](/schema/tables/lidarr_naming/)                           | Lidarr   |
| [radarr_media_settings](/schema/tables/radarr_media_settings/)           | Radarr   |
| [sonarr_media_settings](/schema/tables/sonarr_media_settings/)           | Sonarr   |
| [lidarr_media_settings](/schema/tables/lidarr_media_settings/)           | Lidarr   |

## Lidarr metadata, delay, and testing (8)

| Table                                                                                                | Description                              |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [lidarr_metadata_profiles](/schema/tables/lidarr_metadata_profiles/)                                 | Lidarr metadata profile definitions      |
| [lidarr_metadata_profile_primary_types](/schema/tables/lidarr_metadata_profile_primary_types/)       | Primary type allowances                  |
| [lidarr_metadata_profile_secondary_types](/schema/tables/lidarr_metadata_profile_secondary_types/)   | Secondary type allowances                |
| [lidarr_metadata_profile_release_statuses](/schema/tables/lidarr_metadata_profile_release_statuses/) | Release status allowances                |
| [delay_profiles](/schema/tables/delay_profiles/)                                                     | Download timing and protocol preferences |
| [custom_format_tests](/schema/tables/custom_format_tests/)                                           | Custom format matching test cases        |
| [test_entities](/schema/tables/test_entities/)                                                       | TMDB movies/series for profile testing   |
| [test_releases](/schema/tables/test_releases/)                                                       | Sample releases for test entities        |

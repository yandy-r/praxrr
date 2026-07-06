---
title: delay_profiles
description: Download timing and protocol preferences.
---

## Purpose

Delay profiles control download timing preferences. Tags were removed because Radarr/Sonarr only allow updating the default profile (id=1) with empty tags. Only one delay profile can be synced per arr instance.

## Columns

| Column                                | Type         | Nullable | Default           | Description                                                      |
| ------------------------------------- | ------------ | -------- | ----------------- | ---------------------------------------------------------------- |
| `id`                                  | INTEGER      | Yes      | —                 | —                                                                |
| `name`                                | VARCHAR(100) | No       | —                 | —                                                                |
| `preferred_protocol`                  | VARCHAR(20)  | No       | —                 | `prefer_usenet`, `prefer_torrent`, `only_usenet`, `only_torrent` |
| `usenet_delay`                        | INTEGER      | Yes      | —                 | minutes, NULL if only_torrent                                    |
| `torrent_delay`                       | INTEGER      | Yes      | —                 | minutes, NULL if only_usenet                                     |
| `bypass_if_highest_quality`           | INTEGER      | No       | 0                 | —                                                                |
| `bypass_if_above_custom_format_score` | INTEGER      | No       | 0                 | —                                                                |
| `minimum_custom_format_score`         | INTEGER      | Yes      | —                 | Required when bypass_if_above_custom_format_score = 1            |
| `created_at`                          | TEXT         | No       | CURRENT_TIMESTAMP | —                                                                |
| `updated_at`                          | TEXT         | No       | CURRENT_TIMESTAMP | —                                                                |

## Relationships

No foreign key relationships.

## Constraints

- **Primary key:** (id)
- **Unique:** UNIQUE (name)
- **CHECK:** `preferred_protocol IN ('prefer_usenet', 'prefer_torrent', 'only_usenet', 'only_torrent')`
- **CHECK:** `usenet_delay` is NULL if and only if `preferred_protocol = 'only_torrent'`
- **CHECK:** `torrent_delay` is NULL if and only if `preferred_protocol = 'only_usenet'`
- **CHECK:** `minimum_custom_format_score` is NOT NULL if and only if `bypass_if_above_custom_format_score = 1`

## Related

- See [Structure](/schema/structure/) for arr-specific media management overview.

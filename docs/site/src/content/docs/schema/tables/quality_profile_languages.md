---
title: quality_profile_languages
description: Links quality profiles to languages with type modifiers.
---

## Purpose

Assigns language requirements to quality profiles. The `type` column controls matching behavior: `simple` (default preference), `must` (release must contain), `only` (exclusive), or `not` (release must not contain).

## Columns

| Column                 | Type         | Nullable | Default  | Description                     |
| ---------------------- | ------------ | -------- | -------- | ------------------------------- |
| `quality_profile_name` | VARCHAR(100) | No       | —        | —                               |
| `language_name`        | VARCHAR(30)  | No       | —        | —                               |
| `type`                 | VARCHAR(20)  | No       | 'simple' | 'must', 'only', 'not', 'simple' |

## Relationships

**References:**

- [quality_profiles](/schema/tables/quality_profiles/) — quality_profiles (quality_profile_name)
- [languages](/schema/tables/languages/) — languages (language_name)

- FOREIGN KEY (quality_profile_name) REFERENCES quality_profiles(name) ON DELETE CASCADE ON UPDATE CASCADE
- FOREIGN KEY (language_name) REFERENCES languages(name) ON DELETE CASCADE ON UPDATE CASCADE

## Constraints

- **Primary key:** (quality_profile_name, language_name)
- `type` values: `simple`, `must`, `only`, `not` (default `simple`).

## Related

- [quality_profiles](/schema/tables/quality_profiles/)
- [languages](/schema/tables/languages/)

---
title: Condition Types
description: The nine custom format condition types, operators, and expected value formats.
---

The condition type system implements a **type-dispatched** pattern: the parent table
[`custom_format_conditions`](/schema/tables/custom_format_conditions/) dispatches to one of nine
child tables based on the `type` column. Each child table stores only the columns needed for that
type, preserving relational integrity without a sparse wide table or EAV pattern.

See also [Structure §7](/schema/structure/#7-condition-type-system) for the full narrative with
diagrams and worked examples.

## Parent table fields

All condition types share these columns on [`custom_format_conditions`](/schema/tables/custom_format_conditions/):

| Column               | Purpose                                            |
| -------------------- | -------------------------------------------------- |
| `custom_format_name` | FK to the owning custom format                     |
| `name`               | Unique condition name within the custom format     |
| `type`               | Dispatches to the correct child table              |
| `arr_type`           | Scope: `radarr`, `sonarr`, or `all`                |
| `negate`             | If 1, matches when the check does **not** match    |
| `required`           | If 1, condition must match (AND logic vs OR logic) |

The composite key `(custom_format_name, name)` is the foreign key in all nine child tables.

## The nine condition types

| Type               | Child table                                                                | Specific columns                   | References                                                 |
| ------------------ | -------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------- |
| `pattern`          | [condition_patterns](/schema/tables/condition_patterns/)                   | `regular_expression_name`          | [regular_expressions](/schema/tables/regular_expressions/) |
| `language`         | [condition_languages](/schema/tables/condition_languages/)                 | `language_name`, `except_language` | [languages](/schema/tables/languages/)                     |
| `indexer_flag`     | [condition_indexer_flags](/schema/tables/condition_indexer_flags/)         | `flag`                             | —                                                          |
| `source`           | [condition_sources](/schema/tables/condition_sources/)                     | `source`                           | —                                                          |
| `resolution`       | [condition_resolutions](/schema/tables/condition_resolutions/)             | `resolution`                       | —                                                          |
| `quality_modifier` | [condition_quality_modifiers](/schema/tables/condition_quality_modifiers/) | `quality_modifier`                 | —                                                          |
| `size`             | [condition_sizes](/schema/tables/condition_sizes/)                         | `min_bytes`, `max_bytes`           | —                                                          |
| `release_type`     | [condition_release_types](/schema/tables/condition_release_types/)         | `release_type`                     | —                                                          |
| `year`             | [condition_years](/schema/tables/condition_years/)                         | `min_year`, `max_year`             | —                                                          |

## Invariant

Each row in `custom_format_conditions` must have exactly one corresponding row in exactly one child
table. The `type` column determines which child table holds the data. This invariant is enforced by
application logic during recompose, not by a cross-table database constraint.

## Negate and required semantics

- **`negate = 0` (default):** the condition matches when its check succeeds.
- **`negate = 1`:** the condition matches when its check **fails** (inverted logic).
- **`required = 1`:** the condition uses AND logic — it must match for the custom format to match.
- **`required = 0` (default):** the condition uses OR logic among non-required conditions.

## Expected value formats

| Type               | Value format                                    | Notes                                    |
| ------------------ | ----------------------------------------------- | ---------------------------------------- |
| `pattern`          | Named row in `regular_expressions`              | Matches release title, group, or edition |
| `language`         | Language name from `languages` table            | Use `except_language = 1` to invert      |
| `indexer_flag`     | Indexer flag string (e.g. `Scene`, `Freeleech`) | Arr-specific flag names                  |
| `source`           | Source string (e.g. `Bluray`, `Web`, `DVD`)     | Validate per target arr                  |
| `resolution`       | Resolution string (e.g. `1080p`, `2160p`)       | —                                        |
| `quality_modifier` | Modifier string (e.g. `REMUX`, `WEBDL`)         | —                                        |
| `size`             | Integer bytes; NULL min or max for open range   | Both bounds optional                     |
| `release_type`     | Release type string (e.g. `Movie`, `Episode`)   | Validate per target arr                  |
| `year`             | Integer year; NULL min or max for open range    | Both bounds optional                     |

## Arr-type scoping

The `arr_type` column on the parent condition scopes behavior per arr application. Use `all` when a
condition applies everywhere, or set `radarr` / `sonarr` for arr-specific rules. Do not assume that
similar condition values behave identically across arr types — validate semantics per target arr.

## Example: pattern condition

```sql
INSERT INTO custom_format_conditions (custom_format_name, name, type)
VALUES ('Dolby Vision', 'Has DV', 'pattern');

INSERT INTO condition_patterns (custom_format_name, condition_name, regular_expression_name)
VALUES ('Dolby Vision', 'Has DV', 'DV Pattern');
```

## Example: multi-condition format

Conditions with `required = 1` combine with AND logic; non-required conditions combine with OR:

```sql
INSERT INTO custom_format_conditions
    (custom_format_name, name, type, required)
VALUES ('4K REMUX HDR (2020+)', '4K Resolution', 'resolution', 1);

INSERT INTO condition_resolutions (custom_format_name, condition_name, resolution)
VALUES ('4K REMUX HDR (2020+)', '4K Resolution', '2160p');
```

## Related

- [custom_format_conditions](/schema/tables/custom_format_conditions/) — parent dispatch table
- [custom_formats](/schema/tables/custom_formats/) — owning entity
- [Tables index](/schema/tables/) — all 42 schema tables by domain

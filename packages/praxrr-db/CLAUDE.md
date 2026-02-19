# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

## Project Overview

This is the **UnOfficial Praxrr Database** — a Praxrr Compliant Database (PCD) containing curated
quality profiles, custom formats, regular expressions, and media management settings for Radarr and
Sonarr. The entire repository is SQL data files that target the Praxrr schema. There is no
application code, build system, or runtime.

- **Upstream**: `yandy-r/praxrr-db` (GitHub)
- **Schema dependency**: `yandy-r/praxrr-schema` v1.0.0 (defines tables — this repo only has
  INSERT/UPDATE/DELETE data)
- **PCD version**: 2.0.0 (`pcd.json`)
- **Supported arr types**: `radarr`, `sonarr`

## Repository Structure

- `ops/` — All SQL migration/seed files, numbered sequentially
  - `0.rosettarr.sql` — ~25k line initial seed (generated from YAML elsewhere, no YAML source in
    this repo)
  - `1.*.sql` through `49.*.sql` — Incremental migration files
- `pcd.json` — Praxrr Compliant Database manifest
- `.env.encrypted` — Encrypted env vars via dotenvx (`.env.keys` is gitignored — **never commit
  it**)

## Build/Test/Lint

There is no build system, test framework, or package manager.

- **Formatting**: Prettier (`.prettierrc`) — 2-space indent, single quotes, trailing commas (es5),
  120 char width
- **Markdown linting**: markdownlint (`.markdownlint.json`)
- **Environment**: `direnv` + `dotenvx` for encrypted env var management
- **SQL**: No formal formatter — follow existing patterns (lowercase SQL keywords in migrations,
  uppercase in seed comments)

## Branching Model

- **`stable`** — production/main branch
- **`dev`** — auto-synced from stable on PR merge (via `.github/workflows/devSync.yml`)
- **`v2`** — current working branch
- Origin: `yandy-r/praxrr-db` (fork), Upstream: `yandy-r/database`

## SQL Migration Conventions

### File Naming

Files are numbered sequentially (`0.`, `1.`, ... `49.`) with kebab-case descriptive names. Number
prefix determines execution order. **Migrations must be applied in sequence.**

### Migration Header

```sql
-- @operation: export
-- @entity: batch
-- @name: <Human readable description>
-- @exportedAt: <ISO 8601 timestamp>
-- @opIds: <comma-separated operation IDs>
```

### Operation Blocks

```sql
-- --- BEGIN op <id> ( <action> <entity_type> "<entity_name>" )
<SQL statements>
-- --- END op <id>
```

Actions: `create`, `update`, `delete`. Inserts use `WHERE NOT EXISTS` for idempotency.

## Key Domain Concepts

- **Custom Formats (CFs)**: Rules matching release attributes via conditions. Each condition
  references regex patterns, languages, or other matchers. CFs are assigned numeric scores within
  quality profiles (`-999999` = ban score, typical positive scores in 10000–60000+ range).
- **Quality Profiles**: Define download preferences — acceptable qualities, ordering, and CF scores.
  Scoped by `arr_type` (`radarr`, `sonarr`, or `all`).
- **Release Group Tiers**: Numbered tiers per resolution/profile type (e.g., "1080p Quality Tier 1"
  through "Tier 6"). Higher tier = higher quality.
- **Condition Polymorphism**: `custom_format_conditions` uses a `type` field (`release_title`,
  `language`, `quality_modifier`, `release_type`, `resolution`, `source`, `indexer_flag`) to
  determine which condition sub-table to join — not standard foreign keys.
- **Name-based primary keys**: All entities use `name` as the identifier, not numeric IDs. Foreign
  keys are name-based (`custom_format_name`, `quality_profile_name`, `regular_expression_name`).
- **`arr_type` scoping**: Conditions and profile-CF assignments can be scoped to `radarr`, `sonarr`,
  or `all`. Some CFs have different conditions per arr type.

## Database Schema (26 Tables)

Schema lives in `yandy-r/praxrr-schema` — this repo only populates the tables.

**Core**: `tags`, `regular_expressions`, `custom_formats` **Dependent**: `quality_profiles`,
`quality_groups`, `custom_format_conditions` **Junction**: `regular_expression_tags`,
`custom_format_tags`, `quality_profile_tags`, `quality_group_members`, `quality_profile_languages`,
`quality_profile_custom_formats`, `quality_profile_qualities` **Condition Types** (polymorphic):
`condition_patterns`, `condition_languages`, `condition_quality_modifiers`,
`condition_release_types`, `condition_resolutions`, `condition_sources`, `condition_indexer_flags`
**Media Management**: `radarr_media_settings`, `sonarr_media_settings`, `radarr_naming`,
`sonarr_naming`, `radarr_quality_definitions`, `sonarr_quality_definitions`

# Documentation Strategy

## Project Summary

**Praxrr Schema** is the base SQLite schema for all Praxrr Compliant Databases (PCDs). It defines 36 tables, 64 seeded languages, 67 seeded qualities, and the complete foreign key graph. Supports Radarr, Sonarr, and Lidarr media management applications.

### Key Concepts

- **Operational SQL (OSQL)** - Append-only, ordered, replayable SQL operations
- **Change-Driven Development (CDD)** - Every change starts from a concrete need
- **Layers** - Schema, Dependencies, Base, Tweaks, User Ops
- **Name-based Foreign Keys** - All FKs reference UNIQUE name columns, not autoincrement IDs
- **Condition Type System** - Type-dispatched architecture with 9 child tables

### Repository Structure

```
praxrr-schema/
  pcd.json              - PCD manifest
  README.md             - Project overview
  CONTRIBUTING.md       - Contribution guide
  CHANGELOG.md          - Version history
  LICENSE.txt           - MIT license
  ops/
    0.schema.sql        - 36 table definitions (DDL)
    1.languages.sql     - 64 languages (seed data)
    2.qualities.sql     - 67 qualities + API mappings (seed data)
  docs/
    structure.md        - PCD architecture reference
    manifest.md         - pcd.json specification
  scripts/
    generate-schema-diagram.sh  - SVG diagram generation
    validateLanguages.sh        - Language validation
    validateQualities.sh        - Quality validation
  .github/
    image/              - Auto-generated SVG diagrams
    workflows/          - CI: validation + diagram generation
```

## Scope

**Re-write all existing documentation files** with:

- More detail and depth in explanations
- Additional Mermaid diagrams where they add clarity
- Convert any remaining ASCII diagrams to Mermaid
- Richer examples and cross-references

## Target Files (Existing Only)

| File                | Agent Assignment     | Focus                                                                                                          |
| ------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `docs/structure.md` | Architecture Analyst | Deepen architecture docs, add more Mermaid diagrams for table relationships, data flow, and constraint systems |
| `docs/manifest.md`  | Feature Writer       | Enhance manifest spec with richer examples, add more diagrams for field relationships and validation           |
| `README.md`         | README Generator     | Enrich project overview with more diagrams, expand table descriptions, add quickstart                          |
| `CONTRIBUTING.md`   | Code Documenter      | Expand contribution guide with more workflow diagrams, detailed examples, validation details                   |
| `CHANGELOG.md`      | Changelog Writer     | Expand changelog entries with more context, add diagrams showing before/after for major changes                |

## Style Guidelines

- Use Mermaid syntax for ALL diagrams (graph TD, sequenceDiagram, erDiagram, flowchart, etc.)
- Use dark-theme-friendly Mermaid styling where applicable
- Include code examples from the actual SQL schema
- Cross-reference between documents
- Write clear, concise technical prose
- Use proper heading hierarchy (H1 title, H2 sections, H3 subsections)
- Include Tables of Contents for long documents

## Table Architecture (For Reference)

### 36 Tables in 7 Groups

**Core Entities (6):** tags, languages, regular_expressions, qualities, quality_api_mappings, custom_formats

**Dependent Entities (3):** quality_profiles, quality_groups, custom_format_conditions

**Junction Tables (7):** regular_expression_tags, custom_format_tags, quality_profile_tags, quality_profile_languages, quality_group_members, quality_profile_qualities, quality_profile_custom_formats

**Condition Types (9):** condition_patterns, condition_languages, condition_indexer_flags, condition_sources, condition_resolutions, condition_quality_modifiers, condition_sizes, condition_release_types, condition_years

**Testing (3):** custom_format_tests, test_entities, test_releases

**Media Management (7):** radarr_quality_definitions, sonarr_quality_definitions, lidarr_quality_definitions, radarr_naming, sonarr_naming, radarr_media_settings, sonarr_media_settings

**Other (1):** delay_profiles

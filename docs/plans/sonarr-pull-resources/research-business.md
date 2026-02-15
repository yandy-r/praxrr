# Business Logic Research: sonarr-pull-resources (Second Pass)

## Executive Summary

This feature extends pull into a user-controlled import flow: users fetch Sonarr resources, optionally select by category/item, then commit into PCD as user-layer ops. The new rule is explicit: if users do not actively adjust selections, the system imports all previewed resources and relies on existing dedup/conflict detection to decide identical/conflict outcomes. The business value is faster onboarding and safer migration from existing Sonarr setups without forcing manual recreation.

## User Stories

### Primary

- As a Sonarr user, I want to import existing custom formats, quality profiles, delay profiles, and quality definitions into Profilarr.
- As a migrating user, I want to review pulled resources before writing so I can avoid accidental collisions.
- As a power user, I want optional per-category/per-item selection before commit.

### Secondary

- As a user who just wants speed, I want to skip manual selection and import everything from preview.
- As a multi-instance user, I want predictable conflict handling and clear summaries for what was imported or skipped.

## Business Rules

1. Pulled data writes to `user` layer only (`origin=user`, `state=published`) via existing write pipeline.
2. Preview never writes data.
3. Execute accepts optional selections:

- if provided, execute exactly those decisions
- if omitted/empty, default to import-all previewed entities

4. Existing dedup/conflict behavior remains authoritative in both modes.
5. Name uniqueness checks remain case-insensitive.
6. Namespace suffixes are stripped and flagged for user awareness.
7. Dependency ordering remains required (CF before QP scoring references).

## Workflows

### Primary Flow

1. User opens pull/import tab for an Arr instance.
2. User chooses target database and resource categories.
3. User runs preview fetch.
4. System returns grouped resources with status classification.
5. User can optionally deselect categories/items and resolve conflicts.
6. User commits execute.
7. If user makes no selection changes, backend executes import-all by default.
8. System reports imported/skipped/overwritten/errors by category.

### Error Recovery Flow

- Connection/auth/API errors: no writes, retry allowed.
- Partial write failures: successful items remain committed, failed items are retryable.
- Stale preview: execute fails with re-preview guidance.

## Domain Concepts

- Pull Session: preview result set + chosen/default execution plan.
- Resource Status: `new`, `identical`, `conflict`, `profilarr_managed`.
- Selection Mode:
  - explicit mode (user selections provided)
  - implicit mode (default import-all)
- Execution Outcomes: imported, skipped, overwritten, failed.

## Success Criteria

- Users can preview all scoped categories before commit.
- Users can optionally select subset by category/item.
- If users do not select/deselect, execute imports all previewed entities by default.
- Existing dedup/conflict checks continue to govern final write outcomes.
- Response includes per-category outcome counts and actionable error details.

## Open Questions

1. Default conflict action in implicit import-all mode: `skip` vs `block`?
2. Should dependency auto-include be on by default when QP references missing CFs?
3. Should pull provenance metadata be mandatory in v1?

## Second-pass Corrections

1. Clarified optional selection semantics and default import-all fallback.
2. Removed ambiguity where selective pull was treated as future scope.
3. Aligned workflow text so no-selection path is first-class and not error-prone.
4. Kept dedup/conflict behavior unchanged per user requirement.

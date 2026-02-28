# External Research: Snapshot Patterns and Retention

## Executive Summary

External systems (Terraform state, event-sourcing snapshots, backup lifecycle tools) support the same
core conclusion for Praxrr: store lightweight markers at meaningful boundaries, then prune aggressively.

For Praxrr, the meaningful boundaries are pre-risk pull and pre-risk sync events.

## Relevant Patterns

## Event-Sourcing Snapshots

Useful concepts:

- Snapshot at transactional boundaries.
- Store sequence marker + metadata, not full event replay cache.
- Keep restore deterministic by replaying from known boundary.

Applied to Praxrr:

- `ops_sequence_max_id` is the boundary marker.
- `database_id` scopes marker lineage.
- Snapshot metadata is sufficient for future replay restore.

## Terraform State History

Useful concepts:

- Immutable historical versions.
- Context metadata per version.
- Fast rollback target selection.

Applied to Praxrr:

- Reverse chronological snapshot list with clear trigger labels.

## Snapshot Lifecycle / Retention (Elastic-style)

Useful concepts:

- Max count and max age controls.
- Keep policy simple at MVP; avoid complex tiers early.

Applied to Praxrr:

- Inline pruning defaults (`50`, `30 days`) for auto snapshots.

## SQLite / Hashing Considerations

Key observation:

- Hashing cache tables by assuming `id` keys is brittle.

Recommendation:

- Use deterministic hash over canonical published-op stream from `pcd_ops`.
- Version the algorithm (`state_hash_v1`) for future migration compatibility.

## What We Explicitly Avoid

- Full DB copy snapshots for MVP.
- Cache-table schema-dependent hash algorithms.
- Global cross-database snapshot collections.

## Proposed External-Informed Defaults

- Trigger model: event-driven only (`pull`, `sync`, `manual`)
- Deduplication: short-window trigger-aware dedupe for auto snapshots
- Retention: inline count + age pruning for autos

## Confidence and Gaps

Confidence: High

- Pattern fit with event-sourced systems is strong.
- Implementation complexity remains low and consistent with current architecture.

Remaining gap:

- Restore implementation behavior is deferred to Issue #16.

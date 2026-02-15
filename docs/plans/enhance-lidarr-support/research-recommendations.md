# Research: Recommendations

## Executive Summary

The recommended approach is a staged, compatibility-safe cutover to first-class Lidarr entities, with writes moved first and read compatibility retired after deterministic migration validation. This balances correctness and operational safety while removing long-term architectural debt. The rollout should be gated by schema capability checks, migration reports, and focused regression coverage.

## Recommended Implementation Strategy

- Introduce first-class schema/entities and contract support before behavior cutover.
- Move write paths to `lidarr_*` immediately once schema support exists.
- Keep temporary legacy read compatibility only during migration window.
- Remove Sonarr reuse branches after migration completion criteria are met.

## Phased Rollout Suggestion

- Phase 1: Foundation
  - Schema, registry, portable types/contracts, mapping seeds, migration scaffolding.
- Phase 2: Product Cutover
  - CRUD, API import/export, UI route wiring, sync resolution switched to `lidarr_*`.
- Phase 3: Hardening and Cleanup
  - Remove compatibility branches, finalize docs, complete regression suite.

## Quick Wins

- Fix Lidarr nested-route detection parity in media-management layout.
- Ensure all Lidarr media-management helpers are exported through index modules consistently.
- Align OpenAPI docs with runtime `EntityType` behavior for Lidarr entities.

## Future Enhancements

- Introduce Lidarr-native naming fields where currently constrained by Sonarr-shaped contracts.
- Add migration telemetry/report dashboards per database/instance.
- Reduce family-specific duplication through shared typed abstractions.

## Risk Mitigations

- Enforce schema/version guards before accepting Lidarr writes.
- Make migration idempotent with before/after record counts and conflict logs.
- Add targeted regression tests for CRUD + import/export + sync + migration reruns.
- Keep an explicit rollback path documented during staged rollout.

## Decision Checklist

- Choose migration strategy: copy-all vs sync-referenced-only.
- Choose data model strategy: Sonarr-shape parity now vs Lidarr-native fields now.
- Define compatibility window and hard cutover gates.
- Decide auto-run vs operator-run post-migration reconciliation commands.

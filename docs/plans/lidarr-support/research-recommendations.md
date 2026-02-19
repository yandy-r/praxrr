# Lidarr Support - Recommendations Synthesis

## Executive Summary

A compatibility-first rollout is the lowest-risk path: make sure the Praxrr consumer can safely
process Lidarr-shaped database records before publishing broad Lidarr data in this DB. This reduces
regression risk for existing Radarr/Sonarr users and gives a controlled rollback point. After
consumer hardening, expand DB metadata and mappings incrementally with clear release gating.

## Recommended Implementation Strategy

- High-confidence approach:
  - Phase consumer compatibility first.
  - Phase database arr-type and mapping expansion second.
  - Enable Lidarr features by default only after coverage and regression checks pass.
- Rationale and tradeoffs:
  - Rationale: prevents consumer parse/runtime breakage from unexpected new arr_type rows.
  - Tradeoff: slightly slower full feature delivery, but safer and easier to rollback.

## Phased Rollout Suggestion

- Phase 1:
  - Confirm Praxrr parser/query paths support `arr_type='lidarr'` safely.
  - Add mixed-arr regression tests in Praxrr.
- Phase 2:
  - Add `lidarr` to `pcd.json` arr types.
  - Add Lidarr mapping/quality records through idempotent SQL operation(s).
- Phase 3:
  - Enable Lidarr support by default after mapping coverage and behavior checks pass.

## Quick Wins

- Add explicit Lidarr support metadata in `pcd.json`.
- Add a minimal but valid Lidarr profile and mapping seed set for end-to-end verification.
- Add compatibility documentation covering version requirements between repos.

## Future Enhancements

- Full Lidarr-specific model coverage (metadata profile and release profile depth).
- Generated mapping/type synchronization from Lidarr OpenAPI.
- Runtime capability detection by Lidarr version to reduce hard-coded assumptions.

## Risk Mitigations

- Risk: consumer regression when new arr_type appears.
  - Mitigation: ship consumer parsing and tests before DB data release.
- Risk: incomplete mapping set leads to partial behavior.
  - Mitigation: define minimum mapping coverage gate for release.
- Risk: version skew across repos.
  - Mitigation: tie DB release to explicit minimum Praxrr version.
- Risk: migration drift/duplication.
  - Mitigation: keep SQL operations additive and idempotent.

## Decision Checklist

- V1 scope: quality-profile/custom-format only, or include metadata/release profiles?
- Data model: use shared arr*type rows first, or introduce dedicated `lidarr*\*` entities
  immediately?
- Release gate: what minimum Praxrr version should be required for Lidarr-enabled DB versions?
- Mapping baseline: what minimum Lidarr quality and custom-format mapping coverage is acceptable for
  initial launch?

## Notes

- Some recommendation details refer to companion repo internals and should be verified in
  `yandy-r/praxrr` before implementation planning.

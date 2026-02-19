# Lidarr Final Rollout Signoff (Task 3.4)

## Decision Summary

- Decision date: `2026-02-13`
- Release readiness: **Not Ready**
- Gate totals: `8` pass, `6` fail
- Publish decision: blocked until all failing gates are resolved.

## Gate-by-Gate Status (Explicit Pass/Fail)

1. `MAN-01` Confirm `pcd.json` includes `lidarr` in `arr_types`. **Pass**. Evidence:
   `jq -r '.arr_types[]' pcd.json | rg -x 'lidarr'` returned `lidarr`.
2. `MAN-02` Confirm `praxrr.minimum_version` is exactly `2.1.0`. **Pass**. Evidence:
   `jq -r '.praxrr.minimum_version' pcd.json` returned `2.1.0`.
3. `MAN-03` Run semver-format sanity check (`MAJOR.MINOR.PATCH`). **Pass**. Evidence:
   `jq -r '.praxrr.minimum_version' pcd.json | rg -x '(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)'`
   returned `2.1.0`.
4. `VAL-01` Re-run Task 3.1 manifest evidence command. **Pass**. Evidence:
   `jq -r '.arr_types, .praxrr.minimum_version' pcd.json` returned `["radarr","sonarr","lidarr"]`
   and `2.1.0`.
5. `VAL-02` Update validation evidence for `LID-V1-01`. **Pass**. Evidence:
   `docs/plans/lidarr-support/lidarr-validation.md` records `LID-V1-01` as pass with current output
   (`["radarr","sonarr","lidarr"]`, `2.1.0`).
6. `VAL-03` Remove `LID-V1-01` from validation blocking summary. **Pass**. Evidence:
   `docs/plans/lidarr-support/lidarr-validation.md` reports `blocking_requirements_passed: true`
   with no blocking failures.
7. `XREP-01` Confirm `yandy-r/praxrr` consumer readiness for `praxrr >= 2.1.0` on target release
   branch/tag. **Fail**. Evidence: no confirmation artifact is linked in rollout docs.
8. `XREP-02` Link cross-repo coordination evidence (issue/PR/commit). **Fail**. Evidence: no
   coordination link is documented in rollout artifacts.
9. `XREP-03` Include release-notes/PR compatibility statement. **Fail**. Evidence:
   `rg -n "Lidarr data requires Praxrr 2.1.0 or newer" -S .` matched only the checklist template
   text.
10. `PRE-01` Diff gate limited to intended manifest/checklist changes. **Pass**. Evidence:
    `git diff -- pcd.json docs/plans/lidarr-support/lidarr-rollout-checklist.md` is scoped to these
    files and expected Lidarr rollout deltas.
11. `PRE-02` Markdown lint for checklist passes. **Pass**. Evidence:
    `npx markdownlint-cli "docs/plans/lidarr-support/lidarr-rollout-checklist.md"` returned exit
    `0`.
12. `PRE-03` Required signoff from db maintainer. **Fail**. Evidence: no recorded approval in
    rollout artifacts.
13. `PRE-04` Required signoff from Praxrr consumer maintainer. **Fail**. Evidence: no recorded
    approval in rollout artifacts.
14. `PRE-05` Required signoff from validation evidence reviewer. **Fail**. Evidence: no recorded
    approval in rollout artifacts.

## Approved Deferrals (Non-Blocking for v1)

1. `DEF-01` Lidarr metadata profile seeding. Approval source: `requirements.md` "Explicitly Out of
   Scope for v1" and `lidarr-compatibility-matrix.md` "Unsupported Features". Owner: data model
   maintainer. Revisit milestone: Lidarr v2 scope planning.
2. `DEF-02` Lidarr release profile seeding. Approval source: `requirements.md` "Explicitly Out of
   Scope for v1" and `lidarr-compatibility-matrix.md` "Unsupported Features". Owner: data model
   maintainer. Revisit milestone: Lidarr v2 scope planning.
3. `DEF-03` SignalR/event-stream integration. Approval source: `requirements.md` "Explicitly Out of
   Scope for v1" and `lidarr-compatibility-matrix.md` "Unsupported Features". Owner: Praxrr
   integration maintainer. Revisit milestone: integration backlog after v1 publication.
4. `DEF-04` Automatic OpenAPI client generation pipeline. Approval source: `requirements.md`
   "Explicitly Out of Scope for v1" and `lidarr-compatibility-matrix.md` "Unsupported Features".
   Owner: tooling maintainer. Revisit milestone: API tooling roadmap review after v1 publication.
5. `DEF-05` Non-essential schema redesign beyond shared-table extension. Approval source:
   `requirements.md` "Explicitly Out of Scope for v1" and `lidarr-compatibility-matrix.md`
   "Unsupported Features". Owner: schema maintainer. Revisit milestone: dedicated-entity re-plan
   trigger (if shared-table limits are identified).

## Unresolved Risks and Follow-Up Milestones

1. `RISK-01` Consumer compatibility proof is missing (`XREP-01`, `XREP-02`). Owner: Praxrr consumer
   maintainer. Milestone `M1`: publish and link issue/PR/commit proving `praxrr >= 2.1.0` support on
   release branch/tag.
2. `RISK-02` Compatibility statement is not yet published in release surface (`XREP-03`). Owner:
   release manager. Milestone `M2`: add `Lidarr data requires Praxrr 2.1.0 or newer.` to release
   notes/PR body and link evidence.
3. `RISK-03` Required approvals are not recorded (`PRE-03`, `PRE-04`, `PRE-05`). Owner: db
   maintainer (approval coordinator). Milestone `M3`: collect and record db maintainer, consumer
   maintainer, and validation reviewer signoffs in this file.

## Readiness Recheck Criteria

1. All failing gates above are re-evaluated to **Pass** with linked evidence.
2. Cross-repo compatibility links and required release-note statement are present.
3. Required maintainer signoffs are recorded.

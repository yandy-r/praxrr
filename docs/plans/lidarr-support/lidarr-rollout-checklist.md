# Lidarr Rollout Checklist (Task 3.2 + Task 3.4)

This checklist is a hard release gate for publishing Lidarr support metadata. Task 3.4 assessment
date: `2026-02-13`. Canonical gate evidence, owners, and milestones are tracked in
`docs/plans/lidarr-support/lidarr-signoff.md`.

## Manifest Gate (Must Pass Before Publish)

- [x] Confirm `pcd.json` includes `lidarr` in `arr_types`. **Status: Pass** Command:
      `jq -r '.arr_types[]' pcd.json | rg -x 'lidarr'`
- [x] Confirm `praxrr.minimum_version` is exactly `2.1.0` (compatibility policy from
      `requirements.md`). **Status: Pass** Command: `jq -r '.praxrr.minimum_version' pcd.json`
      Expected output: `2.1.0`
- [x] Run semver-format sanity check (`MAJOR.MINOR.PATCH`) before commit. **Status: Pass** Command:
      `jq -r '.praxrr.minimum_version' pcd.json | rg -x '(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)'`

## Validation Evidence Synchronization

- [x] Re-run Task 3.1 manifest evidence command: **Status: Pass**
      `jq -r '.arr_types, .praxrr.minimum_version' pcd.json`
- [x] Update `docs/plans/lidarr-support/lidarr-validation.md` so requirement `LID-V1-01` reflects
      current manifest output and status. **Status: Pass**
- [x] Confirm `docs/plans/lidarr-support/lidarr-validation.md` blocking summary no longer lists
      `LID-V1-01`. **Status: Pass**

## Cross-Repo Coordination (Cannot Be Skipped)

- [ ] `yandy-r/praxrr` maintainers confirm consumer support for `praxrr >= 2.1.0` on the target
      release branch/tag. **Status: Fail**
- [ ] Link coordination evidence (issue, PR, or commit) proving consumer readiness is available
      before DB publication. **Status: Fail**
- [ ] Release notes/PR body include explicit compatibility statement:
      `Lidarr data requires Praxrr 2.1.0 or newer.` **Status: Fail**

## Final Pre-Commit Gate

- [x] `git diff -- pcd.json docs/plans/lidarr-support/lidarr-rollout-checklist.md` shows only
      intended Lidarr manifest/checklist changes. **Status: Pass**
- [x] `npx markdownlint-cli "docs/plans/lidarr-support/lidarr-rollout-checklist.md"` passes.
      **Status: Pass**
- [ ] Required signoff present from db maintainer. **Status: Fail**
- [ ] Required signoff present from Praxrr consumer maintainer. **Status: Fail**
- [ ] Required signoff present from validation evidence reviewer. **Status: Fail**

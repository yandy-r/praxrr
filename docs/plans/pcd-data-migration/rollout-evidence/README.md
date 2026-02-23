# Rollout Evidence Layout

Store rollout artifacts under:

`docs/plans/pcd-data-migration/rollout-evidence/<YYYY-MM-DD>/phase-<N>/`

Minimum expected outputs per phase:

- `portable-types-gen.out`
- `check-server.out`
- `cache-parity.test.out`
- `hybrid-sync-trigger.test.out`
- Runtime SQL snapshots listed in `rollout-checklist.md`

Update `docs/plans/pcd-data-migration/rollout-signoff.json` when each phase decision is made.

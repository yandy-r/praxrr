# Task 3.4: Rollout and Contract Verification Checklist

Use this checklist for every hybrid rollout phase change. A phase advances only when all
items are green and evidence artifacts are attached to the change record.

## Required Evidence Directory

Create one directory per phase using the pattern:

`docs/plans/pcd-data-migration/rollout-evidence/<YYYY-MM-DD>/phase-<N>/`

Store every command output or log sample referenced below in that directory.

## A) Contract Consistency Gate

Validate that the schema contract and runtime serialization/deserialization paths stay in sync:

1. Run contract/type synchronization

```bash
deno task generate:pcd-types
```

1. Capture proof of success:

- `portable-types-gen.out` (command exit success + resulting file diff summary, if any)
- `docs/api/v1/schemas/pcd.yaml`
- `docs/api/v1/paths/pcd.yaml`

1. Run project checks covering generated API/PCD contracts:

```bash
deno task check:server
```

1. Capture:

- `check-server.out`

Pass condition:

- `PortableMigrationMetadata` remains present with required keys (`format`, `version`, `source`) in
  `docs/api/v1/schemas/pcd.yaml`.
- The migration fields appear in both import/export OpenAPI paths where required:
  `docs/api/v1/paths/pcd.yaml`.

No-go condition:

- Any contract mismatch or schema-generation step fails.
- Any missing migration metadata field in schema or path docs.

## B) Guard and Parity Test Gate

Run the migration verification tests before declaring rollout-ready:

```bash
deno test packages/praxrr-app/src/tests/pcd/migration/cacheParity.test.ts
deno test packages/praxrr-app/src/tests/jobs/hybridSyncTrigger.test.ts
```

Capture:

- `cache-parity.test.out`
- `hybrid-sync-trigger.test.out`

Pass condition:

- Both tests pass.
- Cache parity assertions show equivalent compiled state between SQL and hybrid inputs for the tested
  entities.
- No unexpected `conflicted`/`error` outcomes in the test-asserted history checks.

No-go condition:

- Any new failed parity case.
- Any regression in sync-trigger behavior.

## C) Runtime Outcome Gate (Per Database)

1. Capture pre/post database state before enabling hybrid mode for that database:

```sql
SELECT database_id, origin, source, state, COUNT(*) AS ops
FROM pcd_ops
GROUP BY database_id, origin, source, state
ORDER BY database_id, origin, source;

SELECT database_id, status, COUNT(*) AS rows
FROM pcd_op_history
GROUP BY database_id, status
ORDER BY database_id, status;

SELECT job_type, status, COUNT(*) AS rows
FROM job_queue
GROUP BY job_type, status
ORDER BY job_type, status;
```

1. Capture post-compile and post-sync checks:

```sql
SELECT h.id, h.op_id, h.status, h.rowcount, h.conflict_reason, h.error, h.applied_at
FROM pcd_op_history h
WHERE h.database_id = :databaseId
ORDER BY h.applied_at DESC, h.id DESC
LIMIT 200;

SELECT id, job_type, status, json_extract(payload, '$.instanceId') AS instance_id, dedupe_key, run_at
FROM job_queue
WHERE dedupe_key LIKE 'arr.sync.%:event:%'
  OR job_type = 'arr.sync.mediaManagement'
ORDER BY run_at DESC
LIMIT 200;

SELECT queue_id, job_type, status, started_at, finished_at, duration_ms
FROM job_run_history
ORDER BY started_at DESC
LIMIT 200;
```

Capture:

- `pcd_ops-baseline.out`
- `pcd_ops-post.out`
- `pcd_op_history-baseline.out`
- `pcd_op_history-post.out`
- `job_queue-baseline.out`
- `job_queue-post.out`
- `job_run_history-post.out`

Pass condition:

- `pcd_ops` includes expected migration-origin rows for the target database.
- `pcd_op_history` rows for migration actions are expected (`applied`, optionally `conflicted` only when
  tested/approved).
- Sync jobs are emitted and deduplicated for affected Arr instances.
- Manual sync run for the target instances completes successfully.

No-go condition:

- New unexpected conflict/error rows in `pcd_op_history`.
- Missing/double `arr.sync.*` jobs for affected instances.
- Startup/import/compile errors tied to migration mode change.

## D) Phase Sign-off (Go/No-Go)

Complete all required files and sign-off fields in one line per phase:

- `rollout-signoff.json`
- `phase` (`0`, `1`, `2`, `3`)
- `decision` (`GO` / `NO-GO`)
- `contract_gate` (`PASS` / `FAIL`)
- `parity_gate` (`PASS` / `FAIL`)
- `runtime_gate` (`PASS` / `FAIL`)
- `evidence_dir`
- `owner`
- `timestamp`
- `blocking_findings` (if no-go)

Promotion rule:

- A phase advances only if all three gates are `PASS`.
- Any single `FAIL` forces `NO-GO` and rollback action before proceeding.

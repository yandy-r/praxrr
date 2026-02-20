# Analysis Tasks: encrypted-key-storage

## Executive Summary

A dependency-aware three-phase plan is appropriate: foundation, cutover, hardening. The main dependency spine is crypto/key utilities -> schema/query changes -> backfill/cutover -> runtime consumer migration. Parallelism is strongest when separating helper/infrastructure work from call-site migrations, while treating `arrInstancesQueries` and migration steps as coordination hubs.

## Recommended Phase Structure

### Phase 1: Foundation

- purpose: establish encryption primitives, key management, and persistence scaffolding.
- suggested tasks:
  - add key-ring and encryption/fingerprint helpers.
  - introduce credential table + query module and fingerprint column/index support.
  - update create/update action contracts to feed encrypted persistence paths.
- parallelization notes: helper work and migration scaffolding can run in parallel, then merge in query contract updates.

### Phase 2: Cutover

- purpose: migrate existing plaintext data and switch all runtime flows to encrypted credential usage.
- suggested tasks:
  - backfill migration from plaintext to encrypted rows and validate coverage.
  - move env reconciliation and duplicate checks to fingerprint semantics.
  - update all Arr client consumer paths to decrypt-on-demand helper.
- dependencies: Phase 1 complete and master key configuration confirmed.

### Phase 3: Hardening

- purpose: operationalize the feature and reduce post-cutover risk.
- suggested tasks:
  - add key rotation/re-encrypt workflow and version handling.
  - extend observability and operator remediation messaging for decrypt failures.
  - finalize docs/runbooks and optional follow-on secret-table expansion plan.
- integration focus: startup sequencing, job stability, and long-term maintenance.

## Task Granularity Guidance

- appropriate task sizes: 1-3 files per task to minimize merge contention.
- tasks to split: migration DDL/backfill vs runtime call-site migrations.
- tasks to combine: route action encryption + response redaction where same module boundaries are touched.

## Dependency Analysis

### Independent Tasks

- encryption/key utility implementation.
- credential query module creation.
- logging redaction and response-hardening tasks.
- observability/runbook documentation tasks.

### Sequential Tasks

- schema additions before backfill migration.
- query contract updates before route/env/runtime call-site cutover.
- decrypt helper implementation before migrating Arr client consumers.
- cutover completion before key rotation hardening.

### Potential Bottlenecks

- high-churn files: `arrInstancesQueries`, `envInstances`, and Arr runtime processors.
- schema migration correctness and resumability.
- startup/runtime behavior under missing or rotated key material.

## Suggested Task Template

- title format: `PhaseX-Area-Outcome`.
- dependency annotation format: `Depends on [Task IDs]`.
- instruction checklist:
  - explicit file targets (1-3 files).
  - explicit contract/behavior outcome.
  - explicit validation method (tests/commands/assertions).
  - explicit security/non-leak expectations.

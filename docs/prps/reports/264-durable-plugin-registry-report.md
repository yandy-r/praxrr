# Implementation Report: Durable Plugin Registry and Management API

<!-- markdownlint-disable MD060 -->

## Summary

Implemented issue #264 as a management-only plugin lifecycle slice. Plugin discovery metadata and
enablement intent now persist in app SQLite, reloads reconcile durable state before atomically
publishing a dispatch snapshot, authenticated `/api/v1/plugins*` endpoints expose management
operations, and MCP exposes a redacted read-only `list_plugins` tool. The implementation remains
behind `PLUGINS_ENABLED` and adds no plugin execution or runtime dependency.

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual                                    |
| ------------- | ---------------- | ----------------------------------------- |
| Complexity    | XL               | XL                                        |
| Confidence    | High             | High after full validation                |
| Files Changed | 29               | 36 source, generated, test, and doc files |

## Tasks Completed

| #   | Task                                            | Status   | Notes                                                                                               |
| --- | ----------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| 1.1 | Add durable plugin storage                      | Complete | Migration, typed query layer, and reconciliation transaction added.                                 |
| 1.2 | Define and generate the plugin API contract     | Complete | YAML, app declarations, and packaged API artifacts kept in lockstep.                                |
| 1.3 | Make registry snapshots lifecycle-aware         | Complete | Dispatch now sees only enabled, discovered plugins.                                                 |
| 2.1 | Implement serialized host reconciliation/reload | Complete | Promise-identity serialization and atomic publication preserve the prior state on failure.          |
| 2.2 | Create shared redacted response boundary        | Complete | HTTP and MCP use one generated-type-backed allow-list mapper.                                       |
| 2.3 | Pin migration, repository, registry behavior    | Complete | Added repository and lifecycle test coverage.                                                       |
| 3.1 | Implement authenticated management routes       | Complete | List, detail, enable, disable, and reload routes added.                                             |
| 3.2 | Add read-only MCP plugin parity                 | Complete | Added closed-schema `list_plugins`; no mutation tools.                                              |
| 3.3 | Update tests, architecture docs, and roadmap    | Complete | Test alias, plugin architecture, and #264 roadmap state updated.                                    |
| 4.1 | Test host reload safety and restart semantics   | Complete | Covers feature-off, concurrency, rollback, missing, and reappearance behavior.                      |
| 4.2 | Test every HTTP management contract             | Complete | Route suite covers success, invalid identity, not found, disabled, and reload failure.              |
| 4.3 | Pin portable contract fidelity                  | Complete | Bundle and MCP tests reject contract drift or sensitive-field exposure.                             |
| 5.1 | Run completion validation and drift audit       | Complete | Type checks, build, full suite, focused lint/format, generation determinism, and whitespace passed. |

## Validation Results

| Level                  | Status | Notes                                                                          |
| ---------------------- | ------ | ------------------------------------------------------------------------------ |
| Static analysis        | Pass   | `deno task check`; Svelte reported 0 errors and 0 warnings.                    |
| Unit/integration tests | Pass   | `deno task test`: 2450 passed across 51 steps, 0 failed.                       |
| Focused plugin tests   | Pass   | `deno task test plugins`: 136 passed, 0 failed.                                |
| Portable API contract  | Pass   | Bundle contract suite: 5 passed, including plugin schema/path parity.          |
| Build                  | Pass   | `deno task build` completed successfully.                                      |
| Generated drift        | Pass   | API generation and bundle hashes were unchanged after regeneration/formatting. |
| Changed-file quality   | Pass   | Prettier, ESLint, and configured whitespace checks pass for all changed files. |

Repo-wide `deno task lint` and `deno task format:check` still report pre-existing formatting
warnings in files unchanged by this branch. Every file changed by this implementation passes the
same format and lint tools.

## Files Changed

- Database: migration registration, durable plugin-registry migration, query/reconciliation layer,
  and focused database tests.
- Runtime: plugin registry, host reload lifecycle, shared response/service boundary, and MCP tool.
- HTTP: five authenticated `/api/v1/plugins*` route handlers and route tests.
- Contracts: OpenAPI root/path/schema YAML, generated app types, packaged JSON/types, and bundle
  fidelity tests.
- Documentation/planning: plugin architecture, ROADMAP, feature spec, research notes, archived plan,
  and this report.
- Test infrastructure: plugin test alias plus registry, host, executor, MCP, and contract coverage.

## Deviations from Plan

- Task 4.3 ran after Task 4.2 instead of concurrently because both modified the same contract test
  file. Serializing them avoided overlapping writes without changing scope.
- Generated API artifacts required the repository's explicit Prettier step after generation; their
  hashes then remained deterministic across a second run.

## Issues Encountered

- The repository's local `core.whitespace=indent-with-non-tab` setting flags required space
  indentation in generated artifacts. Validation used the repository-compatible trailing-space and
  space-before-tab checks and separately ran Prettier on every changed file.
- Repo-wide format/lint baselines contain unrelated failures. Changed-file checks isolate and pass
  the implementation scope.

## Tests Written or Expanded

| Test file                                    | Coverage                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/tests/db/pluginRegistryQueries.test.ts` | Durable identity, enablement, reconciliation, JSON validation, and rollback.                 |
| `src/tests/plugins/host.test.ts`             | Serialized reload, atomicity, feature-off behavior, restart state, and failure preservation. |
| `src/tests/routes/plugins.test.ts`           | Management endpoint contracts and status mappings.                                           |
| `src/tests/mcp/mcp.test.ts`                  | Read-only plugin listing and redaction.                                                      |
| `src/tests/base/bundleApiContract.test.ts`   | YAML/generated/bundled plugin contract parity.                                               |
| `src/tests/plugins/registry.test.ts`         | Enabled/discovered dispatch filtering and snapshot replacement.                              |

## Worktree Summary

| Path                                                     | Branch                             | Status |
| -------------------------------------------------------- | ---------------------------------- | ------ |
| `~/.claude-worktrees/praxrr-264-durable-plugin-registry` | `feat/264-durable-plugin-registry` | parent |

Cleanup command after merge:

```bash
git worktree remove ~/.claude-worktrees/praxrr-264-durable-plugin-registry
```

## Next Steps

- Run the formal code review and apply all accepted findings.
- Create or update the pull request using the repository template.
- Monitor CI to green, squash merge, and remove the feature branch/worktree.

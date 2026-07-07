# Fix Report: pr-205-review

**Source**: docs/prps/reviews/pr-205-review.md
**Applied**: 2026-07-07
**Mode**: Parallel sub-agents (1 batch, 5 file-disjoint clusters, max width 5)
**Severity threshold**: LOW (all findings)

## Summary

- **Total findings in source**: 10
- **Already processed before this run**: Fixed 0 · Failed 0
- **Eligible this run**: 10
- **Applied this run**: Fixed 10 · Failed 0
- **Skipped this run**: 0

All 10 findings (2 CRITICAL, 1 HIGH, 3 MEDIUM, 4 LOW) fixed. Dispatched as 5 file-disjoint clusters so
parallel fixers never touched the same file.

## Fixes Applied

| ID   | Severity | File(s)                                                         | Status | Notes                                                                                                                                                                                                                       |
| ---- | -------- | --------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F001 | CRITICAL | `arr/urlSafety.ts`                                              | Fixed  | Unwrap IPv4-mapped (`::ffff:`) + NAT64 (`64:ff9b::`) IPv6 → dotted-decimal before metadata/link-local checks; verified `[::ffff:169.254.169.254]` + `[64:ff9b::169.254.169.254]` now rejected, real IPv6/LAN still accepted |
| F002 | CRITICAL | `setup/preview-sync/+page.server.ts` + `.svelte`                | Fixed  | Removed unconditional zero-selection bounce; renders "nothing to sync — finish setup" terminal state; still guards missing instance/DB                                                                                      |
| F003 | HIGH     | `arr/base.ts`, `setup/test-connection/+server.ts`               | Fixed  | `getSystemStatus()` returns discriminated `{ok:true,…}\|{ok:false,status?}`; wizard endpoint maps 401/403→`unauthorized`. New 401 unit test added                                                                           |
| F004 | MEDIUM   | `arr/urlSafety.ts`                                              | Fixed  | `isLinkLocalIPv6` now matches full `fe80::/10` via `(hextet & 0xffc0) === 0xfe80`                                                                                                                                           |
| F005 | MEDIUM   | `setup/connect-arr/+page.svelte`                                | Fixed  | Wizard-side gating: Continue/submit blocked until `testStatus === 'success'` (submit interceptor); InstanceForm left untouched                                                                                              |
| F006 | MEDIUM   | `arr/createInstanceAction.ts` (new), `connect-arr` + `arr/new`  | Fixed  | Extracted `createArrInstanceFromForm(formData, {source})`; both actions call it, ~170-line duplication removed                                                                                                              |
| F007 | LOW      | `rateLimit.ts`, `setup/test-connection/+server.ts`              | Fixed  | Bounded the state map + comment noting spoofable-proxy-header limitation                                                                                                                                                    |
| F008 | LOW      | `arr/testConnectionReason.ts` (new), both test routes           | Fixed  | Extracted `toFailureReason`/`reasonFromStatus` + reason type to shared module                                                                                                                                               |
| F009 | LOW      | `setup/defaultDatabase.ts` (new), hooks + link-database + state | Fixed  | `resolveDefaultDatabaseConfig()` shared by all three call sites; empty-string opt-out preserved                                                                                                                             |
| F010 | LOW      | `setup/progress.ts`, select-profiles + preview-sync             | Fixed  | `resolvePrimaryInstance()` promoted to shared helper                                                                                                                                                                        |

## Orchestrator adjustment

- After the parallel batch, one pre-existing test broke: `LidarrOnboardingTest: arr/test accepts lidarr and uses existing response envelope`. F003's fixer had also rewritten legacy `POST /arr/test` to use `getSystemStatus()`, changing its response envelope. Reverted `/arr/test` to its stable `testConnection()`-based envelope (`{success:false, error:'Connection test failed'}`) — the "unauthorized" improvement stays on the new wizard endpoint where it matters; the legacy public contract is preserved. F008's shared `toFailureReason` import retained on `/arr/test`.

## Files Changed

New: `arr/urlSafety.ts` (mod), `arr/base.ts` (mod), `arr/createInstanceAction.ts`, `arr/testConnectionReason.ts`, `setup/defaultDatabase.ts`. Modified: `setup/progress.ts`, `hooks.server.ts`, `rateLimit.ts`, `routes/api/v1/setup/{state,test-connection}/+server.ts`, `routes/arr/{test,new}/+page.server.ts`, `routes/setup/{connect-arr,link-database,preview-sync,select-profiles}/**`, `tests/base/setupProgress.test.ts`, `tests/routes/setupWizard.test.ts`.

## Validation Results

| Check      | Result                                          |
| ---------- | ----------------------------------------------- |
| Type check | Pass (`deno task check` — 0 errors/warns)       |
| Lint       | Pass (`deno task lint` clean)                   |
| Tests      | Pass (`deno task test` → 1066 passed, 0 failed) |

## Next Steps

- Push fixes to PR #205, monitor CI to green, squash merge.

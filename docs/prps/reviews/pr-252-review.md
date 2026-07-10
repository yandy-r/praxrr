# PR Review #252 — feat(security): add dns-aware transport grading

**Reviewed**: 2026-07-10T14:08:32Z
**Mode**: PR
**Author**: yandy-r
**Branch**: feat/security-posture-dns-229 → main
**Decision**: REQUEST CHANGES

## Summary

The implementation is strongly bounded, redacted, report-only, and well tested, but the retained-answer cap can currently discard a public address that appears after the first 16 unique answers. That violates the monotonic public-evidence grading policy and must be fixed before merge.

## Findings

### CRITICAL

None.

### HIGH

- **[F001]** `packages/praxrr-app/src/lib/server/security/dnsTransport.ts:359` — The truncation branch stops classifying answers after the 16-answer retention cap. If the first 16 unique answers are local/special and a later answer is public, the public signal is discarded and Shield Check can emit `65/attention` instead of the required `30/action` guarded-band cap.
  - **Status**: Fixed
  - **Category**: Correctness
  - **Suggested fix**: Continue classifying unique answers after the retention cap and deterministically reserve one bounded retained slot for a late public class when no public class is already retained; add a regression test with 16 local answers followed by a public answer.

### MEDIUM

None.

### LOW

None.

## Validation Results

| Check      | Result |
| ---------- | ------ |
| Type check | Pass   |
| Lint       | Pass   |
| Tests      | Pass   |
| Build      | Pass   |

Changed files pass scoped project Prettier/ESLint. The full test suite passed 2,128 tests in 37 steps, and the production build completed with only the repository's pre-existing circular-chunk warnings. Repository-wide lint/dist-path baseline issues documented in the PR body are unrelated to this finding.

## Files Reviewed

- `ROADMAP.md` (Modified)
- `docs/api/v1/schemas/security-posture.yaml` (Modified)
- `docs/plans/security-posture-dns-grading/analysis-code.md` (Added)
- `docs/plans/security-posture-dns-grading/analysis-context.md` (Added)
- `docs/plans/security-posture-dns-grading/analysis-tasks.md` (Added)
- `docs/plans/security-posture-dns-grading/feature-spec.md` (Added)
- `docs/plans/security-posture-dns-grading/parallel-plan.md` (Added)
- `docs/plans/security-posture-dns-grading/report.md` (Added)
- `docs/plans/security-posture-dns-grading/research-business.md` (Added)
- `docs/plans/security-posture-dns-grading/research-external.md` (Added)
- `docs/plans/security-posture-dns-grading/research-practices.md` (Added)
- `docs/plans/security-posture-dns-grading/research-recommendations.md` (Added)
- `docs/plans/security-posture-dns-grading/research-security.md` (Added)
- `docs/plans/security-posture-dns-grading/research-technical.md` (Added)
- `docs/plans/security-posture-dns-grading/research-ux.md` (Added)
- `docs/plans/security-posture-dns-grading/shared.md` (Added)
- `packages/praxrr-api/openapi.json` (Modified)
- `packages/praxrr-api/types.ts` (Modified)
- `packages/praxrr-app/src/lib/api/v1.d.ts` (Modified)
- `packages/praxrr-app/src/lib/client/ui/security/shieldStatus.ts` (Modified)
- `packages/praxrr-app/src/lib/server/mcp/resources.ts` (Modified)
- `packages/praxrr-app/src/lib/server/mcp/tools.ts` (Modified)
- `packages/praxrr-app/src/lib/server/security/dnsTransport.ts` (Added)
- `packages/praxrr-app/src/lib/server/security/gather.ts` (Modified)
- `packages/praxrr-app/src/lib/server/security/responses.ts` (Modified)
- `packages/praxrr-app/src/lib/server/security/service.ts` (Modified)
- `packages/praxrr-app/src/lib/shared/security/checks.ts` (Modified)
- `packages/praxrr-app/src/lib/shared/security/index.ts` (Modified)
- `packages/praxrr-app/src/lib/shared/security/ip.ts` (Added)
- `packages/praxrr-app/src/lib/shared/security/trustedProxy.ts` (Modified)
- `packages/praxrr-app/src/lib/shared/security/types.ts` (Modified)
- `packages/praxrr-app/src/routes/api/v1/security-posture/summary/+server.ts` (Modified)
- `packages/praxrr-app/src/routes/security-posture/+page.svelte` (Modified)
- `packages/praxrr-app/src/tests/mcp/mcp.test.ts` (Modified)
- `packages/praxrr-app/src/tests/routes/securityPosture.test.ts` (Modified)
- `packages/praxrr-app/src/tests/server/security/dnsTransport.test.ts` (Added)
- `packages/praxrr-app/src/tests/server/security/gatherDnsTransport.test.ts` (Added)
- `packages/praxrr-app/src/tests/shared/security/checks.test.ts` (Modified)
- `packages/praxrr-app/src/tests/shared/security/engine.test.ts` (Modified)
- `packages/praxrr-app/src/tests/shared/security/ip.test.ts` (Added)
- `packages/praxrr-app/src/tests/shared/security/trustedProxy.test.ts` (Modified)

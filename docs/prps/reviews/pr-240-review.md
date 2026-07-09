# Code Review: PR #240

- **Repository:** `yandy-r/praxrr`
- **Pull request:** [#240](https://github.com/yandy-r/praxrr/pull/240)
- **Reviewed head:** `a7b48ed44b17b7ee3bee3719363cb94ae65dceab`
- **Base:** `origin/main`
- **Mode:** PR, three parallel reviewers
- **Date:** 2026-07-09

## Summary

The review found no critical or high-severity issues. All seven actionable findings (four medium and three low) were fixed and validated. The duplicated audit-registry finding from correctness and quality review is merged below.

## Findings

### CRITICAL

- None.

### HIGH

- None.

### MEDIUM

- **[F001]** `packages/praxrr-api/openapi.json:6200` — Bundled discriminator mappings point to nonexistent root JSON pointers instead of component schemas. [correctness]
  - **Status**: Fixed
  - **Category**: Type Safety
  - **Suggested fix**: Rewrite local discriminator mapping values during bundling, regenerate the contract, and assert every bundled mapping URI resolves.

- **[F002]** `packages/praxrr-app/src/lib/server/jobs/transparencyAudit.ts:82` — The typed registry marks every queued workflow as pass even though the checked audit assigns #237 and additional sync follow-ups. [correctness, quality]
  - **Status**: Fixed
  - **Category**: Completeness
  - **Suggested fix**: Encode the real multi-issue follow-up ownership and add a parity test between typed registry expectations and the checked audit.

- **[F003]** `packages/praxrr-app/src/lib/shared/narration/templates.ts:82` — Verbose preview narration renders arbitrary upstream exception text in the authenticated UI. [security]
  - **Status**: Fixed
  - **Category**: Security
  - **Suggested fix**: Render only a closed safe reason/message, retain raw detail in sanitized server logs, and test secret-shaped errors.

- **[F004]** `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte:534` — The explanation toggle's `aria-controls` points to its containing section instead of the controlled child region. [quality]
  - **Status**: Fixed
  - **Category**: Pattern Compliance
  - **Suggested fix**: Give the expandable details child a stable ID and target it from the toggle.

### LOW

- **[F005]** `packages/praxrr-app/src/lib/server/goals/decisionLog.ts:66` — Durable decision metadata logs free-form identifiers without field-specific embedded-secret scrubbing. [security]
  - **Status**: Fixed
  - **Category**: Security
  - **Suggested fix**: Scrub embedded token and credential-bearing URL patterns from names and add focused regression tests.

- **[F006]** `packages/praxrr-app/src/routes/arr/[id]/sync/components/SyncPreviewPanel.svelte:535` — The new toggle uses legacy `on:click` syntax instead of the repository's `onclick` convention. [quality]
  - **Status**: Fixed
  - **Category**: Pattern Compliance
  - **Suggested fix**: Use `onclick={toggleExplanationDetails}`.

- **[F007]** `packages/praxrr-app/src/lib/shared/narration/types.ts:34` — The unused `NarrationProvenance` seam is stale, says provenance is unwired, and retains the prohibited `database-default` vocabulary. [quality]
  - **Status**: Fixed
  - **Category**: Maintainability
  - **Suggested fix**: Remove the unused seam or align it with the evidence-backed provenance type without database-default claims.

## Validation Results

- Correctness reviewer focused gate: 64 passed, 0 failed.
- Security reviewer focused gate: 56 passed, 0 failed.
- Pre-review full suite after base update: 1,754 passed, 0 failed.
- Server/client checks, ESLint, scoped Prettier, Markdownlint, and API contract equivalence passed after dependency/type refresh.

## Worktree Setup

- Existing feature worktree reused: `/home/yandy/.claude-worktrees/praxrr-transparent-automation-engine`
- Branch: `feat/transparent-automation-engine`
- No secondary review worktree was created because the branch was already checked out in the required implementation worktree.

## Files Reviewed

All 44 PR files at the reviewed head were included. Reviewers read changed source, tests, OpenAPI source/generated artifacts, ROADMAP, the automation audit, and the feature specification/plan artifacts.

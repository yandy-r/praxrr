# Review Fix Report: PR #240

- **Review artifact:** `docs/prps/reviews/pr-240-review.md`
- **Pull request:** [#240](https://github.com/yandy-r/praxrr/pull/240)
- **Date:** 2026-07-09
- **Result:** 7 fixed, 0 failed, 0 open

## Fixed Findings

- **F001 — bundled discriminator pointers:** the API bundler now normalizes discriminator mapping references into `#/components/schemas/*`; a standard-tree contract test resolves every local mapping in the published bundle.
- **F002 — typed audit parity:** every queued job now has a typed non-empty follow-up tuple containing #237, plus exact sync (#232) and TRaSH (#238) ownership; tests assert all 18 registrations and specialized mappings.
- **F003 — raw preview error disclosure:** narration emits a closed safe recovery message in verbose mode and never renders upstream error text; secret-shaped URL/header regressions cover both preview and section narration.
- **F004 — disclosure accessibility:** `aria-controls` now targets the stable child explanation region.
- **F005 — embedded secret logging:** the logger sanitizer now redacts embedded Arr-key, token, JWT, bearer, and credential-query values; decision-log and sanitizer regressions cover embedded identifiers.
- **F006 — Svelte event convention:** the new disclosure uses `onclick`.
- **F007 — stale provenance vocabulary:** the unused `NarrationProvenance` seam and `database-default` value were removed; runtime searches find no prohibited claim.

## Additional CI Repair

The lint-autofix workflow now installs frozen Deno project dependencies before invoking the formatter bundle. This fixes the clean-runner failure where Prettier could not load `prettier-plugin-svelte`.

## Validation

- Focused post-review suite: 70 passed, 0 failed.
- Full suite: 1,801 passed across 31 steps, 0 failed.
- `deno task check:server`: passed.
- `deno task check:client`: passed with 0 errors and 0 warnings.
- Bundled discriminator contract test: passed.
- Modular/bundle/app/package parity for MCP, WebAuthn, and Sync Preview apply: passed.
- Tracked Markdownlint, scoped Prettier, and formatting-compatible diff checks: passed.
- Full ESLint: passed after adding the existing MCP dynamic-body waiver to the ESLint rule as well as Deno lint.

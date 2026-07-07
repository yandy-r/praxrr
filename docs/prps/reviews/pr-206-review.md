# PR Review #206 — feat(parity): Cross-Arr Parity Map

**Reviewed**: 2026-07-07
**Mode**: PR
**Author**: yandy-r
**Branch**: feat/cross-arr-parity-map → main
**Decision**: REQUEST CHANGES (1 HIGH; published as self-review comment)

## Summary

Solid, well-tested feature. The extraction of the compatibility algorithm is verbatim/behavior-preserving, support is genuinely derived from `capabilities.ts` (no duplicate boolean map), and security is clean (no injection/auth-bypass/secret-leakage; module cache is race-safe). One HIGH: the JSR mirror ships 3 unresolvable `$ref`s for the new endpoint's error responses (inherited bundler bug, but new refs shipped). The rest are MEDIUM/LOW maintainability + strictness improvements. Reviewed by 3 parallel `ycc:code-reviewer` sub-agents (correctness, security, quality).

## Findings

### CRITICAL

- (none)

### HIGH

- **[F001]** `packages/praxrr-api/openapi.json:96,106,116` — the new `/compatibility/parity` path's 400/401/500 responses reference `#/components/schemas/components/schemas/ErrorResponse` (doubled `components/schemas/` segment), which does not resolve. Root cause is a pre-existing `scripts/bundle-api.ts` `convertRefs` bug (3 instances already on `main`), but this PR ships 3 new broken refs in the published contract mirror.
  - **Status**: Open
  - **Category**: Correctness
  - **Suggested fix**: Correct the 3 new refs in the grafted `/compatibility/parity` block to `#/components/schemas/ErrorResponse`. (Fixing the shared `convertRefs` bundler bug for all 6 refs + a clean regen is a valid larger follow-up but would re-introduce pre-existing mirror drift into this PR.)

### MEDIUM

- **[F002]** `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/compatibility.ts:54,147-155` — `computeProfileCompatibility` re-queries `SELECT name FROM quality_profiles` once per `ARR_APP_TYPES` entry (4× per endpoint request; also one extra query per `list()` call vs the pre-refactor inline code). Bounded today but pure waste.
  - **Status**: Open
  - **Category**: Performance
  - **Suggested fix**: Add an optional `allProfileNames?: string[]` parameter to `computeCompatibleProfileNames` and have `computeProfileCompatibility`/`list` pass their already-fetched names so the query runs once.
- **[F003]** `packages/praxrr-app/src/routes/parity-map/+page.server.ts:60` — `computeProfileCompatibility(cache)` is called with no try/catch, unlike the sibling `+server.ts` which wraps it and returns a controlled error + log. A cache read that throws here yields SvelteKit's generic error page with no diagnostic log.
  - **Status**: Open
  - **Category**: Maintainability
  - **Suggested fix**: Wrap in try/catch, log via `logger.error`, and return `{ ..., profiles: null, error: 'Failed to compute compatibility' }` instead of throwing.
- **[F004]** `docs/api/v1/schemas/compatibility.yaml:10-12` — `ArrSemanticDifference.scope` is typed as a bare `string` while every other categorical field in the file is enumerated. The runtime `ParityScope` is a closed 10-literal union, so the generated type is looser than the domain it documents.
  - **Status**: Open
  - **Category**: Type Safety
  - **Suggested fix**: Add `enum: [custom_formats, quality_profiles, quality_definitions, delay_profiles, metadata_profiles, instances, library, releases, rename, upgrades]` to `scope`, then regenerate `v1.d.ts` + the JSR mirror (scrub to the diff).
- **[F005]** `packages/praxrr-app/src/routes/api/v1/compatibility/parity/+server.ts:9` — the endpoint imports `buildParityRows` from a sibling UI route via a 4-level relative path (`'../../../../parity-map/parityRows.ts'`), coupling `/api/v1/*` to a page route's internal layout. `parityRows.ts` is now genuinely shared (page + endpoint), Svelte-free production code.
  - **Status**: Open
  - **Category**: Pattern Compliance
  - **Suggested fix**: Move `parityRows.ts` to `$shared/arr/parityRows.ts` and import via the `$shared/arr/` alias from both `+server.ts` and `ParityMatrix.svelte`.
- **[F006]** `packages/praxrr-app/src/routes/parity-map/parityRows.ts:14-20` and `SemanticDifferences.svelte:14-25` — the five `ParityEntity`→label strings are hand-authored twice (`PARITY_ENTITY_LABELS` and the first entries of `SCOPE_LABELS`), the one piece of net-new authored data still duplicated.
  - **Status**: Open
  - **Category**: Maintainability
  - **Suggested fix**: Export a single `PARITY_ENTITY_LABELS` (or a `ParityScope`-covering map) from a shared module and import it in both places.
- **[F007]** `scripts/test.ts:20` — the new `parity` alias maps to only `tests/arr/parityMap.test.ts`, omitting the feature's other two test files, unlike the comma-separated `complexity`/`setup-wizard` aliases. `deno task test parity` runs 7 of 17 new tests.
  - **Status**: Open
  - **Category**: Pattern Compliance
  - **Suggested fix**: Use the comma-separated form listing all three parity test files.

### LOW

- **[F008]** `packages/praxrr-app/src/routes/api/v1/compatibility/parity/+server.ts:46-48` — the route-level `if (!locals.user) return 401` makes the endpoint 401 under `AUTH=off`/local-bypass (where `locals.user` is null but `locals.authBypass` is true), even though the operator disabled auth. Fails closed (not a bypass).
  - **Status**: Open
  - **Category**: Security
  - **Suggested fix**: `if (!locals.user && !locals.authBypass) return 401`.
- **[F009]** `packages/praxrr-app/src/routes/api/v1/compatibility/parity/+server.ts:57-58` and `+page.server.ts:29` — `parseInt` accepts `"1e5"`/`"1abc"`/`"  1"` (leading-numeric), contrary to the "fail-fast, no ambiguous ids" policy. Not exploitable.
  - **Status**: Open
  - **Category**: Security
  - **Suggested fix**: Reject with `if (!/^\d+$/.test(param)) return 400` before parsing (or `Number` + `Number.isInteger`).
- **[F010]** `packages/praxrr-app/src/routes/parity-map/ParityMatrix.svelte:34-36` — `getStatus` does an unchecked `row[key as ArrAppType]` cast; safe only because the caller filters `'label'`. A future column would silently return `undefined` and throw in `statusLabel`.
  - **Status**: Open
  - **Category**: Type Safety
  - **Suggested fix**: Guard with `ARR_APP_TYPES.includes(column.key as ArrAppType)` before indexing.
- **[F011]** `packages/praxrr-app/src/routes/parity-map/parityRows.ts:2` and `.../parity/+server.ts:7` import `ARR_APP_TYPES`/`ArrAppType` from `$shared/pcd/types.ts`, while the rest of the feature imports them from `$shared/arr/capabilities.ts`.
  - **Status**: Open
  - **Category**: Pattern Compliance
  - **Suggested fix**: Import from `$shared/arr/capabilities.ts` in both for consistency.
- **[F012]** `packages/praxrr-app/src/routes/parity-map/ParityMatrix.svelte` uses 2-space script indentation while its two same-PR sibling components use tabs (matching `$ui/` convention). Passes prettier either way.
  - **Status**: Open
  - **Category**: Pattern Compliance
  - **Suggested fix**: Reformat `ParityMatrix.svelte`'s script block to tabs to match the siblings.
- **[F013]** `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/compatibility.ts:23-132` — `computeCompatibleProfileNames` is ~110 lines (>50-line guideline). It is a deliberate verbatim extraction, so decomposition is an optional follow-up.
  - **Status**: Open
  - **Category**: Maintainability
  - **Suggested fix**: Optional — split "resolve supported quality names" / "resolve enabled quality names per profile" into named helpers, preserving behavior.
- **[F014]** `packages/praxrr-app/src/tests/pcd/qualityProfileCompatibility.test.ts:242-257` — the "delegation-equivalence" test compares `list()` output to `computeCompatibleProfileNames()` output, but `list()` calls that exact function, so it only guards the filter wiring, not the algorithm (which the other hardcoded-expectation tests cover). Naming/intent nitpick.
  - **Status**: Open
  - **Category**: Completeness
  - **Suggested fix**: Rename to reflect it guards the filter wiring, or assert against independently hardcoded expected sets.

## Validation Results

| Check      | Result                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------ |
| Type check | Pass                                                                                       |
| Lint       | Pass (CI gates docs/shell markdown+prettier; report + docs clean)                          |
| Tests      | Pass (parityMap 7, qualityProfileCompatibility 6, parityMapApi 4; `filters` regression 67) |
| Build      | Pass (`deno task build`)                                                                   |

## Files Reviewed

- `docs/api/v1/openapi.yaml` (Modified), `paths/compatibility.yaml` (Added), `schemas/compatibility.yaml` (Added)
- `packages/praxrr-api/openapi.json` (Modified), `types.ts` (Modified)
- `packages/praxrr-app/src/lib/api/v1.d.ts` (Modified)
- `packages/praxrr-app/src/lib/shared/arr/parity.ts` (Added), `semanticDifferences.ts` (Added)
- `packages/praxrr-app/src/lib/server/pcd/entities/qualityProfiles/compatibility.ts` (Added), `list.ts` (Modified)
- `packages/praxrr-app/src/routes/api/v1/compatibility/parity/+server.ts` (Added)
- `packages/praxrr-app/src/routes/parity-map/{+page.server.ts,+page.svelte,ParityMatrix.svelte,SemanticDifferences.svelte,parityRows.ts}` (Added)
- `packages/praxrr-app/src/lib/client/ui/parity/CompatibilityBadges.svelte` (Added)
- `packages/praxrr-app/src/lib/client/navigation/iconMap.ts` (Modified), `lib/server/navigation/registry.ts` (Modified)
- `packages/praxrr-app/src/tests/{arr/parityMap,pcd/qualityProfileCompatibility,routes/parityMapApi}.test.ts` (Added)
- `scripts/test.ts` (Modified)

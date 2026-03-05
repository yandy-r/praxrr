# PR #176 Review: feat: score simulator phase 1

**Branch:** `feat/score-simulator` → `main`
**Date:** 2026-03-05
**Scope:** 10,555 additions, 2,853 deletions across 37 files
**Closes:** #171, #172, #173, #174, #175

---

## Critical Issues (must fix before merge)

> **Status: All four critical issues resolved** in commit `fix(score-simulator): harden input validation and error handling`. Tests added for issues 1, 3, and 4.

### 1. ~~Unprotected `request.json()` — malformed JSON yields 500~~ RESOLVED

**File:** `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts:92`

`await request.json()` is called without a try-catch. Malformed or empty request bodies produce an unhandled `SyntaxError` surfaced as a generic 500 instead of a clear 400.

**Fix:**

```typescript
let body: SimulateScoreRequest;
try {
  body = await request.json();
} catch {
  throw error(400, 'Invalid request body: expected valid JSON');
}
```

### 2. ~~Empty catch on `scoring()` misclassifies DB errors as "profile not found"~~ RESOLVED

**File:** `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts:155-165`

```typescript
try {
  const scoreData = await scoring(cache, databaseId, parsedSelector.name);
  resolvedProfiles.push({ ... });
} catch {
  missingProfiles.push(profileSelector);  // ALL errors treated as "not found"
}
```

Database corruption, lock contention, schema drift, OOM — all silently re-classified as a missing profile. The user gets a misleading 404 "Quality profiles not found" when the real problem is a server error. Violates CLAUDE.md: "ALWAYS throw errors early and often."

**Fix:** Catch only the specific "not found" case:

```typescript
} catch (err) {
  if (err instanceof Error && err.message.includes('not found')) {
    missingProfiles.push(profileSelector);
  } else {
    throw error(500, `Failed to load scoring data for profile "${parsedSelector.name}"`);
  }
}
```

### 3. ~~Missing `databaseId` validation~~ RESOLVED

**File:** `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts:92-93`

`databaseId` is destructured from the request body and passed to `pcdManager.getCache()` without any validation. `arrType`, `profileNames`, and `releases` all have explicit validation — `databaseId` is skipped entirely.

**Fix:**

```typescript
if (typeof databaseId !== 'number' || !Number.isFinite(databaseId)) {
  throw error(400, 'databaseId must be a finite number');
}
```

### 4. ~~Malformed `trash:` selector silently treated as PCD name~~ RESOLVED

**File:** `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts:74-78`

```typescript
if (!match) {
  return { kind: 'pcd', name: selector }; // "trash:abc:invalid" becomes PCD lookup
}
```

A selector starting with `trash:` that doesn't match the regex falls back to treating the entire string (including prefix) as a PCD profile name. This produces a misleading "profile not found" error instead of a 400.

**Fix:**

```typescript
if (!match) {
  throw error(
    400,
    `Invalid trash profile selector format: "${selector}". Expected "trash:<sourceId>:<name>"`
  );
}
```

---

## Important Issues (should fix)

> **Status: Issues 5-7 resolved. Issue 8 deferred** — the entire UI codebase uses Svelte 4 event patterns; migrating one component would create inconsistent mixed patterns.

### 5. ~~`fallbackParsedInfo()` masks parse failures with fake data~~ RESOLVED

**File:** `packages/praxrr-app/src/routes/api/v1/simulate/score/+server.ts:51-62, 218-249`

When `parseResults.get(cacheKey)` returns null, the code returns `fallbackParsedInfo()` with `source: 'Unknown'`, zero scores, and all CFs non-matching. The user sees what looks like a valid-but-empty result with no indication that parsing failed. Violates CLAUDE.md: "Do not use fallbacks."

**Fix:** Return `parsed: null` (schema already had `nullable: true`). Deleted `fallbackParsedInfo()`. Client shows a parse failure warning banner when `parsed === null`.

### 6. ~~Generic error alert discards server error details~~ RESOLVED

**File:** `packages/praxrr-app/src/routes/score-simulator/[databaseId]/+page.svelte:131-148`

When `response.ok` is false, the response body (which contains structured errors like `{ error: 'Quality profiles not found', missing: [...] }`) is discarded. The user always sees "Failed to run score simulation." regardless of the actual error.

**Fix:** Reads server error body before throwing; catch block now surfaces `err.message` in the alert.

### 7. ~~Parser health endpoint missing formatting and OpenAPI contract~~ RESOLVED

**File:** `packages/praxrr-app/src/routes/api/v1/parser/health/+server.ts`

- Missing semicolons throughout (violates Prettier conventions)
- No OpenAPI spec definition exists for this new `/api/v1/` endpoint (violates "Contract-first API")

**Fix:** Formatted with Prettier. Added OpenAPI spec in `system.yaml` and `openapi.yaml`. Regenerated API types.

### 8. `on:click` / `on:input` used instead of `onclick` / `oninput` — DEFERRED

**Files:** `ReleaseInput.svelte`, `[databaseId]/+page.svelte`

CLAUDE.md: "Svelte 5, no runes. Use `onclick` handlers." New components use `on:click`, `on:input`, and `createEventDispatcher` (Svelte 4 pattern). Deferred to a codebase-wide migration — the entire UI component library uses Svelte 4 event forwarding patterns.

---

## Test Coverage Gaps

### Critical gaps

| Gap                                                                                     | Criticality |
| --------------------------------------------------------------------------------------- | ----------- |
| TRaSH profile resolution path entirely untested — all tests stub `listSources` to `[]`  | 9/10        |
| `parseProfileSelector` branching logic (pcd:, trash:, malformed, plain name) not tested | 8/10        |
| Missing `databaseId` / cache-not-found 404 path not tested                              | 7/10        |

### Important gaps

| Gap                                                                                                                 | Criticality |
| ------------------------------------------------------------------------------------------------------------------- | ----------- |
| Score of zero excluded from contributions (lines 290-295) not verified                                              | 6/10        |
| Boundary conditions in `resolveScoreThresholdState` (totalScore === minimumScore, totalScore === upgradeUntilScore) | 6/10        |
| Release with whitespace-only title validation not tested                                                            | 5/10        |
| `getSelectedProfileScore` behavior with multiple results (only checks `results[0]`) not documented via test         | 5/10        |

### Positive observations

- Realistic parser stub server with controllable health/version state
- In-memory PCD cache fixture using real SQLite + actual PCD schema SQL
- All five validation branches tested as separate substeps
- Score accumulation test correctly verifies positive + negative CF scoring
- Helper tests are clean and focused
- Proper cleanup in finally blocks prevents test pollution

---

## Suggestions (nice to have)

### 9. Empty catch in `refreshParserAvailability()`

**File:** `+page.svelte:167-169`

The catch block swallows all errors silently. At minimum, `console.debug('Parser health check failed:', err)` would help diagnose persistent failures (e.g., endpoint returning HTML instead of JSON).

### 10. Parse failures logged nowhere in batch cache functions

**File:** `packages/praxrr-app/src/lib/server/utils/arr/parser/client.ts:264, 318`

Both `parseWithCache` and `parseWithCacheBatch` catch blocks discard the error entirely. A parse failure cascades to `fallbackParsedInfo()` with no logging anywhere in the chain.

### 11. Simulation fires on mount before guaranteed state restore

**File:** `+page.svelte:78-81`

`restorePersistedState()` then `void simulate()` — works synchronously now, but fragile if restore logic ever becomes async.

---

## Strengths

- **Clean architecture**: Good separation between server endpoint, page load, helper functions, and UI components
- **Type safety**: All types derived from OpenAPI-generated `v1.d.ts` — no `any` usage
- **Race condition handling**: Request token pattern in `simulate()` correctly prevents stale responses
- **Input validation**: Thorough validation of `arrType`, `profileNames`, `releases` with clear error messages
- **Dual profile source support**: PCD and TRaSH guide profiles handled through discriminated union (`ResolvedPcdProfile | ResolvedTrashProfile`)
- **Parser resilience**: Health polling with interval, graceful degradation when parser unavailable
- **UI polish**: Proper `aria-live`, loading states, empty states, dark mode support
- **Test infrastructure**: Parser stub server and in-memory PCD cache fixture are well-designed and reusable

---

## Recommended Action

1. Fix critical issues #1-4 (input validation, error handling)
2. Address important issues #5-6 (fallback masking, error details)
3. Format parser health endpoint and add OpenAPI spec (#7)
4. Add test coverage for TRaSH profile path and `parseProfileSelector`
5. Consider Svelte 5 event handler migration (#8) as follow-up

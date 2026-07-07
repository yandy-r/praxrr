# Cross-Arr Parity Map — Security / Input-Validation Discovery

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Unknown/invalid/`'all'` `databaseId` not fail-fast 400 — `getCache` returns `undefined` silently (`registry.ts:23`); sibling `simulate/score` maps unknown cache to **404** not 400 (`score/+server.ts:706-709`). | Medium | High (Cross-Arr Semantic Validation Policy: no sibling fallback; design §6.3 mandates 400) | Explicit `parseInt`+reject `NaN`/negative/`'all'`, then 400; do NOT fall through to `getById`/sibling; deviate from `simulate/score`'s 404. |
| Transitional pre-`20260216` Sonarr-cloned Lidarr rows in `quality_api_mappings` (unconstrained `arr_type VARCHAR(20)`, `0.schema.sql:49` comment lists only `radarr,sonarr`) pollute compat verdicts. | Medium (older DBs) | High (wrong "usable by" verdicts) | Extract `list.ts:59-82` QUALITIES-∩ reader verbatim: `api_name ∈ QUALITIES[arrType]`; `supportedQualityNames.size===0 → []`; never trust `arr_type='all'`. |
| Querying an absent/unbuilt PCD cache throws → 500. `arr/library` guards `dbCache?.isBuilt()` (`library:254`). | Medium | Medium | Check `getCache(id)` truthy **and** `isBuilt()` before compute; else 400 (invalid id) not 500. |
| Route accidentally added to `PUBLIC_PATHS` (`middleware.ts:27`) leaks PCD profile names + internal `sourceRefs` pre-auth. | Low | Medium | Keep out of `PUBLIC_PATHS` (design §3, §6.3); assert 401 unauth in test. |
| `sourceRefs` field ships internal server file paths/symbols to clients. | High (by design) | Low (authenticated; repo paths, no secrets) | Authenticated-only; contains no credentials; accept as info-disclosure OR keep `sourceRefs` as code comments and drop from response payload. |
| 500 handler echoes raw `err.message` (existing `arr/library:497` pattern) — leaks internals/stack. | Medium | Low | Catch DB-tier errors; return generic `{error}` 500; log with `meta` context, not stack. |
| API key accepted via `?apikey=` query (`middleware.ts:87`); logging full URL/query would leak the key. | Low | Medium | Never log `url.search`/query string; log ids only (mirror `simulate/score`). Auth already masks key to last-4 (`middleware.ts:105`). |
| `profiles` payload unbounded for large PCDs (OQ4). | Low | Low | Bounded `ARR_APP_TYPES × profiles`; acceptable per OQ4 (typically small). |

## Patterns to Mirror → ERROR_HANDLING

| Category | File:Lines | Pattern | Key Snippet (≤5 lines) |
|----------|-----------|---------|------------------------|
| GET missing-param 400 (`ErrorResponse` shape) | `routes/api/v1/arr/library/+server.ts:307-311` | `json({error} satisfies ErrorResponse,{status:400})` | `const instanceId = url.searchParams.get('instanceId');`<br>`if (!instanceId) return json({ error: 'instanceId is required' } satisfies ErrorResponse, { status: 400 });` |
| GET numeric-id parse 400 | `arr/library/+server.ts:313-316` | `parseInt`+`isNaN`→400 | `const id = parseInt(instanceId, 10);`<br>`if (isNaN(id)) return json({ error: 'Invalid instanceId' } satisfies ErrorResponse, { status: 400 });` |
| Sub-parse error → 400 wrap | `arr/library/+server.ts:323-328` | try/catch helper, message→400 | `try { libraryQuery = parseLibraryQuery(url); }`<br>`catch (err) { return json({ error: err instanceof Error ? err.message : 'Invalid query parameters' }, { status: 400 }); }` |
| `throw error()` alt style (kit) | `routes/api/v1/simulate/score/+server.ts:651-657` | `error(400,...)` finite + enum guard | `if (typeof databaseId !== 'number' \|\| !Number.isFinite(databaseId)) throw error(400, 'databaseId must be a finite number');`<br>`if (!isArrType(arrType)) throw error(400, 'Invalid arrType...');` |
| Cache resolve (DEVIATE: 404→400) | `simulate/score/+server.ts:706-709`; `pcd/database/registry.ts:23` | `getCache`→`undefined`→currently 404 | `const cache = pcdManager.getCache(databaseId);`<br>`if (!cache) throw error(404, 'Database not found or cache not available');`<br>`// registry.getCache: PCDCache \| undefined (no throw)` |
| Cache-built guard | `arr/library/+server.ts:253-254` | skip/guard unbuilt cache | `const dbCache = pcdManager.getCache(db.id);`<br>`if (!dbCache?.isBuilt()) continue;` |
| QUALITIES-∩ transitional-row guard | `pcd/entities/qualityProfiles/list.ts:66,77-86` | intersect `api_name` w/ `QUALITIES[arrType]`, skip unknown | `const supportedApiNames = new Set(Object.keys(QUALITIES[arrType]));`<br>`if (!supportedApiNames.has(apiName)) continue;`<br>`if (supportedQualityNames.size === 0) return [];` |
| Arr-specific-score fallback (never `'all'`) | `list.ts:111-117,140-141` | `where arr_type = arrType` only | `.where('arr_type', '=', arrType)  // arr-specific scores, never 'all'`<br>`if (hasArrSpecificScores.has(profile.name)) compatibleProfileNames.add(profile.name);` |
| 500 catch + contextual log | `arr/library/+server.ts:489-497` | catch→log meta→`ErrorResponse` 500 | `} catch (err) {`<br>`const message = err instanceof Error ? err.message : 'Failed to...';`<br>`await logger.error(..., { meta: { instanceId: id, error: message } });`<br>`return json({ error: message } satisfies ErrorResponse, { status: 500 }); }` |
| Auth default-gated (no PUBLIC_PATHS) | `utils/auth/middleware.ts:27,32-33` | prefix allowlist; `/parity` absent = authed | `const PUBLIC_PATHS = ['/auth/login', '/auth/setup', '/auth/oidc', '/api/v1/health'];`<br>`return PUBLIC_PATHS.some((p) => pathname === p \|\| pathname.startsWith(p + '/'));` |

## Acceptance Criteria additions (security)

| # | Criterion |
|---|-----------|
| 1 | `GET /api/v1/compatibility/parity` returns 400 `{error}` when `databaseId` is non-numeric, `'all'`, negative, `NaN`, or unknown — no `getById`/sibling fallback (`registry.getCache`→`undefined` maps to **400**, intentionally deviating from `simulate/score`'s 404). |
| 2 | Endpoint stays absent from `PUBLIC_PATHS` (`middleware.ts:27`); an unauthenticated request returns 401 (test asserts). |
| 3 | DB tier touched only when `?databaseId=` present; `profiles` omitted otherwise (no auto-resolve of a linked DB — OQ3). |
| 4 | Per-profile compat derives from the `list.ts:59-82` QUALITIES-∩ reader (`api_name ∈ QUALITIES[arrType]`); a transitional pre-`20260216` Lidarr `quality_api_mappings` row is excluded (fixture-pinned test). |
| 5 | Compat never counts `quality_profile_custom_formats.arr_type='all'` scores; arr-specific fallback filters `arr_type = target` only (`list.ts:111-117`). |
| 6 | Response contains no credentials / API keys / instance URLs; `sourceRefs` (repo paths) exposure reviewed & accepted (authenticated-only) or dropped from the payload. |
| 7 | Absent/unbuilt cache (`getCache` truthy && `isBuilt()`) fails fast to 400, never a 500 on the query. |
| 8 | 500 handler logs with `meta` context and leaks no stack trace; handler never logs `url` query string (API key can arrive via `?apikey=`, `middleware.ts:87`). |
| 9 | `databaseId` parsed once via `parseInt`+`isNaN` (mirror `arr/library:313-316`); error body is `ErrorResponse`-shaped `{ error: string }`. |

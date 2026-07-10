# Security Research: config-health-trends-export

## Executive Summary

The feature can reuse Praxrr's authenticated, same-origin, read-only route model safely, but it
must not turn user-selected series into SQL/JSON-path syntax or materialize an unbounded snapshot
history. The highest implementation risks are broken auth inheritance, dynamic query construction,
spreadsheet formula injection, and divergence between the UI, JSON, and CSV result sets. No new
chart dependency is required; retaining the in-repo Svelte/SVG approach minimizes supply-chain and
DOM risk.

## Findings by Severity

### CRITICAL — Hard Stops

| ID  | Finding                                                                                                                                                    | Risk                                                                                                  | Required Mitigation                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | New trend/export routes could bypass the global auth boundary if placed on a public path or exposed outside SvelteKit's `handle` hook.                     | Unauthenticated disclosure of instance names, profile names, health history, and operational posture. | Keep every endpoint under authenticated `/api/v1/config-health/**`; do not add it to `PUBLIC_PATHS`; do not implement a separate download server or signed/public URL. Add an integration test proving an unauthenticated request is rejected by the hook.                                                                            |
| C2  | Treating `criterion`, `profile`, `series`, sort, or JSON-path input as SQL syntax creates an injection surface. SQLite parameters cannot bind identifiers. | SQL/JSON-path injection or cross-scope reads.                                                         | Use fixed SQL text and `?` bindings for instance/time/value predicates. Map closed selectors through constant allowlists and extract criterion/profile data from parsed rows in application code. Never interpolate a profile name, criterion id, sort token, JSON path, table, or column. Shipping interpolated input is prohibited. |

### WARNING — Must Address

| ID  | Finding                                                                                                                                                                                                  | Risk                                                                                                                             | Suggested Mitigation                                                                                                                                                                                                                                                                                                                                                                             | Alternatives                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | Current `days` accepts any positive integer, `getTrend()` has no row cap, retention allows 1,000,000 rows, and each row parses nested JSON.                                                              | Repeated requests can exhaust SQLite CPU, server memory, and response bandwidth.                                                 | Validate bounded UTC `from`/`to` or closed range presets; query `cap + 1`; use the existing `(arr_instance_id, generated_at)` index without wrapping the indexed column in `datetime()`; select only required columns; reject or explicitly mark overflow; limit concurrent exports.                                                                                                             | Cursor/page the canonical API and stream exports from the same cursor. Do not silently truncate.                                                                                         |
| W2  | CSV contains operator/upstream-controlled instance and profile names. RFC quoting alone does not stop spreadsheet formulas.                                                                              | Opening an export can execute a formula or exfiltrate spreadsheet data.                                                          | Centralize a serializer that applies formula neutralization to every cell before RFC 4180 escaping. Cover `=`, `+`, `-`, `@`, tab, CR, LF, and documented locale/full-width variants; double quotes; comma; CRLF; and multiline values in tests.                                                                                                                                                 | Offer a machine-oriented CSV mode with a clear warning, or a spreadsheet-oriented mode that quotes every cell and prefixes formula-like cells. JSON remains the lossless machine format. |
| W3  | Separate list/export builders or silent caps can violate exact filter/order parity; current trend response reports the current engine version rather than each snapshot's persisted version.             | Users may analyze or export different evidence than the chart, or compare scores across incompatible scoring engines.            | Parse filters once, execute one canonical ordered query (`generated_at ASC, id ASC`), build one typed result, and serialize that same result to API JSON/CSV. Carry the stored `engineVersion` per point and explicit engine boundary metadata. Include applied filters, result count, and any truncation state.                                                                                 | Use a stable export token/fingerprint for a canonical result window if separate requests must remain byte-consistent while new snapshots arrive.                                         |
| W4  | Exports expose retained historical names and health posture; snapshots intentionally outlive instance deletion. Existing exports lack explicit cache hardening.                                          | Data can persist in browser/intermediary caches or be shared beyond the operator's intent.                                       | Whitelist export fields; exclude credentials, raw config, internal errors, criterion detail/suggestions unless contractually needed. Send `Cache-Control: no-store`, `Content-Disposition: attachment` with a server-generated ASCII filename, correct media type/charset, and `X-Content-Type-Options: nosniff`. State that deleting an instance does not immediately erase retained snapshots. | `private, no-cache` permits controlled caching but is weaker; use only if offline re-download is a product requirement.                                                                  |
| W5  | Rich SVG charts/tooltips render persisted names and criterion text. Unsafe HTML, dynamic SVG URLs, or library formatter callbacks can bypass normal escaping.                                            | Stored XSS, external resource loads, or DOM clobbering.                                                                          | Render data with normal Svelte text interpolation; prohibit `{@html}`, `innerHTML`, `foreignObject`, dynamic event attributes, and untrusted `href`/`url()` values. Clamp numeric SVG attributes and use internal numeric keys, not names, for DOM ids. Test hostile names in labels and tooltips.                                                                                               | If HTML tooltips become necessary, use a maintained sanitizer and a strict allowlist, but plain text is preferred.                                                                       |
| W6  | Middleware accepts `apikey` in the query string. An export link could be tempted to carry it.                                                                                                            | API keys leak through history, logs, copied URLs, referrers, and proxy telemetry.                                                | Browser downloads use the session cookie. Machine clients use `X-Api-Key`; never generate or document export URLs containing `apikey`. Do not log full query strings, profile names, payloads, or exported cells.                                                                                                                                                                                | A short-lived, single-use download token could support cross-origin clients, but adds state and is unnecessary here.                                                                     |
| W7  | `deno audit` currently reports five lockfile advisories: Kysely 0.27.6 (three high SQL/JSON-path advisories), esbuild 0.24.2 (moderate dev-server advisory), and cookie 0.6.0 (low validation advisory). | A new implementation could accidentally use a vulnerable Kysely literal/JSON-path API; existing dev/transitive exposure remains. | Keep this feature on the repository's raw SQLite wrapper with bound values; do not use `sql.lit`, `Kysely<any>`, or dynamic JSON-path builders. Track/upgrade the adapter/Kysely chain and rerun `deno audit`; confirm esbuild 0.24.2 is not used by the production build before accepting deferral.                                                                                             | Pin an override only after adapter compatibility tests, or replace the adapter if it prevents a safe Kysely upgrade.                                                                     |
| W8  | Profile/criterion selectors and time strings can be oversized, duplicated, contradictory, invalid, or ambiguous around time zones.                                                                       | Amplified work, inconsistent cache keys, filter bypass, or misleading inclusion boundaries.                                      | Use a closed criterion-id set, exact profile-name matching with a documented maximum count/length, deduplicate selectors, reject unknown/empty values, accept canonical ISO-8601 UTC bounds, enforce `from <= to`, and specify inclusive/exclusive boundaries in OpenAPI and tests.                                                                                                              | Closed range presets eliminate most date parsing ambiguity; an advanced custom range can be added later.                                                                                 |

### ADVISORY — Best Practices

| ID  | Finding                                                                                                                                  | Benefit                                                                          | Recommendation                                                                                                                                                                                                                               | Defer Justification                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | No feature-specific CSP/CORS/CSRF change is needed for read-only same-origin GETs.                                                       | Avoids weakening browser isolation while keeping scope focused.                  | Do not add wildcard CORS. Keep exports GET-only and side-effect free. Add a CSP as platform defense-in-depth; the existing `csrf.trustedOrigins: ['*']` is a separate platform concern if future state-changing trend preferences are added. | Safe to defer because this feature adds no mutation and relies on escaped Svelte rendering.                                               |
| A2  | A new chart package expands the browser dependency and plugin/formatter attack surface.                                                  | Smaller supply chain and easier CSP/accessibility review.                        | Prefer an in-repo Svelte component using static SVG primitives. If a library is selected, pin it through `deno.lock`, review license/maintenance/advisories/transitives, prohibit CDN/runtime code loading, and rerun `deno audit`.          | A vetted library may be justified if it materially improves keyboard/screen-reader support that cannot reasonably be implemented locally. |
| A3  | Export observability can detect abuse without recording sensitive data.                                                                  | Faster diagnosis of resource pressure and repeated large downloads.              | Log authenticated actor type, instance id, normalized range, row count, duration, cap/overflow, and status; omit API keys, full URLs, profile names, and content. Consider per-actor/IP throttling with `429` and `Retry-After`.             | Hard rate limiting can be deferred for a local single-operator deployment if strict row/concurrency bounds ship.                          |
| A4  | Session cookies are `httpOnly`/`SameSite=Lax` but `secure:false`; `AUTH=off` and local-IP bypass deliberately trust deployment controls. | Clarifies that transport and proxy configuration remain part of data protection. | Serve over TLS, configure trusted proxy boundaries correctly, and document that `AUTH=off` requires an authenticating reverse proxy. Do not weaken cookie flags for downloads.                                                               | This is pre-existing platform posture, not introduced by issue #226.                                                                      |
| A5  | Existing sync-history and timeline routes duplicate CSV escaping.                                                                        | A shared, tested primitive reduces drift and makes future fixes uniform.         | Extract a small server-only CSV utility with formula-policy and RFC 4180 tests, then reuse it for this export where scope permits.                                                                                                           | Duplication is acceptable for this issue if the new serializer has exhaustive tests and a follow-up tracks consolidation.                 |

## Authentication and Authorization

- **CRITICAL C1:** `hooks.server.ts` authenticates every non-public `/api` route and returns 401 for
  missing auth. The config-health paths are not public. Preserve that inheritance for both data and
  file responses.
- Praxrr currently has no per-instance roles or tenant ownership: any authenticated session/API key
  can read every instance. The feature should not invent client-side object authorization. Keep the
  instance lookup server-side and return the existing indistinguishable 404 for unknown and
  unsupported instances.
- **WARNING W6:** use cookies for UI downloads and `X-Api-Key` for automation. The existing query
  parameter credential compatibility must not appear in generated links or documentation.
- GET trend/export handlers must remain read-only. CSRF protection is not the primary control for a
  safe GET; any future saved-view or retention mutation needs a separate authenticated mutation
  design and origin/CSRF review.

## Data Protection

- **WARNING W4:** snapshots include denormalized instance names, profile names, band/score history,
  engine version, criterion facts, and suggestions; instance deletion sets the FK null but does not
  erase history. Export only the minimal series contract and preserve current cleanup semantics.
- Retention boundaries must be truthful: expose `availableFrom`/`availableTo`, applied range, and
  retention configuration/boundary when knowable. Do not claim that the oldest returned point was
  pruned unless the database has evidence; it may simply be the first measurement.
- **WARNING W3:** engine version is integrity metadata, not cosmetic UI. Never rewrite a stored
  point to the current engine version or interpolate a line across an engine boundary/missing point.
- `Cache-Control: no-store` reduces accidental caching but is not encryption. TLS and careful handling
  of downloaded files remain necessary. Export endpoints must never include Arr API keys, repository
  tokens, session data, or raw configuration payloads.

## Dependency Security

`deno audit` was run in the issue worktree on 2026-07-10 and found 0 critical, 3 high, 1 moderate,
and 1 low advisory. The risk classification below is feature-specific, not a re-labeling of upstream
CVSS severity.

| Dependency                                            | Version                            | Known Issues                                                                                                                                                                                                | Risk Level | Alternative                                                                                        |
| ----------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| Kysely (transitive via `@soapbox/kysely-deno-sqlite`) | 0.27.6                             | Three high advisories affecting MySQL literal escaping and JSON-path construction (`GHSA-8cpq-38p9-67gx`, `GHSA-pv5w-4p9q-p3v2`, `GHSA-wmrf-hv6w-mr66`). Planned raw SQLite bound queries avoid those APIs. | WARNING    | Upgrade adapter/Kysely after compatibility testing; meanwhile prohibit affected literal/path APIs. |
| esbuild                                               | 0.24.2 also present beside 0.28.1  | Moderate dev-server cross-origin request/read issue (`GHSA-67mh-4wv8-2f99`).                                                                                                                                | WARNING    | Ensure the current Vite path resolves a fixed esbuild and remove the stale resolution when safe.   |
| cookie                                                | 0.6.0                              | Low out-of-bounds cookie name/path/domain validation issue (`GHSA-pxg6-pf52-xh8x`). No new cookie handling is needed.                                                                                       | ADVISORY   | Upgrade the owning dependency; do not add feature cookies.                                         |
| In-repo Svelte/SVG chart                              | Svelte 5.56.4 resolved in lockfile | No new package; XSS safety depends on retaining framework escaping and avoiding unsafe sinks.                                                                                                               | ADVISORY   | A reviewed chart library only if accessibility requirements justify its added surface.             |
| `deno.lock`                                           | lockfile v5                        | Exact resolutions and integrity data reduce dependency drift; caret specs still update when intentionally refreshed.                                                                                        | ADVISORY   | Keep the lockfile reviewed and committed; use `deno audit` in validation.                          |

## Input Validation

- **CRITICAL C2:** SQL must be static. Bind `instanceId`, canonical UTC bounds, and limits. Use fixed
  code maps for allowed series and order. Parameters are values, not identifiers.
- **WARNING W8:** reject rather than coerce malformed numeric ids, dates, enum values, duplicates,
  unknown criteria, empty profile names, contradictory ranges, and excess selector fan-out.
- Prefer direct indexed comparisons on canonical stored ISO timestamps. `datetime(generated_at)` in
  WHERE/ORDER can defeat the existing compound index and turn large requests into full scans.
- Validate parsed snapshot JSON at the wire boundary. A malformed `criteria_scores` or
  `profile_scores` row should become an explicit unavailable/omitted point with diagnostics, not a
  fabricated zero and not a route crash.
- **WARNING W2:** CSV encoding is output-context protection, separate from request validation. Test
  a cell beginning with every formula trigger, embedded delimiter/quote/CR/LF, hostile Unicode, and
  a formula after an attacker-controlled delimiter attempt.

## Infrastructure Security

- **WARNING W1:** enforce server-side row, time-range, selector-count, memory/concurrency, and
  response-size bounds. UI controls are not security controls. Query `cap + 1` so overflow is
  detectable.
- **WARNING W4:** return `application/json; charset=utf-8` or `text/csv; charset=utf-8`, attachment
  disposition with a fixed ASCII `.json`/`.csv` filename, `Cache-Control: no-store`, and
  `X-Content-Type-Options: nosniff`. Never derive a header from a profile/instance name.
- Keep the route same-origin and do not add CORS. Reverse proxies should preserve authentication and
  TLS; `AUTH=off` is safe only when the proxy is the enforced authentication boundary.
- A global CSP is useful defense-in-depth, but the feature must be safe without relying on CSP.

## Secure Coding Guidelines

1. Define contract-first filter schemas and a single `parseConfigHealthTrendFilters()` used by UI
   JSON and export routes.
2. Produce one canonical typed result in deterministic `generatedAt ASC, id ASC` order. Serialize
   that object; do not re-query or re-sort separately for CSV.
3. Preserve `null`/missing values. Never coerce unknown criteria, sparse snapshots, gaps, or engine
   boundaries to zero, and never connect them with misleading SVG paths.
4. Use Svelte text nodes and safe attributes only. Clamp scores to `[0, 100]`, reject non-finite
   coordinates, and use internal ids for SVG elements/tooltips.
5. Keep CSV generation server-only, formula-neutralize before RFC escaping, and use CRLF records.
6. Add adversarial tests for auth, invalid/cross-boundary filters, cap overflow, query ordering,
   JSON/CSV parity, formula payloads, hostile labels, malformed stored JSON, engine transitions,
   deleted-instance retention, and concurrent/repeated exports.
7. Keep logs metadata-only and run `deno audit` plus focused config-health tests before release.

## Trade-off Recommendations

- **WARNING W1/W3:** prefer an explicit bounded result (or paginated canonical result) over a silent
  50,000-row truncation. Exactness is more important than pretending an incomplete file is complete.
- **WARNING W2:** spreadsheet-safe prefixing changes literal CSV cell values. Treat JSON as the
  lossless automation format and document CSV as a spreadsheet-oriented representation.
- **WARNING W4:** exposing profile names makes the feature useful but increases operational metadata
  exposure. Keep names because they are required for analysis, while excluding criterion prose,
  errors, and raw configuration unless explicitly selected by a future contract.
- **ADVISORY A2:** a local SVG implementation has lower supply-chain risk; a vetted library is
  acceptable only if it delivers demonstrably better accessible interaction and ships no remote
  code/plugins.

## Open Questions

1. **WARNING W1/W3:** What is the measured safe point cap, and should overflow return 413/422,
   paginate, or return an explicit `truncated` contract that exports reproduce exactly?
2. **WARNING W3:** Must export be a snapshot-consistent result when a scoring sweep inserts during
   download? If yes, should the request capture a maximum snapshot id as a value guard?
3. **WARNING W2:** Is CSV intended primarily for spreadsheets or lossless machine re-import? The
   answer determines the documented formula-neutralization policy; JSON should be preferred for
   lossless interchange.
4. **WARNING W4:** Should exports include criterion detail/suggestions, or only ids, numeric scores,
   contributions, bands, profile names, versions, and timestamps? Minimal projection is safer.
5. **WARNING W8:** Are profile filters exact/case-sensitive persisted identifiers, and what happens
   when a profile is renamed between snapshots?
6. **ADVISORY A3:** Does the deployment model need per-user audit events, or are metadata-only server
   logs sufficient for this read-only operation?

## Primary Sources

- [SQLite parameters and binding](https://sqlite.org/lang_expr.html#parameters) and
  [binding API](https://www.sqlite.org/c3ref/bind_blob.html)
- [RFC 4180: CSV format and `text/csv`](https://www.rfc-editor.org/rfc/rfc4180.html)
- [OWASP CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection)
- [OWASP Cross-Site Scripting Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [OWASP API4:2023 Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/)
- [RFC 6266: HTTP Content-Disposition](https://www.rfc-editor.org/rfc/rfc6266.html)
- [RFC 9111: HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html#name-no-store)
- [Svelte basic markup and escaped text expressions](https://svelte.dev/docs/svelte/basic-markup)
- [Deno dependency management and lockfile integrity](https://docs.deno.com/runtime/packages/)

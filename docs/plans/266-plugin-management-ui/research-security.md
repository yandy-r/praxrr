# Security Research: 266 Plugin Management UI

## Executive Summary

The management API already has strong foundations: global authentication,
explicit response allow-lists, generic public errors, bounded discovery,
serialized mutations, and a deny-by-construction capability catalog. The UI can
ship without new dependencies, but it must address the repository's wildcard
SvelteKit CSRF trust setting and must treat every manifest-authored or
lifecycle-error string as untrusted display data. It must also describe
enablement, runtime state, extension-point wiring, and capabilities precisely so
operators are not induced to grant trust based on capabilities the host does not
actually provide.

## Findings by Severity

### CRITICAL — Hard Stops

No critical findings identified. The plugin routes are not public paths, the
global hook authenticates them unless the operator intentionally selects
`AUTH=off` or the local-IP bypass, and the management response mapper does not
expose source directories or raw internal exceptions.

### WARNING — Must Address

| Finding                                                                                                                                                                                                                                                                                                          | Risk                                                                                                                                                                                                                                                                                                                                           | Suggested Mitigation                                                                                                                                                                                                                                                                                                                                              | Alternatives                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WARNING — Wildcard CSRF trust covers state-changing plugin POSTs.** `svelte.config.js` sets `kit.csrf.trustedOrigins: ['*']`, while enable, disable, and reload accept body-less `POST` requests. SvelteKit explicitly says `'*'` trusts all origins and is generally not recommended.                         | A cross-origin form can submit these cookie-authenticated mutations in production. `SameSite=Lax` reduces ordinary cross-site POST exposure but is defense in depth, is site rather than origin scoped, and does not protect intentional auth-bypass deployments. Repeated reloads also cause bounded but nontrivial filesystem/database work. | Prefer removing the wildcard so SvelteKit's default origin check protects form submissions. If the wildcard is required elsewhere, enforce exact same-origin `Origin` (with a carefully defined proxy-aware target origin) on these three mutation routes and reject cross-site `Sec-Fetch-Site` on unsafe methods; add production tests with a foreign `Origin`. | A synchronizer/double-submit CSRF token or a required custom request header validated server-side is acceptable. Client-side `mode: 'same-origin'` is useful defense in depth but is not a server-side CSRF control. |
| **WARNING — Manifest metadata and `lastError` are untrusted display strings.** Name, author, description, version, engine range, and lifecycle errors originate outside the UI trust boundary.                                                                                                                   | Raw HTML rendering could turn a local plugin manifest or future runtime error into stored XSS in an authenticated management page.                                                                                                                                                                                                             | Render values only through normal Svelte text interpolation/text attributes. Prohibit `{@html}`, `innerHTML`, or HTML-capable markdown rendering for these fields. Add malicious fixtures such as `<img src=x onerror=...>` and verify they remain text.                                                                                                          | If rich descriptions are ever required, introduce a separately reviewed, restrictive sanitizer and schema; do not add that scope now.                                                                                |
| **WARNING — Dynamic plugin identities must be encoded as independent URL segments.**                                                                                                                                                                                                                             | Concatenating `apiVersion` or `id` into a route can create path confusion now or after the manifest grammar evolves, potentially operating on a different resource.                                                                                                                                                                            | Build `/api/v1/plugins/${encodeURIComponent(apiVersion)}/${encodeURIComponent(id)}/...`; never use `encodeURI` on the full dynamic path. Keep server-side identity validation and exact API-version namespacing.                                                                                                                                                  | A small native helper using `URL` plus encoded segments is equivalent. No routing dependency is needed.                                                                                                              |
| **WARNING — Capability and runtime language can overclaim authority or execution.** The API states that `enabled` is persisted administrator intent, not activation; only two current extension points are wired; all current grants are observe-only and secret-free; the default executor remains unavailable. | Calling a plugin "running," a declared point "active," or a capability write/network/fs access would mislead operators making a trust decision. A false sense of isolation or functionality is a security-relevant operator error.                                                                                                             | Derive labels from the shared capability/extension-point catalogs. Present separate facts: enabled intent, discovered/missing state, lifecycle state, runtime availability, declared point, wired/unwired status, and granted capability. Explicitly say current grants cannot access credentials, network, filesystem, database, or writes.                      | If catalog metadata cannot be imported client-side, define a typed exhaustive view mapping with tests that fail when the closed unions change. Do not infer behavior from identifier text.                           |
| **WARNING — Client error handling must preserve the backend redaction boundary.**                                                                                                                                                                                                                                | Displaying `response.text()`, caught exception strings, stack traces, or server log metadata can expose filesystem/database/runtime details. A future `lastError` producer could also accidentally persist sensitive diagnostics.                                                                                                              | Parse the stable `PluginErrorResponse` allow-list and show its generic `error` value (or a fixed fallback by status). Never surface raw non-contract bodies. Keep backend `pluginInternalError` logging server-only, and ensure any future writer to `last_error` stores a UI-safe summary rather than an exception dump.                                         | Map `code` to client-owned generic copy. This is slightly less informative but remains safe if an intermediary returns an unexpected body.                                                                           |
| **WARNING — Overlapping reload/toggle responses can misrepresent committed state.**                                                                                                                                                                                                                              | A stale response can overwrite a newer toggle or reload result, causing the UI to show the opposite of the durable decision and encouraging unintended follow-up actions. Repeated clicks can also amplify reload work.                                                                                                                        | Use per-plugin in-flight guards and one global reload guard; disable affected controls, prevent duplicate submissions, and refresh the canonical list after successful mutations. Apply a response only if it belongs to the latest request generation. The backend's operation queue and reload single-flight remain the authority.                              | Serialize all management mutations through one client queue. This is simpler but reduces harmless parallelism across independent plugins.                                                                            |

### ADVISORY — Best Practices

| Finding                                                         | Benefit                                                                                                                                                         | Recommendation                                                                                                                                            | Defer Justification                                                                                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **ADVISORY — Make same-origin intent explicit in fetch calls.** | Prevents later refactors or attacker-influenced URLs from sending a management request off-origin, and documents that ambient session credentials are expected. | Use relative URLs, `mode: 'same-origin'`, default `credentials: 'same-origin'`, `redirect: 'error'` where compatible, and never put `apikey` in a UI URL. | Relative URLs already resolve same-origin and Fetch defaults credentials to same-origin, so explicit options are defense in depth.        |
| **ADVISORY — Keep management responses non-cacheable.**         | Avoids retained plugin inventory, error, and state data in shared/browser caches.                                                                               | Preserve the API's existing `Cache-Control: no-store`; do not add client persistence in `localStorage` or IndexedDB.                                      | The endpoints already set `no-store`, so only regression tests may be deferred.                                                           |
| **ADVISORY — Add CSP hardening independently.**                 | Limits impact if an unrelated rendering bug becomes XSS.                                                                                                        | Adopt a tested SvelteKit CSP policy without `unsafe-eval` and with constrained script sources.                                                            | CSP is cross-application work and does not replace correct text rendering, so it need not block this scoped UI.                           |
| **ADVISORY — Audit mutation events without manifest text.**     | Provides accountability for enable/disable/reload while avoiding attacker-authored log content and secret leakage.                                              | Log operation, authenticated actor when available, normalized plugin identity, outcome, and counts; avoid raw manifest/error payloads.                    | Existing server logs cover reload and failures; richer actor auditability can follow if the product has no formal audit-log contract yet. |

## Authentication and Authorization

The UI page and `/api/v1/plugins*` endpoints should remain behind the existing
global hook. They are not in `PUBLIC_PATHS`, so unauthenticated API calls
receive `401`; the UI must treat `401` as session loss rather than as a plugin
failure. There is no per-role authorization model in the current application:
any accepted session or API key receives the same authority, while `AUTH=off`
and local-IP mode intentionally bypass authentication. This feature should not
invent a client-only administrator role, because it would provide no
enforcement. If multi-role users are introduced, plugin mutations should become
an explicit privileged permission at the server boundary.

Browser calls should use the current same-origin session cookie and should never
copy the API key into JavaScript, a query string, or storage. The session cookie
is `HttpOnly` and `SameSite=Lax`, with `Secure` resolved from deployment
transport. Those controls should be preserved, but they do not cure the wildcard
CSRF setting. SvelteKit documents that `trustedOrigins: ['*']` bypasses its
origin protection for all origins; the plugin mutation routes therefore need a
server-enforced mitigation before shipping.

## Data Protection

Plugin management data is not PII by design, but it is security-sensitive
inventory. The public mapper explicitly allow-lists validated portable manifest
fields and excludes `sourceDir` and raw manifest JSON. Keep the UI on that API
contract and do not request or expose plugin directory paths, environment
variables, credentials, executor inputs, or server logs.

`lastError` is contractually described as a safe lifecycle error, but the
database column itself has no redaction or length constraint. Today
reconciliation normally clears it, and internal endpoint failures are returned
as a generic `internal_error`. Future runtime/status work must create a single
safe-error projection before persistence: bound its length, strip control
characters if logs/export consume it, and exclude paths, payloads, stack traces,
tokens, and underlying database errors. The UI must still escape it as text.

No new encryption or GDPR workflow is warranted for this display-only feature.
Retain `Cache-Control: no-store`, avoid browser persistence, and do not add
telemetry containing manifest strings or error text.

## Dependency Security

| Dependency          | Version              | Known Issues                                                                                                                                    | Risk Level                                                   | Alternative                                                            |
| ------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Existing Svelte     | Locked `5.56.4`      | No new dependency risk introduced. Raw `{@html}` is explicitly unsafe for unsanitized content.                                                  | **WARNING** if raw HTML is used; otherwise existing baseline | Normal Svelte interpolation                                            |
| Existing SvelteKit  | Locked `2.69.2`      | Repository configuration trusts all CSRF origins despite the framework's safe default. This is configuration risk, not a new package CVE claim. | **WARNING**                                                  | Default origin protection or endpoint-level origin/token validation    |
| Proposed UI helpers | Native platform only | Fetch, `URL`, `encodeURIComponent`, and existing stores/components cover the feature.                                                           | **ADVISORY**                                                 | Do not add a request, sanitizer, markdown, or state-management package |

No new third-party dependency is justified. This avoids expanding the browser
supply-chain surface and keeps the feature aligned with existing generated API
types and shared plugin catalogs.

## Input Validation

- **WARNING:** Treat API payloads as untrusted at runtime even though TypeScript
  generated types exist. Check `response.ok`, validate the small
  discriminants/arrays needed for rendering, and fall back safely on an
  unexpected shape. Types do not validate network data.
- **WARNING:** Encode `apiVersion` and `id` separately with
  `encodeURIComponent`. The current validator limits API versions to a closed
  set and plugin IDs to lowercase reverse-DNS slugs, but URL construction should
  not depend on those constraints remaining unchanged.
- **WARNING:** Use text nodes for name, description, author, version, entry,
  engine range, capability labels, point IDs, and `lastError`. Do not
  interpolate them into style, class, event-handler, or raw URL contexts.
- **ADVISORY:** Preserve server limits (64 KiB manifest, bounded field lengths,
  four capabilities, nine points, 256 candidate directories) and use CSS
  wrapping/truncation with an escaped accessible full-text view so oversized
  valid content cannot destroy page usability.
- **ADVISORY:** Mutations have no request body, so the client should send none.
  If a body is added later, define it in OpenAPI first and reject unknown fields
  server-side.

## Infrastructure Security

The route should not add CORS headers; same-origin browser access is sufficient.
Fetch defaults to same-origin credentials, but a server-side CSRF control
remains mandatory for mutations. If exact origin comparison is implemented
behind a reverse proxy, derive the target origin only from trusted proxy
configuration/headers, not arbitrary forwarded headers.

Reload is authenticated and bounded to 256 immediate child directories with 64
KiB manifests. The host also coalesces simultaneous reloads and serializes
reload/enablement operations. That is good concurrency safety, but not rate
limiting: endpoint-level origin protection and UI in-flight guards are required
now; server-side rate limiting can be added if logs show authenticated abuse or
scan cost grows.

Preserve TLS and secure-cookie deployment guidance. CSP would be beneficial
defense in depth, but no relaxed CSP, remote assets, CDN scripts, or remote
plugin metadata are needed for this local management UI.

## Secure Coding Guidelines

1. Use a small typed native fetch helper that accepts only a closed operation
   (`list`, `enable`, `disable`, `reload`), builds relative URLs internally,
   encodes both identity segments, and parses only JSON contract responses.
2. Keep the response body generic on failure: known `PluginErrorResponse.error`,
   otherwise a fixed message. Send raw diagnostics only to existing server-side
   logging.
3. Render authored strings with ordinary `{value}` Svelte interpolation. Add a
   test that fails if the plugin view introduces `{@html}` or assigns
   `innerHTML`.
4. Import the pure shared capability and extension-point catalogs where
   feasible. Never infer `wired`, `mutates`, `touchesSecrets`, kind, or grant
   compatibility from display strings.
5. Disable controls while their operation is active, use `try/finally` to
   restore them, and do not optimistically claim success. Replace local records
   with the server response or refetch the canonical list.
6. Test production CSRF behavior using foreign and same-origin `Origin` values;
   local development is insufficient because SvelteKit applies its CSRF checks
   only in production.
7. Cover malicious authored text, encoded identity segments, `401`, `404`,
   `409`, `500`, malformed JSON, network failure, late/out-of-order responses,
   feature-off results, and runtime-unavailable states.

## Trade-off Recommendations

- Removing `trustedOrigins: ['*']` is the cleanest fix, but it is
  application-wide. If an existing integration genuinely needs cross-origin form
  submissions, preserve that integration with an explicit origin allow-list and
  keep plugin mutations same-origin rather than retaining the wildcard.
- Showing lifecycle errors improves diagnosis, but raw exceptions are not worth
  the disclosure risk. Provide a bounded safe summary in the UI and keep full
  diagnostics in access-controlled server logs.
- Disabling controls during requests sacrifices a little parallelism but
  protects operator intent. Per-plugin serialization retains useful parallelism
  without allowing contradictory actions on one plugin.
- A sanitizer would enable rich authored descriptions but adds dependency and
  policy surface. Plain text meets issue #266 and is the recommended
  security/usability balance.

## Open Questions

1. Why is `csrf.trustedOrigins: ['*']` required today? Which exact external
   origins, if any, need form-post access so the wildcard can be replaced
   safely?
2. Will a later phase write executor exception text into `last_error`? If so,
   where will the bounded redaction policy live and what fields are permitted?
3. Does "recent run status" require a new API contract beyond current lifecycle
   state and `lastError`? The UI must not synthesize a run-success timestamp or
   active state from `updatedAt`.
4. Is the current single-authority user model intentional for plugin control, or
   should a future server-side operator/admin permission be tracked as a
   separate issue?

## Sources

- [SvelteKit configuration: CSRF](https://svelte.dev/docs/kit/configuration#csrf)
  — default origin checking, content types covered, production-only behavior,
  and the warning against wildcard trusted origins.
- [Svelte `{@html}` documentation](https://svelte.dev/docs/svelte/@html) — raw
  HTML requires escaping or trusted content and must never receive unsanitized
  values.
- [MDN `encodeURIComponent`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent)
  — encodes a URI component, including characters that are URL syntax.
- [MDN Fetch API guide](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#including_credentials)
  — same-origin credentials are the default and cross-origin credential use has
  CSRF implications.
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
  — origin verification, custom-header/token alternatives, Fetch Metadata, and
  SameSite limitations.

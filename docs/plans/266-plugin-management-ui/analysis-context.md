# Context Analysis: 266-plugin-management-ui

## Executive Summary

Build an authenticated `/settings/plugins` operator page over the
already-shipped, redacted `/api/v1/plugins*` contract. Keep request
orchestration page-local, render each complete list record through a
presentation-only card and pure catalog-backed helpers, and add only one server
behavior: an exact same-origin guard shared by the three plugin POST routes. The
page must keep global availability, discovery, saved enablement intent,
lifecycle, extension-point wiring, and absent execution telemetry as separate
facts; no runtime, persistence, polling, or inferred “running/healthy” state
belongs in #266.

## Architecture Context

- **System Structure**: `packages/praxrr-app` contains the SvelteKit page/API
  boundaries, generated types, shared pure plugin catalogs, server plugin
  service/host, navigation registry, and Deno/Playwright tests. Existing
  `PluginHost` and `pluginRegistryQueries` remain the serialized live/durable
  authority; no DB or host change is required.
- **UI Boundary**: Create `settings/plugins/+page.svelte` for all
  list/mutation/reload/stale state, `components/PluginCard.svelte` for display
  and action intent only, and `presentation.ts` for identity, endpoint,
  lifecycle, wording, and catalog resolution. Do not add `+page.server.ts`, a
  store, repository layer, modal, detail N+1, runtime SDK, or dependency.
- **Initial Data Flow**: `onMount` -> relative `GET /api/v1/plugins` -> no-store
  `PluginListResponse` -> explicit loading, feature-off, enabled-empty,
  populated, or failed state. The list response already contains all public
  detail; do not call the detail endpoint per card.
- **Mutation Data Flow**: card requests a boolean -> page keys exact
  `apiVersion` plus case-insensitive `id` -> POST independently encoded path
  segments -> Origin guard -> existing handler/service/host queue -> replace the
  complete matching row only from `PluginMutationResponse.plugin`. Keep the last
  confirmed value visible while pending.
- **Reload Data Flow**: POST reload -> retain rows and report all aggregate
  counters -> GET list -> replace the list only after successful refresh. If
  reconciliation commits but refresh fails, retain rows, mark them stale, and
  say refresh failed; do not relabel reload as failed.
- **Security Boundary**: Global auth already gates every plugin route. A
  feature-local pure guard must precede all enable/disable/reload work because
  `svelte.config.js` trusts wildcard CSRF origins. Mirror the MCP route: allow
  absent `Origin` for authenticated non-browser clients, allow exact
  `url.origin`, reject malformed/foreign origins with stable redacted
  403/no-store JSON; optionally reject explicit `Sec-Fetch-Site: cross-site`. Do
  not change GET, CORS, or global proxy policy.
- **Navigation Integration**: Add `settings.plugins` beneath the existing
  `settings.settings` parent and add the separate Settings-hub row. Keep it
  globally visible when plugins are disabled so operators can discover the
  deployment configuration.

## Critical Files Reference

- `packages/praxrr-app/src/routes/settings/plugins/+page.svelte`: new page-local
  state machine, relative fetches, concurrency guards, inline recovery, alerts,
  and authoritative replacement.
- `packages/praxrr-app/src/routes/settings/plugins/components/PluginCard.svelte`:
  new responsive accessible disclosure; accepts a generated record and
  pending/disabled state, performs no I/O.
- `packages/praxrr-app/src/routes/settings/plugins/presentation.ts`: new pure
  composite identity, encoded URL, lifecycle vocabulary, missing-record wording,
  and catalog resolution helpers.
- `packages/praxrr-app/src/lib/api/v1.d.ts`: import `components['schemas']`
  aliases; never duplicate wire types.
- `packages/praxrr-app/src/lib/shared/plugins/capabilities.ts`: sole capability
  label/description and deny-by-construction safety authority.
- `packages/praxrr-app/src/lib/shared/plugins/extensionPoints.ts`: sole point
  kind/wired/mutating/required-grant authority; only two observe points are
  currently wired.
- `packages/praxrr-app/src/lib/server/plugins/responses.ts`: existing
  allow-listed public projection and stable outcome semantics; keep unchanged
  unless contract regeneration requires type accommodation.
- `packages/praxrr-app/src/lib/server/plugins/host.ts`: serialized
  reload/enablement authority; client guards prevent duplicate/stale UI work but
  must not reproduce its queue.
- `packages/praxrr-app/src/routes/api/v1/mcp/+server.ts`: exact
  absent/same/foreign-Origin precedent to mirror.
- `packages/praxrr-app/src/routes/api/v1/plugins/_errors.ts`: stable
  redacted/no-store error pattern and natural neighbor for a feature-local
  Origin helper.
- `packages/praxrr-app/src/routes/api/v1/plugins/[apiVersion]/[id]/enable/+server.ts`,
  `disable/+server.ts`, and `reload/+server.ts`: call the guard before identity,
  feature, host, filesystem, or DB work.
- `docs/api/v1/paths/plugins.yaml`: document the new 403 behavior;
  regenerate/check API types if operation response definitions change, while
  reusing existing portable error shapes where possible.
- `packages/praxrr-app/src/lib/server/navigation/registry.ts`: canonical ordered
  Settings child registration.
- `packages/praxrr-app/src/routes/settings/+page.svelte`: separate hard-coded
  Settings landing destination.
- `packages/praxrr-app/src/tests/routes/plugins.test.ts`: existing migrated
  DB-backed direct-handler harness for Origin and no-side-effect assertions.
- `packages/praxrr-app/src/tests/routes/pluginManagementPresentation.test.ts`:
  new pure helper contract suite.
- `packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts`: exact
  deep-link sequence must include the route; top-level hrefs remain unchanged.
- `packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts`: add a
  meaningful Settings-child assertion for all Arr scopes instead of modifying
  unrelated top-level snapshots.
- `packages/praxrr-app/src/tests/e2e/specs/config-health-trends-export.spec.ts`:
  pattern for API interception, hostile text, request races, keyboard behavior,
  touch targets, and 320px overflow checks.
- `scripts/test.ts`: ensure the `plugins` alias includes the new presentation
  test or run/document it explicitly.
- `docs/architecture/plugins.md`, `docs/ARCHITECTURE.md`,
  `docs/api/authentication.md`, and `ROADMAP.md`: durable
  architecture/auth/navigation/status documentation; mark management UI shipped
  without claiming execution shipped.

## Patterns to Follow

- **Page-local request generation**: Follow `routes/drift/+page.svelte`;
  monotonically identify list requests so an older initial/retry response cannot
  overwrite a post-reload result. Use a global reload flag plus
  per-composite-key mutation guards.
- **Generated contract + pure catalogs**: Alias generated schemas and resolve
  every returned capability/point from `$shared/plugins`. Unknown runtime values
  fail visibly/closed; never infer policy from prefixes or suffixes.
- **Composite identity**: Match by exact `apiVersion` and lower-cased `id`, but
  display authored values unchanged. Encode each original segment with
  `encodeURIComponent`; do not trim, infer a version, or key by id alone.
- **Server-authoritative updates**: Pessimistic enable/disable, complete
  returned-record replacement, and full list refetch after reload. No optimistic
  toggle, browser cache, offline queue, or dirty-navigation state.
- **Explicit page states**: Loading is not empty; feature-off is normal;
  enabled-empty offers reload; initial failure offers retry; refresh failure
  retains a visibly stale list. A mutation 404 refetches changed/pruned state; a
  409 refetches into feature-off state.
- **Svelte/UI convention**: Svelte 5 without runes, plain `let`/reactive
  statements, and `onclick` for new handlers. Reuse Card/Badge/Button styling.
  Prefer explicit Enable/Disable buttons if `Toggle.svelte` cannot remain
  controlled without temporarily asserting unconfirmed state.
- **Escaped rendering**: Manifest and lifecycle strings use ordinary Svelte
  interpolation only—no `{@html}`, Markdown, sanitizer, tooltip-only evidence,
  remote asset, or browser storage.
- **Persistent plus transient feedback**: Inline status/errors provide durable
  recovery; `alertStore.add` confirms or escalates actions. Use polite
  `role="status"`/`aria-live`, `aria-busy`, native disabled controls, stable
  accessible names, visible state text, and preserved focus.
- **Direct handler tests**: Extend the existing typed fake-event/migrated DB
  harness, restore patches in `finally`, assert no-store/redacted responses and
  zero durable/host side effects for rejected origins.
- **Deterministic Playwright**: Authenticate normally, intercept
  `/api/v1/plugins*`, use role/name locators, and test hostile strings, races,
  partial reload success, keyboard operation, and 320px reflow without a real
  plugin runtime.

## Cross-Cutting Concerns

- **Truthfulness**: `enabled` is durable intent; `discovered` is last
  reconciliation presence; `registeredAt` is not last-run time; `lastError` is
  lifecycle-only; manifest declaration is not wiring; catalog wiring is not
  execution. The current API proves only “Execution telemetry unavailable in
  this build,” not runtime availability or recent success/failure.
- **Authorization and CSRF**: Preserve existing session/API-key authentication
  and absent-Origin CLI behavior. The scoped Origin guard is defense at the
  mutation edge, not new role authorization or a global CORS/CSRF redesign.
- **Race Safety**: Reload disables row mutations; duplicate actions for one
  identity are rejected; request generations prevent stale writes. The server
  queue remains ultimate ordering authority.
- **Failure Semantics**: Keep confirmed data on mutation/reload/read failures.
  Report only safe API errors and aggregate rejected counts; never invent
  rejected identities or display raw filesystem/database/runtime diagnostics.
- **Accessibility/Responsive UX**: No nested actions inside a row-wide
  link/disclosure. Separate native controls, text in addition to color, 320
  CSS-pixel reflow without page overflow, useful touch targets, keyboard
  disclosure, and live asynchronous status are acceptance evidence.
- **Contract Fidelity**: Runtime 403 behavior and OpenAPI path docs must agree;
  generated artifacts must be refreshed if source changes affect them. No new
  runtime telemetry field is allowed without a separate contract-first design.
- **Documentation Accuracy**: Architecture/operator/API indexes and roadmap
  language must distinguish shipped management from deferred runtime/execution.
  Do not preserve stale claims that #266 is incomplete after delivery or imply
  the #262 runtime NO-GO has been reversed.

## Parallelization Opportunities

- **Foundation lane**: Implement `presentation.ts` and its exhaustive Deno tests
  independently; this unblocks typed card/page work and fixes identity/status
  vocabulary early.
- **Security lane**: Implement the Origin helper, wire the three POST routes,
  extend direct route tests, and document 403/OpenAPI behavior independently of
  UI markup. Coordinate only on the final error shape.
- **Navigation/docs lane**: Registry child, Settings hub row, two targeted
  navigation tests, architecture/operator/API docs, and roadmap can proceed
  independently once final child order and wording are fixed.
- **UI lane**: Build `PluginCard` presentation against generated types/catalog
  helpers while page orchestration is developed; integrate after the helper
  interface stabilizes. Avoid concurrent edits to `+page.svelte`.
- **E2E lane**: Fixture/interception scaffolding can start from the agreed
  contract, but final assertions depend on stable markup and completed
  page/security flows.
- Run formatting/type/focused tests after each lane, then shared
  lint/check/plugin/navigation/Playwright validation to catch cross-lane
  contract and import drift.

## Implementation Constraints

- Scope is management UI, navigation, scoped mutation hardening, tests, and
  truthful docs. No DB migration, plugin host/runtime/executor work, invocation
  persistence, new endpoint/detail fetch, polling, pagination, search,
  marketplace/install/upload, global role system, or dependency.
- Feature-off list is HTTP 200 with `{ pluginsEnabled:false, items:[] }`; reload
  feature-off is a 200 no-op with zero counters; row mutations are unavailable.
  The page cannot change `PLUGINS_ENABLED`.
- Retained `discovered:false` records stay visible and actionable using “when
  rediscovered” wording; changing intent does not make missing code available.
- Reload counters and row `discovered` have different meanings. Always refresh
  records after reload and show only aggregate rejected evidence.
- Keep the Settings route visible for all Arr scopes; plugin management is
  global and has no `arr_type` semantics.
- New code follows repository formatting and `onclick` convention. Existing
  older `on:click` examples are not the convention to copy.
- Validation must cover focused helper/plugin/navigation tests, server/client
  type checks, lint/format checks, focused Playwright, malicious text,
  keyboard/focus/live status, responsive reflow, and `graphify update .` when
  graph output is available after implementation.

## Key Recommendations

- Plan in dependency order: pure presentation contract -> page/card integration
  -> navigation/docs, while the Origin guard lane runs in parallel; finish with
  deterministic E2E, full validation, and roadmap truthfulness review.
- Keep tasks file-cohesive and avoid assigning the same route/page to multiple
  implementors. Treat generated API files as outputs of the OpenAPI task, not
  hand-edited source.
- Make accepted vocabulary and full state/error matrix explicit in task
  acceptance criteria so visual implementation cannot collapse intent,
  discovery, lifecycle, wiring, and telemetry.
- Require security tests to prove rejection occurs before side effects and UI
  tests to prove confirmed state survives failures/races; status-code-only
  checks are insufficient.
- Gate completion on both named navigation tests, plugin alias coverage, focused
  Playwright, contract/documentation alignment, and a final review that no text
  claims runtime execution or health.

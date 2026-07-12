# Recommendations: Plugin Management UI (#266)

## Executive Summary

Implement issue #266 as a focused `/settings/plugins` operator page over the
existing `/api/v1/plugins*` management contract. The page should make discovery,
durable enablement intent, lifecycle state, declared extension points, wired
status, and capability grants independently visible. It should use generated
OpenAPI types, the existing client-safe plugin catalogs, ordinary browser
`fetch`, existing UI components, and page-local state. No new dependency, store,
database migration, runtime integration, OpenAPI change, or plugin execution
path belongs in #266.

The central product decision is truthfulness: the current contract contains no
runtime-availability or recent-invocation evidence. `enabled`, `registeredAt`,
`updatedAt`, `state`, and `lastError` cannot be repurposed as run telemetry. For
this issue, render a neutral, explicit statement such as **“Execution telemetry
is unavailable in this build”** and label `lastError` as a lifecycle error.
Contract-first runtime availability and structured run evidence should be
tracked as future child work, but should not expand this UI issue or block its
honest management capabilities.

Security research found one pre-existing warning that affects the new body-less
mutation POSTs: `kit.csrf.trustedOrigins: ['*']`. Keep #266's UI/backend
boundary intact by handling this as a dedicated security child task in the same
delivery workflow. The recommended scoped mitigation is a server-side
same-origin `Origin` guard on enable, disable, and reload, modeled on the
existing MCP route guard, with foreign/malformed-origin tests. Client-side
same-origin fetch options are useful defense in depth but are not the
mitigation.

## Implementation Recommendations

### Recommended approach

1. Add `/settings/plugins` as a globally visible Settings child and Settings-hub
   destination.
2. Load `GET /api/v1/plugins` from the page and model loading, feature-off,
   enabled-empty, populated, stale, and failed states separately.
3. Render a responsive list of feature-specific plugin cards or rows. Keep
   complete inspection in an accessible disclosure for this bounded version; do
   not add an N+1 detail fetch or modal.
4. Perform enable/disable immediately, pessimistically, and against the exact
   composite identity. Replace the full record from the successful mutation
   response.
5. Perform reload as `POST reload -> report counters -> GET list`. Retain the
   old list during the operation and mark it stale if reconciliation succeeds
   but the follow-up read fails.
6. Resolve capabilities and extension points from the shared catalogs. Never
   duplicate or infer policy facts in UI copy.
7. Render lifecycle evidence and telemetry absence as separate concepts. Do not
   display an inferred runtime state or recent run.
8. Update navigation regressions, add focused presentation/browser coverage,
   update `ROADMAP.md`, and run the existing plugin API regression suite.

### Route and module shape

```text
packages/praxrr-app/src/routes/settings/plugins/
├── +page.svelte
├── components/
│   └── PluginCard.svelte
└── presentation.ts              # only pure contract/presentation decisions
```

- `+page.svelte` owns list I/O, reload, feature/page state, concurrency guards,
  alerts, stale-data handling, and authoritative record replacement.
- `PluginCard.svelte` is presentation-only. It receives a `PluginRecord` and
  pending/disabled flags and emits an enablement request; it does not fetch or
  retain an authoritative copy.
- `presentation.ts` should contain only correctness-heavy pure helpers:
  composite identity, endpoint construction, lifecycle vocabulary, catalog
  resolution, and safe display formatting. Do not move request orchestration or
  generic styling into it.
- Do not add a client store, `+page.server.ts`, generic repository layer,
  runtime SDK, polling loop, or detail request per record.

### Technology choices

| Need             | Recommendation                                                          | Rationale                                                                              |
| ---------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Wire types       | Import `components['schemas'][...]` from `$api/v1.d.ts`                 | Preserves contract fidelity without a second interface set.                            |
| Requests         | Small feature-local functions over browser `fetch`                      | Five same-origin endpoints do not justify a runtime client or query library.           |
| Capability copy  | `getCapability()` / capability catalog                                  | Keeps labels, descriptions, `mutates:false`, and `touchesSecrets:false` authoritative. |
| Extension status | `getExtensionPoint()` / extension-point catalog                         | Keeps `wired`, `kind`, mutation, and required-capability facts authoritative.          |
| Layout           | Existing Card/Badge/Button and, only if controllable, Toggle primitives | Preserves project styling and accessibility without a new design system.               |
| State            | Plain Svelte `let`/reactivity, no runes                                 | Matches repository convention and the page-local lifetime.                             |
| Feedback         | Inline persistent status plus `alertStore.add`                          | Alerts confirm actions; inline content preserves retry and error recovery.             |
| Testing          | Deno pure tests plus Playwright interception                            | Tests contract-heavy decisions without introducing a component-test framework.         |

### Truthful status model

Do not compress these dimensions into one “status” badge:

| Dimension          | Source                    | Truthful wording                                                   | Prohibited inference                                                   |
| ------------------ | ------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Global feature     | `pluginsEnabled`          | Plugins enabled / Plugins disabled                                 | API failure when the feature is off                                    |
| Discovery          | `discovered`              | Present / Missing from latest scan                                 | Installed, executable, or healthy                                      |
| Saved intent       | `enabled`                 | Enabled for future dispatch / Disabled / Enabled when rediscovered | Active, loaded, running, or successful                                 |
| Lifecycle          | `state`                   | Exact closed lifecycle label                                       | Recent invocation result                                               |
| Lifecycle error    | `lastError`               | Last lifecycle error / No lifecycle error recorded                 | Last run error or healthy when null                                    |
| Point readiness    | shared descriptor `wired` | Wired observe point / Declared, not wired                          | Declaration proves execution                                           |
| Execution evidence | not in current API        | Execution telemetry unavailable in this build                      | Runtime available/unavailable, last run, duration, success, or failure |

The page-level telemetry limitation should be stable product copy rather than a
hard-coded statement about `UnavailablePluginExecutor`. The latter is repository
truth today but would become stale when a runtime ships; the absence of
telemetry in the consumed contract remains accurate.

### Interaction behavior

#### Initial list

- Show a stable heading and `aria-busy` loading state before interpreting the
  response.
- `pluginsEnabled:false` is a normal informational state explaining
  `PLUGINS_ENABLED`; it is not an error or an enabled-empty registry.
- An enabled empty response should say no validated plugins are visible and
  offer Reload.
- A failed initial request should provide a persistent Retry action.
- Sort discovered records before retained/missing records, then stably by
  authored name and composite identity. Do not hide tombstones because their
  saved intent is meaningful.

#### Enable/disable

- Address a row by exact `apiVersion` plus case-insensitive id; build both path
  segments with `encodeURIComponent` while displaying the authored values
  unchanged.
- Keep the confirmed value visible while pending; do not optimistically flip it.
- Disable the affected control and give it a stable plugin-specific accessible
  name.
- On success, replace the complete row from `PluginMutationResponse.plugin` and
  report that **enablement intent** was saved.
- On failure, keep the prior row. On `plugins_disabled`, transition to the
  feature-off state; on `plugin_not_found`, refetch; on other safe errors, keep
  a row-level Retry and alert.
- For `discovered:false`, retain backend-supported mutations but use “when
  rediscovered” language so the effect is unmistakably future intent.

#### Reload

- Disable reload and row mutations while reconciliation is pending to prevent
  stale response application and mirror the host's serialized operation model.
- Keep current content visible and announce “Scanning and reconciling plugins…”
  in a polite status region.
- Report all four returned counters. Treat `rejected > 0` as a warning and
  direct the operator to logs without inventing rejected identities or reasons.
- Always refetch after `reloaded:true`; the reload response has no records.
- If the refetch fails, say reload completed but list refresh failed, retain the
  old list, mark it “May be out of date,” and offer a list refresh rather than
  repeating reload.
- Treat `reloaded:false` plus `pluginsEnabled:false` as the feature-off state,
  not a successful scan.

### Accessibility and responsive presentation

- Prefer desktop comparison rows and mobile cards with the same explicit
  label/value structure. Ensure the page reflows at an equivalent 320 CSS-pixel
  viewport without making the ordinary page horizontally scroll.
- Do not put a switch inside a row-wide link or generic `role="button"`
  disclosure. Use separate native controls for Inspect and enablement.
- If `Toggle.svelte` cannot remain controlled while the server request is
  pending, use explicit Enable/Disable buttons rather than showing an
  unconfirmed switch value.
- Provide visible text in addition to badge color and switch position.
  `registered` should be neutral, not success green.
- Use `aria-live="polite"`/`role="status"` for loading and successful changes
  and `role="alert"` sparingly for new actionable errors. Keep inline error text
  after transient alerts.
- Render all manifest and error strings through normal Svelte interpolation.
  Never use `{@html}` or `innerHTML`.

### Navigation, ROADMAP, and documentation surfaces

- Add a globally visible `settings.plugins` child to
  `packages/praxrr-app/src/lib/server/navigation/registry.ts`. Keep it reachable
  while the feature is off so operators can discover the configuration
  requirement.
- Add Plugins to `packages/praxrr-app/src/routes/settings/+page.svelte` using
  the existing settings item pattern.
- Update `navigationShellLayout.test.ts`'s exact deep-link expectation with
  `/settings/plugins`.
- The existing `navigationScopeFiltering.test.ts` snapshots top-level navigation
  and would not naturally change for a Settings child. Because #266 explicitly
  requires both navigation tests to be updated, add a meaningful explicit
  Settings-child assertion there rather than altering an unrelated top-level
  snapshot merely to create a diff.
- Update `ROADMAP.md` in the implementation PR to record #266 as the shipped
  operator UI, clearly stating that it manages discovery and durable intent,
  displays lifecycle evidence, and truthfully reports execution telemetry as
  unavailable. Keep runtime promotion and telemetry contract work listed as
  future/deferred rather than implying plugin execution shipped.

### CSRF mitigation decision

The UI must use relative paths and explicit same-origin fetch behavior, but
client controls cannot repair server CSRF policy. Create a dedicated security
child task and complete it in this delivery workflow without folding the change
into #266's UI scope.

Recommended child-task implementation:

1. Add a small server-side guard for unsafe plugin management operations,
   following the already shipped MCP route behavior.
2. When `Origin` is present, parse it and require exact equality with the
   request URL origin; reject malformed or foreign origins with `403`.
3. Allow an absent `Origin` for authenticated non-browser API clients.
   Optionally reject an explicit cross-site `Sec-Fetch-Site` value as defense in
   depth, but do not use it as the only control.
4. Apply the guard to enable, disable, and reload before mutation. List/detail
   remain read-only.
5. Add same-origin, foreign-origin, malformed-origin, and absent-origin tests
   for all mutation route shapes.
6. Leave app-wide removal of `trustedOrigins:['*']` to a broader
   proxy/deployment design unless the repository can prove it does not break
   supported reverse-proxy setups.

This mitigation is narrower than an app-wide configuration change, preserves
non-browser API use, and addresses the exact new mutation surface. A
synchronizer token is a valid alternative but adds state and client plumbing
disproportionate to these same-origin, body-less actions.

### Phasing and quick wins

#### Phase 0: Resolve scope and child-task boundaries

- Record the design decision that #266 ships truthful telemetry-unavailable UI,
  not inferred run status.
- Create/link the future contract-first telemetry child issue.
- Create/link the CSRF hardening child task and make its tests part of the
  current delivery gate.

#### Phase 1: Pure presentation foundation

- Add composite identity, URL construction, lifecycle copy, and
  catalog-resolution helpers only where tests justify them.
- Add pure tests covering every lifecycle value, all four capabilities, all nine
  extension points, exact API-version scoping, id casing, and independent URL
  encoding.

#### Phase 2: Management route and navigation

- Build the route state machine and presentation card.
- Add settings hub and registry entries.
- Implement disabled, empty, populated, stale, and error states.
- Add authoritative enable/disable and reload/refetch behavior with alerts and
  live status.

#### Phase 3: Security child task

- Add the scoped server Origin guard and focused route tests.
- Verify UI calls remain same-origin and no management response adds CORS
  access.

#### Phase 4: Integration, accessibility, and roadmap evidence

- Update both named navigation test files meaningfully.
- Add deterministic Playwright flows using intercepted API responses.
- Perform keyboard, narrow viewport/high zoom, dark mode, malicious-string, and
  stale-refresh manual checks.
- Update `ROADMAP.md` with accurate shipped and deferred claims.

#### Phase 5: Validation and PR lifecycle

- Run focused checks first, then repository-wide type/lint/test gates
  appropriate to the changed surface.
- Create the PR from the issue worktree, linking #266 and the completed CSRF
  child while linking the telemetry child as future work rather than closing it.
- Review the PR for contract truthfulness, accessibility, stale-response races,
  and CSRF coverage; fix findings, monitor CI to green, squash merge, and clean
  the feature branch/worktree.

Quick wins are the nav/settings entry, feature-off state, catalog-backed labels,
and telemetry notice; they should land only with the mutation/reload and
regression coverage required for the full issue.

## Improvement Ideas

These are useful follow-ups, not scope for #266:

1. **Contract-first execution telemetry:** define host-wide runtime availability
   plus structured, redacted per-plugin or per-extension-point invocation
   evidence. Begin in OpenAPI, establish an authoritative persistence/retention
   source, regenerate artifacts, and only then render run status.
2. **Safe rejected-entry evidence:** expose bounded, redacted rejection
   summaries if aggregate counts plus server logs prove insufficient. Do not
   return raw manifests or local paths.
3. **Deep-link detail route:** add only when detail gains data or workflows not
   present in the list. The current list response already contains every public
   record field.
4. **Search/filter:** defer until operator testing at realistic bounded registry
   sizes demonstrates a scanability problem.
5. **Privileged plugin-management role:** if Praxrr later adds roles, enforce
   mutation authority on the server and reflect read-only permissions in the
   page. Do not invent client-only authorization.
6. **Safe audit trail:** capture actor, normalized identity, operation, outcome,
   and reload counts once a general audit contract exists; exclude authored
   descriptions and raw errors.
7. **CSP hardening:** pursue as cross-application defense in depth, not as a
   substitute for escaped rendering or the mutation Origin guard.

## Risk Assessment

### Technical and product risks

| Risk                                                                      | Severity | Impact                                                                | Mitigation / decision                                                                                            |
| ------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| UI presents enablement or registration as execution                       | High     | Operators trust behavior that never ran                               | Separate every state dimension; explicit telemetry-unavailable copy; truthfulness tests.                         |
| Recent-run criterion expands #266 into runtime/backend work               | High     | Violates issue exclusions and couples UI to unresolved runtime design | Ship honest limitation; create future contract-first child; do not modify OpenAPI/runtime in #266.               |
| Wildcard CSRF trust permits cross-origin mutation POSTs                   | High     | Enable/disable/reload can be triggered by another origin              | Complete scoped Origin-guard child task with foreign-origin tests before merge.                                  |
| Stale mutation/reload responses overwrite newer truth                     | High     | UI shows the opposite of durable intent                               | Per-identity pending guard, global reload guard, request generation, authoritative response replacement/refetch. |
| Manifest or lifecycle strings become stored XSS                           | High     | Authenticated operator compromise                                     | Text interpolation only; malicious fixture; no HTML/markdown sanitizer dependency.                               |
| Id-only matching crosses API namespaces                                   | High     | Wrong plugin record/action updated                                    | Composite key `(apiVersion, id.toLowerCase())`; exact encoded path segments.                                     |
| Reload summary is treated as a full registry response                     | Medium   | Missing/rejected state shown incorrectly                              | Always refetch; preserve stale list on partial success.                                                          |
| Feature-off, empty, runtime limitation, and API failure collapse together | Medium   | Misleading recovery guidance                                          | Explicit page state machine and separate tests for each state.                                                   |
| UI policy copy drifts from capability/point contracts                     | Medium   | False security or wiring claims                                       | Import client-safe catalogs; exhaustively test catalog values.                                                   |
| Existing Toggle flips before server confirmation                          | Medium   | Brief false state and confusing assistive output                      | Controlled wrapper or explicit action buttons; server-authoritative replacement.                                 |
| Two-nav-test requirement produces a meaningless snapshot edit             | Low      | Brittle regression test without added coverage                        | Update shell deep links; add an explicit Settings-child assertion to the scope test.                             |
| ROADMAP overclaims plugin runtime delivery                                | Medium   | Product status becomes inaccurate                                     | Describe management UI and telemetry limitation separately; keep runtime deferred.                               |

### Integration challenges

- The browser UI uses a complete list response, while reload returns aggregate
  counters only. Treat reload and refresh as two separately reportable stages.
- Missing durable records remain actionable in the backend. The UI should
  preserve that capability but change its wording to future intent.
- `navigationScopeFiltering.test.ts` does not currently snapshot Settings
  children. The second test update should add targeted coverage rather than
  disturb top-level expectations.
- The current production executor is unavailable, but this fact is not an API
  field. Repository implementation knowledge cannot substitute for
  browser-visible evidence.
- Reverse proxies are the reason the app-wide CSRF wildcard exists in
  development documentation. Prefer a route-level guard already proven by the
  MCP surface over an unverified global removal.

### Performance

- One bounded list request is sufficient. Do not issue detail requests per card.
- Pagination, virtualization, polling, background caching, and offline mutation
  queues are unnecessary for the bounded registry and explicit operator actions.
- Catalog resolution is negligible. Build a map once only if it simplifies code;
  do not add caching infrastructure.
- Retaining current rows during reload improves perceived performance and makes
  partial success recoverable.

### Security summary

- No critical research finding exists in the current authenticated/allow-listed
  API design.
- The server-side CSRF warning must be addressed by the dedicated child task
  before shipping the new mutation UI.
- Use the existing redacted error body or fixed local copy; never display raw
  response text, caught stack strings, paths, manifests, or logs.
- Preserve `Cache-Control:no-store` and do not persist inventory/errors in
  browser storage.
- No new dependency is warranted, limiting supply-chain expansion.

## Alternative Approaches

| Option                                                   | Pros                                                          | Cons                                                                             | Effort      | Recommendation                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------- |
| Page-local card/disclosure UI over existing list API     | Small, accessible, no N+1, fits current complete record       | Less independently linkable than detail routes                                   | Medium      | **Choose for #266.**                                                 |
| Dedicated per-plugin detail route now                    | Linkable, more space for future evidence                      | Adds routing/encoding/tests and fetches no new data                              | Medium-high | Defer until detail has unique value.                                 |
| Table with row-wide inspection link                      | Fast desktop comparison                                       | Nested switch/action accessibility and mobile reflow risk                        | Medium      | Use only with explicit separate controls; cards are safer initially. |
| Optimistic switch + rollback                             | Immediate visual response                                     | Can assert uncommitted state; race and screen-reader complexity                  | Medium      | Reject; await server response.                                       |
| Query/cache library and global store                     | Automatic invalidation/retry                                  | New dependency and state lifetime exceed one route's needs                       | High        | Reject.                                                              |
| Infer recent run from lifecycle timestamps/errors        | No backend work                                               | Factually incorrect and violates explainability                                  | Low         | Reject categorically.                                                |
| Add telemetry/backend/runtime inside #266                | Could satisfy literal recent-run wording                      | Violates exclusions, unresolved runtime, contract/persistence/security expansion | Very high   | Reject; future contract-first child.                                 |
| Remove app-wide `trustedOrigins:['*']` in #266           | Clean framework default                                       | Proxy compatibility is not proven; expands UI issue globally                     | Medium-high | Do not do in #266; prefer scoped child guard.                        |
| Add route-level same-origin mutation guard in child task | Focused, testable, mirrors MCP, preserves non-browser clients | Small backend change across mutation routes                                      | Medium      | **Choose as current security child.**                                |

## Task Breakdown Preview

| Phase | Task group                                     | Dependencies             | Complexity | Completion evidence                                                                  |
| ----- | ---------------------------------------------- | ------------------------ | ---------- | ------------------------------------------------------------------------------------ |
| 0     | Final design decisions and child issue linkage | Research complete        | Low        | Approved design/spec; telemetry and CSRF boundaries explicit.                        |
| 1     | Pure presentation/identity helpers and tests   | Generated types/catalogs | Medium     | Exhaustive lifecycle/catalog/encoding tests pass.                                    |
| 2A    | Settings route UI and state machine            | Phase 1                  | High       | Disabled, empty, populated, stale, and failure states render correctly.              |
| 2B    | Enable/disable/reload orchestration            | Phase 1, 2A              | High       | Authoritative mutations, counters, refetch, alerts, concurrency tests pass.          |
| 2C    | Navigation and Settings hub                    | None                     | Low        | Registry/hub entries and both named navigation tests pass.                           |
| 3     | CSRF security child implementation             | Child issue/design       | Medium     | Same/foreign/malformed/absent Origin tests pass for unsafe operations.               |
| 4     | Playwright/accessibility/manual evidence       | 2A-3                     | High       | Intercepted flows, keyboard/reflow/dark mode/malicious text checks pass.             |
| 5     | ROADMAP/reporting and full validation          | All implementation       | Medium     | ROADMAP accurate; check/lint/plugin/nav/E2E gates recorded.                          |
| 6     | PR review, fixes, CI, merge, cleanup           | Validated branch         | Medium     | Review artifact resolved, CI green, squash merge confirmed, branch/worktree removed. |

Suggested validation set:

```bash
deno task check
deno task lint
deno task test plugins
deno test packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts \
  packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts \
  packages/praxrr-app/src/tests/routes/pluginManagementPresentation.test.ts \
  --allow-read --allow-env
deno task test:e2e
graphify update .
```

The implementation plan should replace placeholder test paths with the actual
created files and run the focused Playwright spec directly before the full E2E
suite. It should also include tests for `401`, `404`, `409`, `500`, malformed
JSON, network failure, out-of-order responses, malicious authored strings,
composite identities, and the CSRF child route behavior.

## Key Decisions Needed

The research supports making these decisions now rather than leaving them open
during implementation:

1. **Route:** use `/settings/plugins`, globally visible even when disabled.
2. **Scope:** #266 is UI integration only; no database, OpenAPI, runtime,
   execution, or persistence expansion.
3. **Telemetry:** show “Execution telemetry unavailable in this build”; do not
   infer runtime state or recent runs. Track authoritative telemetry as future
   contract-first child work.
4. **Inspection:** use a feature-specific card with an accessible disclosure in
   v1; no modal and no per-row detail request.
5. **Mutations:** immediate and server-authoritative; no dirty tracking and no
   optimistic toggle.
6. **Missing records:** allow backend-supported intent changes with “when
   rediscovered” wording.
7. **Concurrency:** reload blocks row mutations; each row blocks overlapping
   enablement requests.
8. **Catalogs:** shared capability and extension-point descriptors are the only
   UI policy sources.
9. **Navigation tests:** update the shell deep-link expectation and add a
   targeted Settings-child assertion to the second named test.
10. **CSRF:** complete a dedicated scoped Origin-guard child task before merge;
    do not make an unproven app-wide trusted-origin change in #266.
11. **ROADMAP:** record management UI as shipped separately from deferred
    runtime/telemetry.

## Open Questions

1. What exact deployment-neutral copy should the feature-off state use for
   restart/configuration guidance? Confirm whether every supported deployment
   requires restart after `PLUGINS_ENABLED` changes.
2. Does the project have a stable, safe logs route that can be linked after
   rejected manifests or lifecycle errors, or should the first version provide
   text-only log guidance?
3. Should explicit Enable/Disable buttons replace `Toggle.svelte` if the current
   component cannot be controlled without showing an unconfirmed value?
4. Should the CSRF child guard remain local to plugin routes or be extracted to
   a shared server helper with MCP? Apply the rule of three: share only if the
   semantics are demonstrably identical and the extraction reduces drift.
5. For future telemetry, should evidence be retained per plugin or per extension
   point? A single plugin-level last run can hide one failing point behind a
   later successful invocation.
6. For future telemetry, what bounded retention, safe error taxonomy, runtime
   availability source, and redaction policy will make the contract
   authoritative without exposing paths, payloads, stack traces, or secrets?

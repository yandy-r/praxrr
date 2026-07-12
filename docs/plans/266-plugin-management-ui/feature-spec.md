# Feature Spec: Plugin Management UI (#266)

## Executive Summary

Issue #266 adds a `/settings/plugins` operator page over the authenticated
management API shipped by #264. It exposes validated identity, discovery,
durable enablement intent, lifecycle state, declared extension points, wiring
metadata, and human-readable grants while supporting enable, disable, and reload
actions. The implementation reuses generated types, client-safe catalogs,
page-local Svelte state, and existing UI components without new dependencies or
runtime integration. Because the API has no invocation fields, the page
explicitly reports execution telemetry as unavailable instead of inferring runs.
A scoped same-origin guard protects the existing body-less mutation routes from
the repository's wildcard CSRF trust setting.

## External Dependencies

### APIs and Services

#### Praxrr Plugin Management API

- **Documentation**: `docs/api/v1/paths/plugins.yaml` and
  `docs/api/v1/schemas/plugins.yaml`
- **Authentication**: existing same-origin Praxrr session/auth middleware
- **Key Endpoints**:
  - `GET /api/v1/plugins`: feature-aware, redacted durable registry
  - `GET /api/v1/plugins/{apiVersion}/{id}`: one namespace-qualified record
  - `POST /api/v1/plugins/{apiVersion}/{id}/enable`: persist enablement intent
  - `POST /api/v1/plugins/{apiVersion}/{id}/disable`: persist disablement intent
  - `POST /api/v1/plugins/reload`: serialized scan/reconciliation summary
- **Rate Limits**: no HTTP rate limit; reload is bounded, serialized, and
  single-flight
- **Pricing**: none; local application API

The browser will use relative URLs and encode `apiVersion` and `id` as
independent path segments. Responses are `Cache-Control: no-store` and remain
the authoritative UI state.

### Libraries and SDKs

| Library/surface        | Version/source         | Purpose                                            |
| ---------------------- | ---------------------- | -------------------------------------------------- |
| Svelte / SvelteKit     | repository lockfile    | Route UI and same-origin browser requests          |
| Generated API types    | `$api/v1.d.ts`         | Compile-time wire-contract fidelity                |
| Shared plugin catalogs | `$shared/plugins`      | Capability labels and extension-point wiring facts |
| Existing Praxrr UI     | `$ui`, `$alerts/store` | Cards, badges, buttons, pending states, and alerts |

No request, query-cache, table, sanitizer, state-management, or runtime
dependency is added.

### External Documentation

- [SvelteKit CSRF configuration](https://svelte.dev/docs/kit/configuration#csrf):
  wildcard trusted origins and framework origin checks.
- [Svelte events](https://svelte.dev/docs/svelte/basic-markup#Events): Svelte 5
  event attributes.
- [WCAG status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages):
  accessible asynchronous feedback.
- [WAI switch pattern](https://www.w3.org/WAI/ARIA/apg/patterns/switch/examples/switch/):
  stable names and state semantics for enablement controls.

## Business Requirements

### User Stories

**Primary User: Praxrr operator**

- As an operator, I want to discover and inspect validated plugins without
  reading manifests or logs.
- As an operator, I want enablement decisions to persist and remain distinct
  from runtime activation.
- As an operator, I want reload results and failures explained without losing
  the last confirmed view.
- As an operator, I want declared points, wired points, and grants explained in
  plain language.
- As an operator, I want feature-off and missing-runtime limitations to remain
  useful, honest states.

### Business Rules

1. **Composite identity**: every action is scoped by exact `apiVersion` plus
   case-insensitive `id`.
2. **Independent state dimensions**: feature availability, discovery, enablement
   intent, lifecycle, wiring, and execution evidence must never be collapsed
   into a single health badge.
3. **Intent is not execution**: `enabled` means persisted operator intent, not
   active or running.
4. **Discovery is not execution**: `discovered` and `registered` do not prove
   runtime readiness.
5. **Lifecycle errors stay lifecycle errors**: `lastError` must never be labeled
   a run error.
6. **Catalog authority**: point wiring and capability safety come only from
   shared catalogs.
7. **Deny by construction**: current grants cannot represent credential, secret,
   network, filesystem, environment, database, or write access.
8. **Feature-off is normal**: `{ pluginsEnabled:false, items:[] }` renders
   configuration guidance, not an API error.
9. **Missing records remain visible**: `discovered:false` is retained
   intent/history and uses “when rediscovered” wording.
10. **Server-authoritative mutations**: keep confirmed state while pending and
    replace the complete record only from a successful response.
11. **Reload is two-stage**: reconcile, report counters, then refetch the
    authoritative list.
12. **No dirty state**: immediate persisted actions do not use the navigation
    dirty store.
13. **Escaped authored content**: all manifest fields and errors render as
    ordinary Svelte text.
14. **Mutation origin policy**: browser mutation requests with an `Origin` must
    be same-origin; authenticated non-browser clients without `Origin` remain
    supported.

### Edge Cases

| Scenario                       | Expected Behavior                                          | Notes                                                 |
| ------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------- |
| Feature globally disabled      | Informational disabled panel; no mutation controls         | Explain `PLUGINS_ENABLED` is deployment configuration |
| Enabled registry is empty      | “No plugins discovered” plus Reload                        | Distinct from feature-off and failure                 |
| Missing durable record         | Remains inspectable; action wording applies on rediscovery | Not shown as installed/running                        |
| Mutation returns 404           | Preserve state, refetch list, explain record changed       | Identity may have been pruned                         |
| Mutation returns 409           | Transition/refetch into disabled state                     | Deployment flag changed concurrently                  |
| Reload rejects manifests       | Report aggregate rejected count only                       | Do not invent rejected identities/details             |
| Reload succeeds, refetch fails | Keep stale list and say refresh failed                     | Do not report the committed reload as failed          |
| Runtime/run fields absent      | “Execution telemetry unavailable in this build”            | No inferred runtime badge or timestamp                |
| Foreign or malformed Origin    | Reject unsafe mutation before state change                 | Read-only routes remain unchanged                     |
| Authenticated CLI omits Origin | Permit existing management API use                         | Auth middleware remains required                      |

### Success Criteria

- [ ] Discovered and retained plugins show exact identity, lifecycle, points,
      and grants.
- [ ] Enable, disable, and reload use exact existing endpoints and persist
      across refetch/reload.
- [ ] Feature-off, enabled-empty, loading, stale, and API-error states are
      distinct and recoverable.
- [ ] Lifecycle evidence and unavailable execution telemetry are labeled
      truthfully per plugin.
- [ ] The Settings hub, nav registry, and both named navigation regression tests
      cover the route.
- [ ] Plugin mutation endpoints reject foreign/malformed browser origins without
      breaking CLI calls.
- [ ] Responsive, keyboard, escaped-text, and async-status behavior is tested.
- [ ] `ROADMAP.md` records shipped management UI without claiming runtime
      execution shipped.

## Technical Specifications

### Architecture Overview

```text
Settings hub + NAV_REGISTRY
             |
             v
 /settings/plugins/+page.svelte
       | GET list                | POST enable/disable
       v                         v
 explicit page state       Origin guard -> existing host queue
       |                         |
       +---- PluginCard <--------+ authoritative PluginRecord
       |
       + POST reload -> counters -> GET list

 PluginRecord capabilities ------> CAPABILITY_CATALOG
 PluginRecord extensionPoints ---> EXTENSION_POINTS
```

The route owns all I/O and page state. `PluginCard.svelte` is presentation-only.
A small `presentation.ts` contains only pure, correctness-heavy mapping and URL
helpers so catalog, identity, lifecycle, and wording invariants can be unit
tested.

### Data Models

No database migration or new persisted UI model is required. The page consumes
the existing generated `PluginRecord`:

| Field                    | Type                  | UI meaning                                                     |
| ------------------------ | --------------------- | -------------------------------------------------------------- |
| `manifest`               | validated metadata    | Exact identity, declarations, grants, and optional description |
| `enabled`                | boolean               | Persisted administrator intent                                 |
| `discovered`             | boolean               | Present in the latest successful reconciliation                |
| `state`                  | closed lifecycle enum | Last recorded lifecycle state                                  |
| `registeredAt`           | RFC 3339              | Registration time, never last-run time                         |
| `lastError`              | string or null        | Safe lifecycle error, never inferred execution error           |
| `createdAt`, `updatedAt` | RFC 3339              | Durable record timestamps                                      |

### API Design

The plugin data contract is consumed unchanged. The only server addition is a
feature-local unsafe request guard applied before enable, disable, and reload
mutations:

```ts
function rejectCrossOriginPluginMutation(
  request: Request,
  url: URL
): Response | null;
```

- absent `Origin`: permit for authenticated non-browser clients;
- malformed `Origin`: return 403 without mutation;
- origin not exactly equal to `url.origin`: return 403 without mutation;
- same origin: continue to the existing handler;
- explicit `Sec-Fetch-Site: cross-site` may be rejected as defense in depth.

The guard must use a stable, redacted response and receive focused tests. It
does not add CORS, change read endpoints, or remove the app-wide wildcard
without proxy/deployment evidence.

### System Integration

#### Files to Create

- `packages/praxrr-app/src/routes/settings/plugins/+page.svelte`: state machine
  and orchestration.
- `packages/praxrr-app/src/routes/settings/plugins/components/PluginCard.svelte`:
  plugin display.
- `packages/praxrr-app/src/routes/settings/plugins/presentation.ts`: pure
  display/identity helpers.
- `packages/praxrr-app/src/tests/routes/pluginManagementPresentation.test.ts`:
  helper contract tests.
- Focused Playwright plugin-management spec under the existing E2E spec
  directory.
- A small server plugin-mutation origin guard and its focused tests, location
  chosen by existing route/security patterns during planning.

#### Files to Modify

- `packages/praxrr-app/src/lib/server/navigation/registry.ts`: add
  `settings.plugins` child.
- `packages/praxrr-app/src/routes/settings/+page.svelte`: add Plugins
  destination.
- `packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts`: deep-link
  expectation.
- `packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts`:
  meaningful Settings-child assertion without changing unrelated top-level
  snapshots.
- Existing plugin mutation routes/tests: apply and verify the scoped origin
  guard.
- `ROADMAP.md`: mark the management UI delivered and keep runtime/telemetry
  deferred.

#### Configuration

- `PLUGINS_ENABLED`: unchanged; the page explains its current value but cannot
  mutate it.
- `PLUGINS_DIR`: unchanged; reload scans the existing configured directory.

## UX Considerations

### User Workflows

#### Primary Workflow: Inspect and manage plugins

1. **Load registry**
   - User: opens Settings → Plugins.
   - System: renders a stable loading shell, then one explicit page state.
2. **Inspect facts**
   - User: expands a plugin card.
   - System: shows identity, discovery, intent, lifecycle, points, grants,
     errors, and telemetry limit.
3. **Change intent**
   - User: enables/disables a plugin.
   - System: keeps confirmed value while pending, then replaces the row and
     alerts on success.
4. **Reload**
   - User: requests reconciliation.
   - System: retains current rows, reports counters, refetches, and
     distinguishes partial refresh.

#### Error Recovery Workflow

1. **Error Occurs**: list, mutation, reload, or post-reload refresh fails.
2. **User Sees**: action-specific escaped error, retained confirmed data where
   available, and stale labeling when appropriate.
3. **Recovery**: Retry load/row action/list refresh; never queue mutations
   offline.

### UI Patterns

| Component                | Pattern                              | Notes                                                   |
| ------------------------ | ------------------------------------ | ------------------------------------------------------- |
| Page state               | Inline informational/error card      | Disabled, empty, and failure use different copy/actions |
| Plugin summary           | Responsive card/disclosure           | Avoid row-wide links around nested controls             |
| State facts              | Separate label/value rows and badges | Text accompanies color                                  |
| Enablement               | Controlled toggle or explicit button | Stable accessible name; server-confirmed value          |
| Reload                   | Page-level button plus polite status | Keeps list visible while pending                        |
| Capability/point details | Catalog-backed lists                 | Exact id plus human label and wiring/safety description |

### Accessibility Requirements

- Reflow at an equivalent 320 CSS-pixel viewport without page-level horizontal
  scrolling.
- Native interactive elements, visible focus, stable accessible names, and
  adequate touch targets.
- `aria-busy` for affected regions and polite live status for routine
  asynchronous changes.
- Persistent inline recovery in addition to transient alerts.
- No color-only states, tooltip-only evidence, `{@html}`, or nested interactive
  row targets.

### Performance UX

- One bounded list request; no detail N+1, pagination, polling, virtualization,
  or background cache.
- Per-identity mutation guard plus a global reload guard/request generation
  prevents stale writes.
- Reload preserves context and only replaces the list after a successful
  authoritative refetch.

## Recommendations

### Implementation Approach

**Recommended Strategy**: ship the complete UI integration over the existing
contract, add only the scoped mutation-origin security guard needed for safe
browser exposure, and represent missing execution evidence explicitly rather
than expanding #266 into runtime/telemetry persistence.

**Phasing:**

1. **Phase 1 - Pure contract presentation**: identity, URL, lifecycle, point,
   and grant helpers/tests.
2. **Phase 2 - UI and navigation**: route state machine, card, actions,
   settings/nav registration.
3. **Phase 3 - Mutation security**: same-origin guard and negative/positive
   route tests.
4. **Phase 4 - Integration evidence**: E2E/accessibility/navigation tests and
   `ROADMAP.md`.

### Technology Decisions

| Decision           | Recommendation                                | Rationale                                                              |
| ------------------ | --------------------------------------------- | ---------------------------------------------------------------------- |
| Route              | `/settings/plugins`                           | Operator management belongs under Settings and must remain visible off |
| Inspection         | Accessible card disclosure                    | List already contains all public data; no modal/N+1 request            |
| Mutation state     | Pessimistic/server-authoritative              | Prevents false durable state and rollback races                        |
| Missing records    | Allow intent changes with rediscovery wording | Matches durable backend semantics                                      |
| Telemetry          | Explicit unavailable state                    | No authoritative runtime/run fields exist                              |
| CSRF               | Scoped route Origin guard                     | Fixes browser mutation exposure without unproven global proxy changes  |
| State/dependencies | Page-local/native/existing UI                 | Bounded single-route scope needs no framework/store                    |

### Quick Wins

- Add globally visible navigation and the truthful feature-off state.
- Reuse shared catalogs to obtain complete human-readable permission and wiring
  copy immediately.
- Add the telemetry limitation and lifecycle-error vocabulary before visual
  polish.

### Future Enhancements

- Contract-first host runtime availability and structured per-point run
  evidence.
- Safe bounded rejected-manifest evidence if aggregate counts/log guidance prove
  insufficient.
- Search/filter, detail deep links, audit trail, and server-enforced roles only
  after demonstrated need.

## Risk Assessment

### Technical Risks

| Risk                                          | Likelihood | Impact | Mitigation                                                    |
| --------------------------------------------- | ---------- | ------ | ------------------------------------------------------------- |
| Lifecycle facts presented as execution        | Medium     | High   | Independent status model and wording tests                    |
| Foreign-origin browser mutation               | Medium     | High   | Scoped same-origin guard and route tests                      |
| Stale responses overwrite newer state         | Medium     | High   | Pending guards, request generation, authoritative replacement |
| Authored content becomes XSS                  | Low        | High   | Text interpolation only and malicious fixtures                |
| Namespace/id mismatch updates wrong row       | Low        | High   | Composite keys and independently encoded exact segments       |
| Reload/refetch partial success is misreported | Medium     | Medium | Separate reconciliation and refresh statuses                  |
| Navigation/roadmap drift                      | Medium     | Medium | Named snapshot tests and explicit roadmap wording             |

### Integration Challenges

- Reload returns aggregate counters, not records; a second list request is
  mandatory.
- Retained missing rows are deliberately actionable and need future-intent
  language.
- Existing `Toggle.svelte` must remain controlled; use explicit buttons if it
  cannot.
- Proxy behavior prevents casually removing the global wildcard CSRF setting in
  this UI change.

### Security Considerations

#### Critical — Hard Stops

| Finding         | Risk                                           | Required Mitigation       |
| --------------- | ---------------------------------------------- | ------------------------- |
| None identified | Existing API is authenticated and allow-listed | Preserve those boundaries |

#### Warnings — Must Address

| Finding                            | Risk                            | Mitigation                                   | Alternatives                                      |
| ---------------------------------- | ------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| Wildcard trusted CSRF origins      | Cross-origin body-less mutation | Exact Origin guard on unsafe plugin routes   | Token/custom-header or verified global allow-list |
| Authored manifest/error strings    | Stored XSS                      | Ordinary escaped Svelte text only            | Reviewed sanitizer only for future rich content   |
| Dynamic route segments             | Path confusion                  | Independent `encodeURIComponent` calls       | Native URL helper                                 |
| Misleading permission/runtime copy | Operator security error         | Shared catalogs and independent facts        | Exhaustive typed view mapping                     |
| Raw error display                  | Diagnostic leakage              | Stable redacted error body or fixed fallback | Client-owned code mapping                         |

#### Advisories — Best Practices

- Use relative same-origin fetches and preserve `Cache-Control:no-store`.
- Do not persist inventory/errors in browser storage or add remote
  assets/scripts.
- Treat CSP and richer mutation audit logging as separate cross-application
  follow-ups.

## Task Breakdown Preview

### Phase 1: Presentation Contract

**Focus**: encode truthfulness and identity before UI I/O. **Tasks**:

- Add pure helpers and exhaustive catalog/lifecycle/URL tests.
- Define responsive card inputs and controlled action events.
  **Parallelization**: helper tests and component markup can begin concurrently
  after paths are fixed.

### Phase 2: Management Route

**Focus**: all normal/error states and authoritative actions. **Dependencies**:
Phase 1 helpers. **Tasks**:

- Implement load/feature-off/empty/populated/stale/error state machine.
- Implement enable/disable and reload/refetch with alerts and live status.
- Add Settings hub/nav entries and named navigation assertions.

### Phase 3: Mutation Security

**Focus**: protect newly browser-reachable unsafe operations. **Tasks**:

- Implement route-level origin guard.
- Test same-origin, foreign, malformed, absent-origin, and no-mutation outcomes.

### Phase 4: Completion Evidence

**Focus**: integration, accessibility, roadmap, and full validation. **Tasks**:

- Add deterministic Playwright flows and manual accessibility/security checks.
- Update `ROADMAP.md`, graph, and validation evidence.

## Decisions Needed

The design workflow resolves the implementation decisions as follows:

1. **Recent run wording**
   - Options: infer; expand runtime/backend; report unavailable.
   - Decision: report unavailable and keep authoritative telemetry as future
     contract-first work.
2. **Mutation protection**
   - Options: global CSRF config removal; route guard; client-only options.
   - Decision: route-level same-origin guard; retain absent-Origin CLI
     compatibility.
3. **Inspect interaction**
   - Options: modal; detail N+1; accessible disclosure.
   - Decision: feature-specific card disclosure for the current complete list
     record.
4. **Missing records**
   - Options: hide/disable; preserve future intent action.
   - Decision: preserve and label intent as applying when rediscovered.
5. **Navigation regression**
   - Options: update one natural snapshot; make meaningless array change; add
     targeted assertion.
   - Decision: update shell deep links and add a meaningful Settings-child
     assertion to the second named test.

## Research References

- [research-external.md](./research-external.md): Existing API integration and
  contract gap.
- [research-business.md](./research-business.md): Rules, workflows, and
  lifecycle semantics.
- [research-technical.md](./research-technical.md): Architecture, file map,
  tests, and constraints.
- [research-ux.md](./research-ux.md): Responsive, accessible interaction and
  state design.
- [research-security.md](./research-security.md): Severity-rated browser and
  origin risks.
- [research-practices.md](./research-practices.md): Reuse, KISS, modularity, and
  testability.
- [research-recommendations.md](./research-recommendations.md): Consolidated
  alternatives and phasing.

# Documentation Research: 266 Plugin Management UI

## Documentation Overview

The repository has a strong contract and subsystem architecture base for #266:
the durable plugin API is documented in modular OpenAPI, generated types mirror
it, and `docs/architecture/plugins.md` explains the purity/server boundary and
registry lifecycle. The missing layer is operator-facing and UI-specific
documentation. There is no `/settings/plugins` guide, the general endpoint/error
indexes do not describe plugin management, and parts of the plugin architecture
page still describe the pre-#263 “no production call-site” state.

Implementation should treat the feature spec and modular OpenAPI as the
immediate contract, use the plugin architecture page for subsystem invariants,
and update roadmap/API/operator documentation in the same change without
claiming that runtime execution or telemetry exists.

## Architecture Docs

### Required

- `docs/plans/266-plugin-management-ui/feature-spec.md` — **primary feature
  source of truth**. Defines the route, UI states, exact endpoint flow,
  composite identity, catalog authority, server-authoritative mutation behavior,
  two-stage reload, scoped Origin policy, accessibility expectations, file map,
  and the prohibition on inferred execution telemetry.
- `docs/architecture/plugins.md` — **primary plugin subsystem architecture**.
  Documents the hard boundary between client-safe `$shared/plugins` and
  server-only `$server/plugins`, durable registry semantics, case-insensitive ID
  within exact `apiVersion`, lifecycle meaning, capability redaction, host
  serialization/single-flight reload, feature-off behavior, and management API.
  Read it to avoid bypassing the redacted response boundary or confusing
  intent/lifecycle with execution.
- `docs/ARCHITECTURE.md`, especially the navigation-shell section around “20.2
  Navigation Shell Contract” — documents server-produced `NavShell`,
  deterministic ordering, child navigation, mobile priority, and Arr-scope
  filtering. This governs the `settings.plugins` registry addition and explains
  why the route belongs under the existing Settings parent rather than as a new
  top-level item.
- Project-local `CLAUDE.md` / supplied agent instructions — required repository
  contract for Svelte 5 without runes, `onclick`, alerts, routes-over-modals,
  `/api/v1`, OpenAPI/type lockstep, build artifact paths, and graphify
  maintenance. These constraints materially shape #266 even though this file is
  operational guidance rather than public product documentation.

### Nice to have / historical context

- `docs/plans/35-wasm-plugin-system/plan.md` — original decision record for the
  extension-point and capability model. Useful when a catalog invariant is
  unclear; not a substitute for current source or current architecture docs.
- `docs/plans/35-wasm-plugin-system/phase-1-foundation.md` and
  `docs/plans/35-wasm-plugin-system/implementation-notes.md` — historical
  Phase-1 boundaries and implementation rationale.
- `docs/prps/specs/264-durable-plugin-registry.spec.md` — predecessor
  management-backend spec.
- `docs/prps/plans/completed/264-durable-plugin-registry.plan.md` — completed
  implementation plan for the API and persistence layer that #266 consumes.
- `docs/prps/reports/264-durable-plugin-registry-report.md` — shipped-file and
  validation evidence for #264. Helpful for locating tests, but implementation
  must verify current code rather than assume a historical report is current.
- The other research files in `docs/plans/266-plugin-management-ui/` —
  supporting business, security, integration, pattern, technical, UX, and
  recommendation evidence. They inform planning, while `feature-spec.md` remains
  the consolidated decision set.

## API Docs

### Required

- `docs/api/v1/openapi.yaml` — canonical assembled `/api/v1` contract. It
  references the modular plugin path/schema files and drives generated API
  types.
- `docs/api/v1/paths/plugins.yaml` — exact list/detail/enable/disable/reload
  operations, response codes, namespace parameters, feature-off behavior,
  durable-intent wording, and serialized reload semantics. The UI must use these
  existing operations rather than add a page-specific API.
- `docs/api/v1/schemas/plugins.yaml` — authoritative public shapes for
  `PluginRecord`, list/mutation/ reload responses, lifecycle enum,
  capability/point enums, and stable errors. Its descriptions explicitly say
  enabled is intent, `lastError` is lifecycle evidence, and source/raw manifest
  data is excluded.
- `packages/praxrr-app/src/lib/api/v1.d.ts` — generated compile-time mirror used
  by the Svelte page, presentation helpers, and Playwright fixtures. This is
  generated output rather than prose, but it is required reading for
  implementation-level type names and confirms that there are no invocation,
  last-run, run-count, or runtime-availability fields.
- `docs/api/authentication.md` — explains central session and `X-Api-Key`
  authentication. The scoped Origin guard supplements this authentication
  boundary; it does not replace auth or introduce CORS.
- `docs/api/errors.md` — general status/error semantics. It should be updated if
  the new plugin 403 behavior is documented centrally.
- `docs/api/README.md` — establishes the division between OpenAPI contract and
  runtime route behavior and points contributors to
  authentication/errors/endpoints references.

### Supporting runtime documentation in code comments

- `packages/praxrr-app/src/lib/server/plugins/responses.ts` — comments define
  the allow-list response mapper and stable redacted errors; source directories
  and raw manifest JSON must not cross the UI boundary.
- `packages/praxrr-app/src/lib/server/plugins/host.ts` — comments define reload
  single-flight, operation serialization, durable-first enablement, and atomic
  snapshot publication.
- `packages/praxrr-app/src/lib/shared/plugins/capabilities.ts` — comments define
  deny-by-construction grants and the sole capability-to-point mapping.
- `packages/praxrr-app/src/lib/shared/plugins/extensionPoints.ts` — comments
  define declared versus wired points and the pure client-safe catalog.
- `packages/praxrr-app/src/routes/api/v1/mcp/+server.ts` — closest documented
  same-origin precedent: absent Origin passes for a non-browser client;
  malformed/foreign browser Origin returns 403.

### Nice to have

- `docs/api/endpoints.md` — general endpoint index. It currently does not
  surface plugin management, so it is navigation context rather than a complete
  plugin reference.
- `.github/workflows/publish-api.yml` — relevant only if OpenAPI
  publishing/validation behavior must be understood after contract documentation
  changes.
- `packages/praxrr-api/README.md` — explains the mirrored API
  package/distribution boundary; #266 should not require package changes unless
  the OpenAPI contract itself changes.

## Development Guides

### Required

- `docs/CONTRIBUTING.md` — contributor quickstart and binding local conventions:
  Deno commands, Svelte 5/no runes, `onclick`, `alertStore`, route preference,
  and `/api/v1` policy.
- `docs/DEVELOPMENT.md` — repository development/versioning workflow. Relevant
  for running locally and understanding documentation/version channels; it does
  not define feature behavior.
- `deno.json` — executable task source for `dev`, `lint`, `check`, `test`, type
  generation, and E2E commands. Use it rather than copying possibly stale
  commands from old plans.
- `scripts/test.ts` — focused Deno test routing. It already has a `plugins`
  alias covering shared catalogs, host, DB registry, plugin routes, and MCP. A
  new presentation test under `src/tests/routes/` is not automatically included
  by that alias unless the alias is expanded or the file is invoked directly.
- `playwright.config.ts` — E2E location and execution contract: specs live under
  `packages/praxrr-app/src/tests/e2e/specs`, use `BASE_URL` (default port 6969),
  run with one worker, and retain failure evidence.
- `docs/site/src/content/docs/app/testing.md` — the maintained
  documentation-site testing guide; useful for the difference between Deno
  unit/route tests and Playwright setup.
- `docs/site/src/content/docs/app/development.md` — maintained
  documentation-site development guide and local workflow reference.

### Test sources that function as executable documentation

- `packages/praxrr-app/src/tests/routes/plugins.test.ts` — definitive examples
  of API event builders, database isolation, feature flag mutation/restoration,
  allow-list redaction, namespace behavior, enable/disable durability, and
  reload reconciliation. Extend here for Origin/no-mutation coverage.
- `packages/praxrr-app/src/tests/base/navigationShellLayout.test.ts` — exact
  navigation deep-link contract that must gain `/settings/plugins` without
  changing top-level routes.
- `packages/praxrr-app/src/tests/base/navigationScopeFiltering.test.ts` —
  Arr-scope/navigation behavior; add a meaningful Settings-child assertion
  rather than altering unrelated top-level snapshots.
- Existing mocked-API Playwright specs such as
  `packages/praxrr-app/src/tests/e2e/specs/config-health-trends-export.spec.ts`
  — examples of importing generated schema types, intercepting routes, hostile
  authored strings, viewport/accessibility assertions, and deterministic async
  behavior.
- `packages/praxrr-app/src/tests/mcp/mcp.test.ts` — executable documentation for
  the same-origin/ absent-Origin policy used by MCP; useful to keep plugin
  mutation security behavior consistent.

## README Files

- `README.md` — **required orientation** for product scope, local runtime, and
  top-level commands. It is not currently a plugin operator guide.
- `docs/README.md` — **required documentation map**. It points to architecture,
  API, feature, and development areas, but does not currently link
  `docs/architecture/plugins.md` or a plugin feature guide directly.
- `docs/api/README.md` — **required API documentation map** and source-of-truth
  statement.
- `docs/features/README.md` — nice-to-have feature-guide index. No plugin
  management guide exists here today.
- `packages/praxrr-api/README.md` — nice-to-have distribution/mirror context
  only.
- Other package READMEs (`praxrr-db`, `praxrr-schema`, parser, Arr/auth
  utilities) are not required for this UI because #266 changes neither PCD
  schema nor Arr/parser behavior.

## External References

The feature spec already selects the external references relevant to
implementation. They should be used to settle platform semantics, not to
override repository conventions:

- SvelteKit CSRF configuration: `https://svelte.dev/docs/kit/configuration#csrf`
  — explains framework Origin handling and why the repository's wildcard trust
  setting requires a scoped route guard.
- Svelte event attributes: `https://svelte.dev/docs/svelte/basic-markup#Events`
  — supports the repository's `onclick` rule.
- WCAG 2.2 status messages:
  `https://www.w3.org/WAI/WCAG22/Understanding/status-messages` — guides polite
  asynchronous status without forced focus changes.
- WAI-ARIA switch example:
  `https://www.w3.org/WAI/ARIA/apg/patterns/switch/examples/switch/` — useful
  only if enablement is implemented as a switch; explicit buttons are acceptable
  and may be clearer for pessimistic state.

## Must-Read Documents

Read in this order before implementation:

1. `docs/plans/266-plugin-management-ui/feature-spec.md` — accepted
   product/technical decisions.
2. `docs/api/v1/paths/plugins.yaml` and `docs/api/v1/schemas/plugins.yaml` —
   exact wire behavior and meanings.
3. `docs/architecture/plugins.md` — subsystem invariants and lifecycle
   boundaries, with the stale passages noted below checked against current
   source/ROADMAP.
4. `packages/praxrr-app/src/lib/api/v1.d.ts` — generated types actually consumed
   by UI/test code.
5. `docs/CONTRIBUTING.md` and project-local `CLAUDE.md` — implementation
   conventions.
6. `docs/ARCHITECTURE.md` navigation-shell section — nav integration contract.
7. `packages/praxrr-app/src/tests/routes/plugins.test.ts`,
   `src/tests/base/navigationShellLayout.test.ts`, and
   `src/tests/base/navigationScopeFiltering.test.ts` — executable regression
   contracts.
8. `scripts/test.ts`, `playwright.config.ts`, and
   `docs/site/src/content/docs/app/testing.md` — validation workflow.
9. `ROADMAP.md` plugin entries — exact shipped/deferred claims that must be
   updated carefully.

## Documentation Gaps

### Must address in #266

1. **No operator guide for plugin management.** There is no feature page
   explaining how to find Settings → Plugins, what
   `PLUGINS_ENABLED`/`PLUGINS_DIR` mean, how enablement differs from active
   execution, how retained missing records behave, what reload counters mean, or
   why execution telemetry is unavailable. Add a focused guide (preferably under
   `docs/features/` and the versioned docs site if both are maintained) or
   extend the plugin architecture page with an operator section.
2. **Plugin architecture text is partially stale after #263.** The header and
   extension-point table in `docs/architecture/plugins.md` still contain “zero
   call-sites,” “no production call-site,” or similar pre-wiring language even
   though ROADMAP records both observe producers shipped in #269. Update the
   page to say the producers are wired but dispatch remains inert because
   `UnavailablePluginExecutor` is the only production executor. Verify catalog
   rows against current `$shared/plugins/extensionPoints.ts` and
   `capabilities.ts` while editing; do not preserve outdated kind/grant
   descriptions.
3. **Architecture page lacks the management UI flow.** Add `/settings/plugins`
   to the documented module/data-flow map and explain that it consumes only the
   redacted list/mutation contracts and shared pure catalogs. State explicitly
   that the page has no DB/server-loader bypass and no invocation evidence.
4. **OpenAPI lacks the new scoped 403 behavior.**
   `docs/api/v1/paths/plugins.yaml` currently documents 200/400/404/409/500 but
   not foreign/malformed-Origin rejection. If the route begins returning 403,
   add an accurate 403 response (and any shared stable response schema chosen by
   implementation), then regenerate/check `$api/v1.d.ts` so portable contract
   and runtime stay in lockstep. Do not invent a CORS claim or require Origin
   for CLI clients.
5. **General API indexes omit plugin management.** `docs/api/endpoints.md` and
   `docs/api/errors.md` do not currently identify the plugin route family or its
   feature-off/403 semantics. Add concise entries or ensure the generated API
   reference is the clearly linked discovery path.
6. **ROADMAP must advance #266 without advancing runtime.** Update the current
   status paragraph, #35 status table, advanced-capabilities checklist, deferred
   watchlist, and/or add a dated shipped entry consistently. Required wording:
   management UI shipped; runtime dependency, plugin execution, activation
   proof, and telemetry remain deferred. Remove “#266 remains open/incomplete”
   only when the implementation is actually complete.
7. **Documentation indexes do not expose the plugin page.** Add the plugin
   architecture/feature guide to `docs/README.md` and `docs/features/README.md`
   (plus the docs-site sidebar/content collection if required by its build) so
   operators do not need a repository search.

### Should address or explicitly defer

8. **No documented UI state vocabulary.** Loading, feature-off, enabled-empty,
   stale-after-refresh, retained missing, lifecycle error, and
   telemetry-unavailable wording currently lives only in the #266 planning spec.
   Preserve the important semantic distinctions in durable operator docs or
   architecture docs rather than leaving them only in an implementation plan.
9. **No plugin-management E2E/testing note.** The general testing guide does not
   mention the feature flag, API interception, hostile authored-content
   fixtures, or Origin regression cases. A short feature-specific validation
   section would help future maintainers; at minimum, tests themselves should
   carry descriptive names and comments.
10. **Test alias coverage may be surprising.** The `plugins` alias in
    `scripts/test.ts` includes the existing route file but not an arbitrary new
    `pluginManagementPresentation.test.ts`. Either add that file to the alias or
    document/run it explicitly in validation instructions.
11. **No public explanation of catalog authority.** Operator docs should say
    declared points and grants are manifest declarations enriched by Praxrr's
    catalog, while “wired” is host metadata; none of these proves execution.
    This guards against future UI wording drift.

## Documentation Update Checklist

- [ ] Update `docs/architecture/plugins.md` for the management UI and current
      #263 wiring reality.
- [ ] Document `/settings/plugins` for operators and link it from documentation
      indexes.
- [ ] Document 403 Origin rejection in modular OpenAPI and regenerate/check
      generated types if the response contract changes.
- [ ] Add plugin entries to the general API endpoint/error navigation where
      appropriate.
- [ ] Update all relevant `ROADMAP.md` #35/#266 statements consistently and
      preserve runtime NO-GO.
- [ ] Keep all wording explicit: enabled = durable intent; discovered =
      reconciliation presence; lifecycle error is not run error; execution
      telemetry is unavailable.
- [ ] Run documentation/OpenAPI validation plus `deno task check`,
      `deno task lint`, focused plugin/ navigation tests, and the focused
      Playwright spec.

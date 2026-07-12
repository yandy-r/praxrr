# Business Research: Plugin Management UI (#266)

## Executive Summary

Issue #266 is the operator-facing completion of the current plugin-management
phase. Its value is not simply a list with switches: it is a trustworthy
explanation of what Praxrr knows about each plugin, what the operator has asked
Praxrr to do, and what the current host can actually do.

The existing management contract supports four useful facts and actions:

- whether plugin management is globally enabled;
- durable, validated manifest metadata for discovered and previously discovered
  plugins;
- durable enablement **intent** for each API-version-qualified plugin; and
- a serialized reload that scans, validates, reconciles, and reports aggregate
  results.

The UI must preserve the distinctions already encoded by the domain:

- `enabled` is persisted operator intent, not proof of activation or successful
  execution;
- `discovered` means present in the latest successful reconciliation, while an
  undiscovered row is a retained tombstone and not a currently loadable plugin;
- a manifest **declares** extension points, but only two points are currently
  wired to real producers; and
- capabilities are a closed, observe-only allow-list. Credential, secret,
  network, filesystem, environment, database, and write/mutation grants do not
  exist and therefore cannot be granted.

There is one material acceptance-criteria gap in the current backend.
`PluginRecord` exposes a safe `lastError`, but it does not expose a recent run,
run status, execution timestamp, or runtime availability. The default executor
remains unavailable after the Extism/Deno spike's NO-GO result. Consequently,
the page can truthfully show lifecycle metadata and a lifecycle error, but
cannot claim to show recent execution status or dynamically prove runtime
availability without a contract change or an explicitly scoped informational
notice. This must be resolved during design rather than hidden behind optimistic
wording.

## User Stories

### Primary operator

- As an operator, I want one discoverable settings page listing installed and
  retained plugins so I can understand the plugin subsystem without inspecting
  files or calling the API.
- As an operator, I want to see a plugin's id, authored name, version, author,
  description, API version, lifecycle state, and current discovery state so I
  can identify it unambiguously.
- As an operator, I want to enable or disable a plugin and have that decision
  survive reloads so I can control future participation without editing its
  manifest or deleting its files.
- As an operator, I want to request a reload and receive a meaningful result so
  I can reconcile filesystem changes without restarting Praxrr.
- As a security-conscious operator, I want capabilities explained in plain
  language and want explicit confirmation that plugins receive no credential,
  secret, network, filesystem, environment, database, or write access from this
  contract.
- As an operator, I want each declared extension point labeled as currently
  wired or only declared so I do not mistake roadmap surface area for
  functioning behavior.
- As an operator, I want lifecycle errors and honest runtime limitations
  surfaced so an enabled plugin is never presented as activated or successfully
  executed without evidence.
- As an operator with plugins globally disabled, I want the page to remain
  useful and explain that `PLUGINS_ENABLED` must be enabled, without showing an
  application error or mutating stored intent.

### Maintainer and support user

- As a maintainer, I want the UI vocabulary to match the OpenAPI and shared
  plugin catalogs so support reports distinguish discovery, registration,
  enablement intent, wiring, and execution.
- As a support user, I want safe errors and timestamps, but not source
  directories, raw manifests, credentials, or internal filesystem/database
  diagnostics.

## Business Rules

### Identity and visibility

1. A plugin identity is `(apiVersion, id)`. The id comparison is
   case-insensitive within an exact API version namespace; the same id in
   another API version is a different identity. UI action URLs must preserve
   both values and must not infer a namespace.
2. The list may include both currently discovered plugins and retained missing
   rows. A missing row is not an installed/active plugin; it is durable history
   retained so its prior enablement decision can be restored if it reappears.
3. Only validated, allow-listed manifest metadata may be displayed. Local source
   directories, raw manifest JSON, and internal diagnostics are deliberately
   absent from the public contract.
4. Authored identifiers and names are displayed as persisted. The UI may format
   labels around them but must not silently normalize the underlying identity
   used for actions.
5. `author`, `description`, and engine constraints are optional. Their absence
   is neutral, not an error. Engine constraints are advisory in the current
   phase and must not be presented as enforced.

### Global feature state

6. When `PLUGINS_ENABLED` is off, list returns `200` with
   `pluginsEnabled: false` and no items. This is an intentional disabled state,
   not an empty successful scan and not a runtime failure.
7. A reload while globally disabled is a no-I/O, no-mutation success with
   `reloaded: false` and zero counts. Detail, enable, and disable operations
   reject with `plugins_disabled`.
8. The disabled page must explain how the deployment operator enables the
   feature. It must not imply the browser user can change the environment flag
   from this page.
9. An enabled feature with zero rows is distinct from a disabled feature: it
   means no durable plugins are currently visible after reconciliation (or the
   plugin directory is absent/not a directory and the host degraded to an empty
   registry).

### Enablement and lifecycle truthfulness

10. `enabled` means durable administrator intent only. Labels such as “running,”
    “active,” “loaded,” or “healthy” must not be derived from it.
11. Enable/disable updates are serialized with reload, persisted first, and
    reflected in the live snapshot before success is returned. The UI should
    replace its row from the mutation response rather than guessing the
    resulting state.
12. Reload preserves an existing plugin's enablement decision, updates its
    validated manifest, marks present plugins discovered/registered, and marks
    absent plugins undiscovered/unloaded.
13. A previously missing plugin that reappears regains its prior enablement
    intent. It does not require the operator to repeat a prior choice.
14. Enable/disable is technically permitted for a retained undiscovered row.
    Business presentation must make clear that this changes future intent only;
    it cannot make a missing plugin available. Whether “enable” should remain
    actionable on missing rows is an explicit design decision.
15. Lifecycle states `activated`, `failed`, and `unloaded` exist in the portable
    enum, but the current runtime phase normally reaches registered/unloaded
    persistence states and has no activation evidence. The UI must describe the
    returned state, not imply that every enum state is produced by the current
    host.
16. `lastError` is a safe last **lifecycle** error or null. It is not presently
    a durable last-run error. A null value means no recorded lifecycle error,
    not proof of a successful run.

### Declared versus wired extension points

17. Every manifest lists one or more declared extension points from the closed
    nine-point catalog. Declaration means the plugin requests that surface; it
    does not mean the host dispatches it.
18. Only these two observe points are wired to real producers in the current
    phase:
    - `config.profileCompiled.observe`
    - `sync.previewComputed.observe`
19. The other seven catalog points must be labeled “declared, not wired” (or
    equivalent), never simply “supported”:
    - `config.validation.observe`
    - `sync.beforeApply.observe`
    - `sync.afterApply.observe`
    - `parser.releaseTitle.transform`
    - `customFormat.condition.evaluate`
    - `notification.dispatch.observe`
    - `importExport.adapter`
20. Wired status comes from Praxrr's shared extension-point catalog, not from
    the plugin manifest. A plugin cannot promote its own declaration to wired
    status.
21. Observe points are non-mutating. Declared transform/provider points that
    would mutate or produce side effects remain unwired and have no grantable
    mutating capability in the current contract.

### Capability grants and deny-by-construction

22. Capabilities are not arbitrary permission strings. Only these four read
    capabilities can be represented, validated, persisted, and returned:
    - `read:resolved-profile` — read a redacted snapshot of a freshly compiled
      profile;
    - `read:sync-preview` — read a redacted preview/intent/summary snapshot
      without changing apply;
    - `read:custom-format` — read a redacted custom-format condition snapshot;
    - `read:config-validation` — read a redacted validation-result snapshot.
23. Every grant is `mutates: false` and `touchesSecrets: false`. The UI should
    communicate the stronger invariant: credentials/auth/session, secrets,
    network, filesystem, environment, database, and all write/mutation
    capabilities are structurally unrepresentable, not merely unchecked boxes.
24. A manifest capability is valid only when at least one of its declared
    extension points may consume it under the shared least-privilege mapping.
    Passing validation does not make an unwired point run.
25. Human-readable grant descriptions must be derived from the shared capability
    catalog so UI copy cannot drift from validator/host policy.

### Reload and error handling

26. A successful enabled reload reports aggregate counts for manifest files
    discovered, plugins registered, entries rejected, and persisted plugins now
    missing. “Discovered” in the reload summary counts manifest entries found,
    while a row's `discovered` flag means it survived validation and
    reconciliation; the UI must avoid conflating these meanings.
27. Malformed, invalid, or duplicate scan entries contribute to the rejected
    aggregate but are not returned as identifiable `PluginRecord` rows. The UI
    cannot provide per-plugin rejection details from the current API.
28. Missing/non-directory plugin storage degrades to an empty reconciliation
    rather than a fatal boot error. Unexpected scan/database failures preserve
    the previous live snapshot and return a redacted `internal_error` at the
    route boundary.
29. Mutation and reload failures must keep the current rendered data, show alert
    feedback, and offer a retry. The UI must not optimistically claim durable
    success before the response arrives.
30. All management responses are non-cacheable. After a successful reload, the
    list should be refreshed because multiple rows and missing states may have
    changed atomically.

## Workflows

### 1. Open the management page

1. An authenticated operator navigates to the Plugins child entry under
   Settings.
2. The page loads the plugin list contract.
3. Decision: `pluginsEnabled` is false.
   - Show the intentional disabled state.
   - Explain `PLUGINS_ENABLED` and that stored plugin state was not read or
     changed.
   - Do not show enable/disable controls as available.
4. Decision: `pluginsEnabled` is true and `items` is empty.
   - Show an enabled-but-empty state, distinct from disabled.
   - Allow reload so a newly added manifest can be discovered.
5. Decision: items exist.
   - Show each identity, discovery/lifecycle state, durable intent,
     declared-versus-wired points, grants, timestamps, and safe lifecycle error.
   - Visually separate current plugins from retained missing records.

### 2. Inspect a plugin

1. The operator selects or expands one plugin from the list; a route or in-page
   detail is preferable to a modal unless the design establishes that the list
   already contains the complete detail.
2. Identity is shown as name plus exact id/API version, with version and
   optional author/description.
3. Extension points are grouped or badged as “wired observe” versus “declared,
   not wired.”
4. Capabilities are translated into catalog labels/descriptions and accompanied
   by the global deny-by-construction statement.
5. The page displays `enabled` as intent, `discovered` as current availability,
   lifecycle state, `registeredAt`, `updatedAt`, and `lastError` with its
   lifecycle-only meaning.
6. No execution success is claimed unless a future/expanded contract supplies
   execution evidence.

### 3. Enable or disable

1. The operator changes the desired enablement for a specific
   `(apiVersion, id)`.
2. The control enters a pending state to prevent duplicate contradictory
   requests.
3. On success, the row is replaced with the response's authoritative plugin
   record and a success alert confirms that **enablement intent** was saved.
4. On `plugins_disabled`, the page transitions/reloads into the global disabled
   explanation because deployment configuration changed concurrently.
5. On `plugin_not_found`, refresh the list and explain that the durable identity
   no longer exists.
6. On `internal_error` or transport failure, preserve the previous switch value
   and show an actionable failure alert.
7. For an undiscovered row, explicitly state that changing intent only affects a
   future reappearance.

Dirty tracking is only applicable if the design batches unsaved changes. With
immediate API-backed toggles there is no dirty period beyond the in-flight
request, so marking the whole page dirty would misrepresent persistence.

### 4. Reload plugins

1. The operator activates Reload.
2. Disable repeated reload actions while the serialized request is in flight.
3. On success with `reloaded: true`, report the four counts in human language
   and refresh the list.
4. On success with `reloaded: false`, show the global-disabled explanation
   rather than a generic “nothing changed” success.
5. On failure, retain the existing list, show a redacted failure alert, and
   permit retry.
6. If rejected count is non-zero, state that some entries were rejected but do
   not invent identities or reasons unavailable from the response.

### 5. Runtime unavailable / execution evidence absent

1. The operator sees an explicit phase-level notice that management intent and
   discovery are available while plugin execution is not established by this
   screen.
2. An enabled row remains labeled as enabled intent, not activated.
3. `lastError` is shown only as lifecycle error.
4. If the product requires dynamic runtime availability or recent-run status,
   the UI must wait for or consume an expanded authoritative contract; it must
   not infer availability from a registered state, a wired declaration,
   timestamps, or a null error.

## Domain Model

### Entities and relationships

| Entity                      | Meaning                                                                                                    | Key relationships                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Plugin identity             | Exact API version plus case-insensitive manifest id                                                        | Owns one durable registry row; scopes all detail/mutation actions                         |
| Validated manifest metadata | Authored portable identity, runtime, entry, declarations, grants, and optional descriptive metadata        | Embedded in the durable row; declarations reference the closed extension catalog          |
| Durable plugin record       | Latest validated metadata plus enablement intent, discovery/lifecycle evidence, safe error, and timestamps | May outlive filesystem discovery as a bounded tombstone                                   |
| Extension-point descriptor  | Host-owned meaning, kind, wiring status, mutation status, and required capability                          | One plugin declares one or more descriptors; only host metadata determines wiring         |
| Capability descriptor       | Host-owned human label, description, compatible points, and immutable safety flags                         | A plugin requests zero or more; validator grants only a compatible closed-list capability |
| Reload summary              | Aggregate result of one atomic scan/reconciliation                                                         | Changes the complete durable/live view; does not identify rejected entries                |
| Execution/run evidence      | A plugin invocation's outcome, time, point, and error                                                      | **Not represented by the current management contract**                                    |

### State dimensions

The page must not compress independent dimensions into one status badge:

- **Global availability:** feature disabled or enabled.
- **Discovery:** present in latest successful scan or retained/missing.
- **Enablement intent:** enabled or disabled by operator.
- **Lifecycle record:** discovered, validated, registered, rejected, activated,
  failed, or unloaded.
- **Extension readiness:** wired or declared-but-unwired per point.
- **Runtime/execution:** unknown/unavailable without a current management API
  field.

### Current state transitions

```text
feature OFF
  -> list is disabled/empty; reload is no-op; row mutations rejected; durable state unchanged

successful scan: new valid identity
  -> durable row created (enabled intent defaults true, discovered true, state registered)

successful scan: existing valid identity
  -> manifest refreshed, discovered true, state registered, prior enabled intent preserved

successful scan: prior identity absent
  -> discovered false, state unloaded, last lifecycle error cleared; bounded tombstone retained

later successful scan: missing identity reappears
  -> discovered true, state registered, prior enabled intent restored

enable/disable
  -> only enabled intent changes; discovery and activation are not created by the mutation

unexpected reload failure
  -> prior published snapshot remains authoritative; no partial replacement is exposed
```

The validator internally recognizes discovery and validation stages and the
lifecycle enum reserves future activation/failure states. The durable response
does not expose an event history through those transient steps.

## Existing Codebase Integration

### Authoritative business contracts

- `docs/api/v1/schemas/plugins.yaml` defines the portable
  list/detail/mutation/reload records and stable error codes. It currently has
  no recent-run or runtime-availability field.
- `packages/praxrr-app/src/lib/shared/plugins/types.ts` owns the closed
  identities, lifecycle states, and the deny-by-construction capability union.
- `packages/praxrr-app/src/lib/shared/plugins/extensionPoints.ts` is the
  client/server-safe authority for point labels that must distinguish the two
  wired observe points from seven declared-only points.
- `packages/praxrr-app/src/lib/shared/plugins/capabilities.ts` supplies the
  human-readable grant labels, descriptions, compatibility mapping, and
  immutable non-mutating/non-secret flags.
- `packages/praxrr-app/src/lib/server/plugins/responses.ts` is the allow-list
  projection and establishes disabled/list/detail/mutation behavior.
- `packages/praxrr-app/src/lib/server/plugins/host.ts` establishes serialized
  reload and mutation, aggregate reload semantics, atomic snapshot publication,
  and the currently unavailable default executor.
- `packages/praxrr-app/src/lib/server/db/queries/pluginRegistry.ts` establishes
  durable reconciliation, preserved enablement, missing tombstones, and
  case-insensitive id behavior.

### Existing UI conventions to preserve

- The natural route is `/settings/plugins`: Settings already provides an index
  and a child navigation registry, while routes are preferred over modals.
- `packages/praxrr-app/src/lib/server/navigation/registry.ts` is the navigation
  authority. Adding the child also requires updating both hard-coded navigation
  snapshots called out by the issue: `navigationShellLayout.test.ts` and
  `navigationScopeFiltering.test.ts`.
- Settings pages use server loads for initial state, plain Svelte 5 event
  handlers without runes, and `alertStore.add` for action feedback.
- Immediate mutations should use per-action pending state. The dirty store is
  appropriate only if the design introduces unsaved batching; the current API
  naturally supports immediate persistence.
- The management routes are already protected by the global API auth
  classification and return `Cache-Control: no-store`.

### Dependency status as of research

- #263 (the two real observe producers) is closed and shipped.
- #264 (durable registry and `/api/v1/plugins*`) is closed and shipped.
- #262 closed with an Extism/Deno runtime NO-GO; the host execution seam remains
  unavailable by default.
- #265 (SDK/developer documentation) remains open and is out of scope for this
  UI.
- #266 is therefore implementable for discovery and durable management, but
  “recent run status” cannot be truthfully completed from the present contract.

## Success Criteria

The feature is successful only when all of the following are evidenced:

1. An authenticated operator can reach a dedicated Plugins page from both the
   Settings index and the registered Settings navigation child; the two
   hard-coded navigation snapshot tests are updated.
2. With plugins enabled, every returned durable row is visible and unambiguously
   identifies API version, id, name, version, optional author, discovery state,
   lifecycle state, and enablement intent.
3. Missing retained rows are clearly distinguished from currently discovered
   plugins and are never described as installed, loaded, or running.
4. Every declared extension point displays its current host-owned wiring status.
   Exactly the two shipped observe points are labeled wired; every other
   declaration is labeled not wired.
5. Every returned capability uses catalog-backed human wording, and the page
   explicitly explains that credential, secret, network, filesystem,
   environment, database, and write/mutation grants are not representable.
6. Enable and disable call the API-version-qualified endpoints, prevent
   duplicate in-flight actions, replace the row from the response, persist
   across page reload/reconciliation, and report success or failure through
   alerts without claiming activation.
7. Reload calls the management endpoint, reports all aggregate counters
   accurately, refreshes the authoritative list on success, and preserves the
   previous view on failure.
8. With `PLUGINS_ENABLED` off, the page renders an intentional explanatory
   state, performs no implicit mutation, does not crash, and does not confuse
   disabled with enabled-but-empty.
9. Null and non-null `lastError` values are handled safely and labeled as
   lifecycle evidence only.
10. The page never exposes or requests local source paths, raw manifests,
    credentials, or raw internal diagnostics.
11. Server, client, route, interaction, disabled-state, and navigation tests
    prove the above flows; `deno task check` passes.
12. Before the issue is considered fully accepted, one of these is true:
    - the management contract is expanded with authoritative recent-run and
      runtime-availability evidence and the UI renders it; or
    - issue #266's acceptance wording is explicitly narrowed/clarified by the
      product owner to the lifecycle-only evidence the current backend provides.

## Open Questions

1. **Recent run contract:** What authoritative fields define “recent run status”
   (last attempted time, last successful time, extension point, duration,
   outcome, safe error)? No such fields currently exist in `PluginRecord`.
2. **Runtime availability:** Should `/api/v1/plugins` expose a global runtime
   status/reason, or should this phase show a static “execution runtime
   unavailable/not yet promoted” notice? Inferring it from plugin lifecycle is
   not valid.
3. **Lifecycle versus execution error:** Should `lastError` remain
   lifecycle-only with a separate run error field, or is its contract intended
   to broaden? Broadening risks erasing the distinction between
   scan/registration and execution.
4. **Missing-row controls:** Should operators be allowed to change enablement
   intent for an undiscovered tombstone, or should the UI allow only disabling
   (safe future intent) until it reappears? The backend currently permits both.
5. **Default enablement:** New durable rows currently default to enabled intent
   even though execution is unavailable. Is automatic opt-in still the desired
   policy when a runtime eventually ships, or should new discoveries require
   explicit operator enablement before activation becomes possible?
6. **Rejected entries:** Is aggregate rejected count sufficient, or must
   operators see safe per-entry rejection reasons? The current API intentionally
   returns no rejected record identity/details.
7. **Detail presentation:** Does the full contract fit accessibly in expandable
   list rows, or should `/settings/plugins/[apiVersion]/[id]` provide a
   dedicated inspection route? The issue prefers routes over modals but does not
   decide list-versus-detail routing.
8. **Feature-enable guidance:** What deployment-specific wording should explain
   `PLUGINS_ENABLED` and restart requirements across binary, Docker, and other
   installations? The UI cannot set this flag.
9. **Engine advisory:** Should advisory `engines.praxrr` constraints be shown
   now with an explicit “not enforced” label, or omitted until compatibility
   enforcement exists?
10. **Dirty tracking:** Is immediate persistence the intended toggle
    interaction? If yes, dirty tracking is unnecessary; if changes are staged
    for batch save, dirty/navigation protection becomes required and changes the
    error-recovery workflow.

# Spec: Durable Plugin Registry and Management API

## Problem Statement

Praxrr discovers plugin manifests into a process-local registry on each boot, so an administrator
cannot preserve enablement decisions, inspect prior discovery state, or rescan plugins without a
restart. Issue #264 needs a durable, feature-flagged management backend that a later UI can query and
mutate without expanding the plugin runtime or capability surface.

## Requirements

### Functional

| #   | Requirement                                                                                      | Priority | Notes                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Persist validated manifest metadata and enablement by `(apiVersion, id)` across restarts.        | Must     | IDs remain case-insensitively unique inside an API-version namespace; persisted manifest identifiers and names are not trimmed.               |
| F2  | Reconcile a fresh `PLUGINS_DIR` scan with persisted rows without losing enablement state.        | Must     | Newly found plugins default enabled; missing plugins remain queryable as undiscovered; reappearing plugins recover the prior decision.        |
| F3  | Provide list, get, enable, disable, and reload operations under `/api/v1/plugins*`.              | Must     | Entity paths include `apiVersion` so management cannot cross namespaces implicitly.                                                           |
| F4  | Keep the API contract, generated app types, and bundled `praxrr-api` artifacts in lockstep.      | Must     | Edit `docs/api/v1/openapi.yaml`, generate `v1.d.ts`, then bundle the package artifacts.                                                       |
| F5  | Degrade safely while `PLUGINS_ENABLED` is off.                                                   | Must     | List reports `pluginsEnabled: false` with no active entries; reload is a no-op summary; enable/disable reject without mutating durable state. |
| F6  | Make reload reset and rescan atomically from the caller's perspective without restarting Praxrr. | Must     | Concurrent reloads are serialized; an unexpected scan/reconcile failure leaves the previous in-memory registry usable.                        |
| F7  | Dispatch only enabled, currently discovered plugins.                                             | Must     | Persisted enablement expresses administrator intent but does not imply the unavailable runtime executed successfully.                         |
| F8  | Expose a redacted, read-only MCP `list_plugins` tool using the same response mapper as HTTP.     | Should   | No source directory, filesystem path, credentials, or mutation handler crosses the MCP boundary.                                              |
| F9  | Preserve existing authentication behavior.                                                       | Must     | The existing API hook gates the routes; no new auth scheme or bypass is introduced.                                                           |

### Non-Functional

| #   | Requirement              | Target                                                                                        | Rationale                                                                            |
| --- | ------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| NF1 | Startup resilience       | Plugin persistence or discovery failures never abort application boot.                        | Plugins remain optional and default off.                                             |
| NF2 | Reconciliation integrity | Database reconciliation is transactional and reload is single-flight.                         | Avoid partial missing/discovered state and races between admin requests.             |
| NF3 | Contract fidelity        | OpenAPI, runtime validation, response mappers, and generated types describe identical fields. | Required by the portable contract policy.                                            |
| NF4 | Data minimization        | Public responses omit `sourceDir` and any unvalidated raw manifest content.                   | Prevent local-path disclosure and keep the API safe for MCP parity.                  |
| NF5 | Compatibility            | No implicit Radarr/Sonarr/Lidarr fallback or inferred mapping.                                | This registry has no Arr-specific field today; future Arr metadata must be explicit. |

## Technical Approach

**Strategy**: Add an app-database repository beneath the plugin registry, then make `PluginHost`
reconcile validated scans into durable rows before publishing a replacement in-memory snapshot.
Expose that host/repository service through contract-first HTTP routes and one read-only MCP adapter.

**Architecture Decisions**:

- Use one `plugin_registry` table keyed by `(api_version, plugin_id COLLATE NOCASE)` because the
  existing registry namespace is the durable identity and must survive toggles or rollbacks.
- Store the validated manifest as JSON plus indexed lifecycle columns because validation remains the
  single manifest contract boundary while list/get queries need cheap state fields.
- Preserve an `enabled` decision when a plugin disappears and mark it `discovered = 0` because deleting
  the row would silently resurrect the default on reappearance.
- Build a complete candidate snapshot, commit reconciliation, then replace the in-memory registry
  because clearing first would create an observable empty/partial registry if scanning fails.
- Treat the app-DB migration as outside PCD base ops, so `seedBuiltInBaseOps.ts` registration does not
  apply.
- Keep runtime execution out of scope. The closed #262 spike is a runtime no-go; #264 records durable
  management intent and does not represent activation or execution success.

**Key Components**:

- `plugin_registry` migration and query repository: durable rows, transaction-safe reconciliation,
  enable/disable, list, and lookup.
- `PluginRegistry`: immutable snapshot replacement and enabled-only dispatch selection while retaining
  API-version isolation.
- `PluginHost`: serialized initialize/reload orchestration, graceful feature-off behavior, and summary
  results.
- Plugin response mapper/service: one redacted public shape shared by HTTP and MCP.
- `/api/v1/plugins*`: list/get/mutation/reload routes defined first in OpenAPI.

## Integration Points

| System/Service       | Direction | Protocol                     | Notes                                                                               |
| -------------------- | --------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| App database         | Both      | SQLite                       | New app migration and synchronous query repository; no PCD/base-op change.          |
| Plugin directory     | Inbound   | Local filesystem             | Existing bounded scanner and manifest validator remain the only discovery boundary. |
| Plugin host/registry | Both      | In-process TypeScript        | Startup and admin reload publish reconciled enabled/discovered entries.             |
| Public API           | Both      | REST/JSON                    | Existing auth hook; API-version-qualified entity paths.                             |
| MCP                  | Outbound  | JSON-RPC tool result         | Optional read-only `list_plugins`, redacted and feature-aware.                      |
| API package          | Outbound  | OpenAPI/generated TypeScript | `docs/api/v1/openapi.yaml`, app declarations, and package bundle stay synchronized. |

## Risks & Unknowns

| Risk                                                  | Likelihood | Impact | Mitigation                                                                                                          |
| ----------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| A reload overlaps dispatch and exposes partial state. | M          | H      | Serialize reload and atomically replace the completed registry snapshot.                                            |
| A scan failure marks every durable plugin missing.    | M          | H      | Reconcile in one DB transaction only after a successful bounded scan.                                               |
| A future runtime interprets enabled as activated.     | M          | M      | Keep persisted/public fields limited to `enabled`, `discovered`, and lifecycle/error facts; do not claim execution. |
| Manifest schema evolves under the same API version.   | L          | H      | Revalidate persisted JSON on load and key every row by `apiVersion`; invalid rows never enter dispatch.             |
| Local paths leak through management surfaces.         | M          | H      | Central response mapper omits `sourceDir`; pin with HTTP and MCP tests.                                             |
| Main gains another migration version before merge.    | M          | M      | Re-fetch/rebase and recheck migration ordering immediately before PR validation.                                    |

## Open Questions

- [x] Should management wait for a successful WASM runtime? No. It persists discovery and enablement
      intent only and remains honest about feature/runtime state.
- [x] Should missing plugins be deleted? No. Retain them as undiscovered so enablement survives a
      temporary removal.
- [x] Should entity routes infer the current plugin API version? No. Include `apiVersion` in the path.
- [x] Does the migration require `seedBuiltInBaseOps.ts`? No. This is an app-database table, not PCD
      base ops.
- [x] Is Arr-specific filtering required now? No current manifest field has Arr semantics; do not invent
      a cross-Arr mapping.

---

_Source: GitHub issue #264 and parent roadmap issue #267_
_Generated: 2026-07-11T00:00:00Z_
_Status: DRAFT — ready for prp-plan_

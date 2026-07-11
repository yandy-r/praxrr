# Issue #262 Business Analysis: Extism Runtime Foundation

## Executive Summary

Issue #262 is Phase 2 of the WASM Plugin System: prove that Extism is viable
under Deno and, only on a positive result, replace the inert execution path with
a real sandboxed executor behind the already-shipped `PluginExecutor` seam. The
business outcome is deliberately narrow: Praxrr can execute a trivial local WASM
plugin under finite timeout, memory, and fuel limits without giving the plugin
ambient network, filesystem, credential, database, or environment access, and
without reducing application availability.

This phase is infrastructure, not an operator-facing plugin feature. There is
still no production sync or profile call-site, durable plugin state, management
API, authoring SDK, or UI. Those are separate sibling issues and must remain
separate so the runtime decision is reversible and its risk can be assessed in
isolation.

## Issue Hierarchy and Scope Boundary

GitHub's current issue hierarchy is authoritative:

- #262 has formal parent #267 and **zero formal subissues**.
- #267 has five formal child issues: #262, #263, #264, #265, and #266.
- #263, #264, #265, and #266 each have formal parent #267 and zero subissues.
  They are follow-up siblings of #262, not child work to be absorbed into #262.
- #267 is itself parented by #6.

The dependency order in #267 is:

```text
#35 foundation (done)
-> #262 runtime
-> #263 production observe wiring -> #265 SDK/docs
-> #264 persistence/API -> #266 UI
-> #263 also feeds useful activity into #266
```

Therefore, completing “issue #262 and child issues” means completing #262 as the
scoped Phase-2 runtime slice; GitHub reports no child issues beneath it.
Implementing #263-#266 here would violate their formal sibling status,
dependency ordering, and explicit issue non-goals.

## User Stories

### Application operator

- As an operator who has not opted into plugins, I need Praxrr to behave exactly
  as it does today so that a new runtime dependency cannot affect my deployment
  merely by being present.
- As an operator who opts into plugins, I need an invalid, hung,
  resource-hungry, or crashing plugin to be contained so that Praxrr boot and
  core work remain available.
- As an operator, I need plugins to have no ambient network or filesystem access
  so that local installation does not become an unreviewed path to Arr
  credentials or host data.
- As an operator whose platform cannot load Extism, I need the plugin subsystem
  to degrade to unavailable while the rest of Praxrr continues normally.

### Praxrr maintainer

- As a maintainer, I need an evidence-based Deno/Extism go/no-go decision before
  coupling the application to the runtime.
- As a maintainer, I need the real executor to implement the frozen
  `PluginExecutor` interface so that the Phase-1 host, registry, manifest
  validator, shared contract, and security boundary do not change.
- As a maintainer, I need finite limits to be enforced by both the host and
  runtime so a non-cooperative plugin cannot stall the caller or monopolize
  resources.
- As a maintainer, I need failures to be typed, logged, and isolated per plugin
  so diagnosing runtime trouble does not require weakening fail-open behavior.
- As a maintainer, I need the runtime choice to remain replaceable so a negative
  Extism spike costs only the executor implementation.

### Future plugin author

- As a future plugin author, I need the runtime to accept the already-published
  manifest and invocation contract and return `PluginJsonValue` without exposing
  Extism-specific types.
- As a future plugin author, I need deterministic failure for timeout, memory,
  fuel, and forbidden I/O rather than a host crash or indefinite hang.

An authoring guide and distributable example are not user stories delivered by issue #262;
they belong to issue #265. The `.wasm` module in this issue is a test fixture proving runtime
execution, not an SDK promise.

## Business Rules and Invariants

### Opt-in and availability

1. `PLUGINS_ENABLED` remains default OFF. When OFF, plugin startup remains a
   hard no-op and no WASM module is executed.
2. `UnavailablePluginExecutor` remains the safe default. A real executor is
   selected only after its runtime can be constructed or initialized
   successfully.
3. Failure to import, initialize, or health-check the runtime must not abort
   application startup. The host retains or restores the unavailable executor
   and reports the optional subsystem as unavailable.
4. Runtime availability does not imply any production trigger. Execution in this
   phase occurs only through tests or an explicitly injected host seam.

### Frozen public boundary

5. `PluginExecutionRequest`,
   `PluginExecutor.execute(req): Promise<PluginJsonValue>`, `PluginJsonValue`,
   the manifest contract, capability ids, extension-point ids, registry
   namespace rules, and validator behavior are frozen for this phase.
6. No Extism `Manifest`, plugin instance, host-function, memory, or error type
   may cross into the host, registry, validator, or `$shared/plugins` contract.
7. The executor resolves only a valid `PluginJsonValue`. Non-JSON output,
   malformed JSON, unsupported numeric values, or runtime decoding failures
   reject as execution failures rather than leaking an untyped value.

### Sandboxing and least privilege

8. Every execution has finite, non-zero ceilings for wall-clock duration, linear
   memory, and fuel/instruction consumption. “Unlimited,” omitted, `Infinity`,
   and zero-as-unlimited configurations are invalid.
9. The runtime manifest has an empty allowed-host set and no allowed paths.
   Network and filesystem access are deny-by-default and are not derived from
   the process-wide Deno permissions used by the application.
10. Plugins receive only the already projected and secret-scrubbed `req.input`.
    Host functions, if any are needed for the spike, are the sole mediated data
    surface and must not expose configuration, environment, database handles,
    credentials, unrestricted fetch, or filesystem operations.
11. The executor must honor an already-aborted `req.signal` and a signal that
    aborts during execution. Runtime cancellation complements, but does not
    replace, the host's existing finite timeout race.
12. The plugin entry path is resolved from the validated plugin `sourceDir` and
    manifest `entry`; it must not create a second path-validation policy or
    permit escape from that directory.

### Failure isolation and observability

13. One plugin failure never propagates out of `notifyObservers`, never prevents
    the next registered plugin from running, and never changes the caller's
    output.
14. Timeout, cancellation, memory exhaustion, fuel exhaustion, forbidden I/O,
    invalid output, guest trap, and runtime-unavailable conditions must be
    distinguishable in internal diagnostics, even if the host exposes the same
    fail-open behavior to its caller.
15. Cancellation is terminal for that invocation. Any worker, timer, plugin
    instance, or native resource associated with it must be released; a late
    settlement must not become an unhandled rejection.
16. A failed invocation does not remove, disable, or persistently mutate a
    plugin. Durable lifecycle and enable/disable policy belong to #264. A
    subsequent dispatch may attempt the plugin again.
17. An unhealthy runtime may cause later invocations to use the unavailable
    path, but it may not cause the core application to retry indefinitely, block
    startup, or crash.

### Version and cache safety

18. Runtime behavior that can alter results or limit semantics has an explicit
    behavior-version component, following the `/health` engine-version
    precedent.
19. No runtime result cache is required for #262. If one is introduced, it must
    be bounded and its identity must include at minimum the runtime behavior
    version, `apiVersion`, plugin id, `plugin.version`, extension point, and an
    input digest. A feature toggle, rollback, plugin upgrade, limit-policy
    change, or input change must not reuse an incompatible result.
20. A cache must never cache runtime failures, permission denials,
    cancellations, or partial output as a successful result.

## Domain Concepts

| Concept                  | Meaning in #262                                                                                      | Ownership                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Plugin contract version  | Compatibility namespace for manifests and registry lookup (`apiVersion`)                             | Existing `$shared/plugins` contract; unchanged |
| Plugin behavior version  | Author-provided `manifest.version`; distinguishes plugin builds                                      | Existing manifest; unchanged                   |
| Runtime behavior version | Host-owned version for executor semantics, limits, encoding, and cache compatibility                 | Runtime implementation                         |
| Registered plugin        | Validated manifest plus source directory, held in the in-memory registry                             | Existing registry; persistence deferred        |
| Execution request        | Registered plugin, extension point, projected JSON input, and abort signal                           | Existing frozen executor seam                  |
| Invocation               | One attempt to execute one plugin for one point under one finite budget                              | New runtime responsibility                     |
| Runtime availability     | Whether a real executor can safely accept invocations                                                | Executor-selection boundary in `PluginHost`    |
| Sandbox policy           | Finite timeout/memory/fuel plus no network/fs and mediated host functions                            | Extism manifest/executor internals             |
| Execution result         | Valid `PluginJsonValue` returned by the guest                                                        | Executor boundary                              |
| Execution failure        | Typed/normalized rejection caused by runtime, guest, resource, permission, cancellation, or decoding | Executor internals, isolated by host           |

## Workflows

### Go/no-go spike

1. Pin and load `@extism/extism` using the repository's Deno dependency/lockfile
   workflow.
2. Record the exact Deno permissions and flags required for development, tests,
   compiled Linux, and compiled Windows paths where support is claimed.
3. Execute a trivial guest through the frozen `PluginExecutor` input/output
   shape.
4. Prove Web-Worker-backed timeout and cancellation actually stop work under
   Deno, including cleanup.
5. Prove finite memory and fuel limits fail deterministically.
6. Prove an empty host allow-list and absent path mappings deny guest network
   and filesystem access.
7. Prove any required host function receives only explicit values and cannot
   gain ambient authority.
8. Document a GO or NO-GO result with evidence, limitations, and platform
   constraints.

A GO permits implementation of `ExtismPluginExecutor`. A NO-GO stops
Extism-specific production work and records the fallback evaluation target
(native Deno Worker + QuickJS) behind the same seam; it does not change the
shared contract or silently relax sandbox requirements.

### Startup and executor selection

```text
PLUGINS_ENABLED off
  -> existing hard no-op; unavailable executor remains selected

PLUGINS_ENABLED on
  -> existing scan/validate/register flow
  -> attempt runtime construction/health check
       -> success: inject ExtismPluginExecutor
       -> absent/unhealthy: retain UnavailablePluginExecutor, warn, continue boot
```

Selection must be explicit and testable through the existing
constructor/`setExecutor` seam. It must not require Extism types in `PluginHost`
and must not change manifest acceptance.

### Invocation

```text
host selects registered plugins for a wired observe point
  -> host builds projected + scrubbed PluginJsonValue once
  -> host creates finite AbortSignal budget per plugin
  -> executor resolves and validates entry path
  -> executor constructs default-deny Extism manifest with finite limits
  -> executor runs the point/export with serialized JSON input
       -> valid JSON result: return PluginJsonValue (observe host discards it)
       -> any failure: normalize/reject
  -> host catches/logs the failure and continues to the next plugin
  -> executor frees all per-invocation resources
```

### Runtime failure recovery

| Failure                                                   | Invocation outcome                                                  | Host/application outcome                                                           | Next attempt                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Runtime dependency absent or initialization fails         | `PluginRuntimeUnavailableError` / unavailable selection             | Boot continues; plugins do not run                                                 | Retry only on a later explicit initialization/restart, not a hot loop              |
| Request signal already aborted                            | Immediate cancellation failure; guest is not started                | Host swallows/logs                                                                 | Next independent invocation may run                                                |
| Request signal aborts or timeout expires                  | Worker/runtime execution is cancelled and resources freed           | Host timeout remains the outer safety net; caller continues                        | Next independent invocation may run                                                |
| Fuel or memory limit exceeded                             | Normalized resource-limit execution failure                         | Isolated to plugin                                                                 | Next independent invocation may run                                                |
| Guest trap, invalid export, invalid JSON, or decode error | Normalized execution failure                                        | Isolated to plugin                                                                 | Next independent invocation may run                                                |
| Guest attempts network or filesystem access               | Permission-denied execution failure                                 | No capability escalation; caller continues                                         | Still denied on every later invocation                                             |
| Runtime becomes globally unhealthy                        | Current call fails; executor may mark itself unavailable internally | App remains available; unavailable path used rather than repeated unsafe execution | Recovery requires a bounded explicit reinitialization policy, not infinite retries |

## State Transitions

The shared `PluginLifecycleState` union is unchanged. #262 makes execution
possible but does not add durable state management.

```text
discovered -> validated -> registered        existing scan/validation path
discovered -----------------> rejected       existing invalid-manifest path

registered -- runtime available -----------> activated (conceptual runtime readiness)
activated  -- invocation succeeds ---------> activated
activated  -- invocation fails ------------> failed (diagnostic invocation state)
failed     -- later invocation succeeds ----> activated
registered/activated/failed -- reset -------> unloaded (conceptual teardown)
```

Because `RegisteredPlugin` entries are currently immutable and the registry has
no persistence/update API, the `activated`, `failed`, and `unloaded` labels
should not be forced into durable registry behavior in #262. They describe
runtime/diagnostic transitions. Persisting last state, last error,
enabling/disabling, reload, or reconciliation is #264. The business invariant is
observable behavior: real execution when available, per-invocation failure
isolation, and safe recovery on a later invocation.

## Existing-Code Integration

### Must be reused unchanged

- `packages/praxrr-app/src/lib/server/plugins/executor.ts`: the exact
  `PluginExecutor` and `PluginExecutionRequest` seam;
  `UnavailablePluginExecutor` remains the default/fallback.
- `packages/praxrr-app/src/lib/server/plugins/host.ts`: constructor injection
  and `setExecutor`, per-plugin dispatch loop, `AbortSignal` timeout race, and
  fail-open catch behavior.
- `packages/praxrr-app/src/lib/server/plugins/registry.ts`: in-memory
  `(apiVersion, lowercased id)` namespace and lookup by extension point.
- `packages/praxrr-app/src/lib/server/plugins/hostContext.ts`: the projection
  and secret-scrubbing boundary.
- `packages/praxrr-app/src/lib/shared/plugins/**`: manifest, capability,
  extension-point, JSON, and validation contracts.
- Existing startup feature-flag behavior: default OFF and warn-and-continue
  optional-subsystem degradation.

### Runtime-owned additions

- A sibling runtime module such as `extismExecutor.ts`, or an executor-local
  implementation, containing all Extism imports, manifest construction,
  serialization, output validation, cancellation, and resource cleanup.
- Runtime-specific error normalization that maps guest/runtime failures to the
  existing plugin error taxonomy without leaking vendor types.
- Dependency and full `deno.lock` changes required by the selected Extism
  version.
- Focused test fixtures, including a trivial `.wasm` module and purpose-built
  timeout/resource/I/O denial guests. These are internal tests, not the #265
  public example.
- Design documentation recording the spike result, exact permissions, platform
  matrix, enforced limits, and go/no-go rationale.

### Integration cautions

- The host currently enforces a 5,000 ms outer timeout. Runtime timeout
  configuration must fit within that budget and leave cleanup margin; it must
  not race with a longer guest timeout as the normal path.
- The host serially awaits plugins. Isolation prevents one failure from blocking
  later plugins after its finite deadline, but runtime cleanup must finish
  promptly so sequential dispatch remains bounded.
- The process itself has broad Deno permissions in normal builds. Sandbox
  guarantees must come from the guest runtime manifest and the absence of
  authority-bearing host functions, not from assuming the process lacks
  `--allow-net` or `--allow-read`.
- The manifest `entry` is a path, while Extism may accept bytes, URLs, or path
  descriptors. Only the local, validated plugin entry form is permitted in this
  phase; URL-based guest loading would reintroduce network authority and is out
  of scope.

## Precise Success Criteria

Issue #262 is complete only when all of the following are evidenced:

1. A checked-in design record states GO or NO-GO for Extism on Deno and includes
   exact dependency version, permissions/flags, supported platform/runtime path,
   timeout/cancellation evidence, memory/fuel evidence, host-function behavior,
   no-network/no-filesystem evidence, and known limitations.
2. On GO, `ExtismPluginExecutor` structurally implements the existing
   `PluginExecutor`; no shared or host request/response type changes are needed
   and `rg` finds no Extism type/import outside the runtime-owned module(s),
   tests, dependency metadata, or design documentation.
3. With `PLUGINS_ENABLED=false`, startup remains a hard no-op and existing
   plugin-disabled tests continue to pass.
4. With the flag enabled, a valid registered test plugin and explicitly injected
   real executor execute a trivial WASM export end-to-end and produce the
   expected `PluginJsonValue`.
5. An already-aborted signal prevents guest execution; an in-flight abort or
   hung guest settles within the finite host budget and demonstrably releases
   its worker/runtime resource.
6. Purpose-built guests prove the configured finite memory and fuel ceilings are
   enforced. Tests assert the failure category and that a later
   plugin/invocation still runs.
7. Purpose-built guest attempts to access network and filesystem are denied with
   no host data disclosure. The runtime manifest is also inspected/asserted to
   contain an empty allowed-host list and no path mapping.
8. A guest trap, invalid result, timeout, memory failure, fuel failure, and
   permission denial never escape `PluginHost.notifyObservers`, never affect its
   caller's output, and never prevent dispatch to the next plugin.
9. Runtime initialization failure leaves the unavailable executor active and
   application startup completes.
10. All runtime limits are finite constants or validated finite configuration,
    and tests pin their values or ordering relative to the host's 5-second outer
    timeout.
11. No runtime result cache exists, or any introduced cache demonstrates
    complete behavior/API/plugin/point/ input namespacing and excludes
    failed/partial executions.
12. `deno task test plugins` and `deno task check` pass, with any
    platform-specific limitation explicitly documented rather than silently
    skipped.
13. The change contains no production plugin call-site, database migration, API
    route/schema, management UI, public SDK/example, new capability id, or
    mutating/provider point wiring.

## Explicit Non-Goals

The following must not be implemented in #262:

- #263: firing `config.profileCompiled.observe` or
  `sync.previewComputed.observe` from real producers, or finalizing their
  production projection allow-lists.
- #264: durable registry state, enable/disable persistence, discovered metadata
  persistence, reload/rescan API, `/api/v1/plugins*`, database migrations, or
  MCP plugin tools.
- #265: public SDK/authoring guide, docs-site pages, a distributable example
  plugin, or install tutorial.
- #266: plugin management UI, navigation, toggles, capability display, or
  run-status page.
- Any production sync, compile, parser, notification, import/export, or provider
  call-site.
- Any new capability id, especially network, filesystem, environment, database,
  credential, auth, secret, or write capability.
- Mutating/transform/provider points, including `parser.releaseTitle.transform`,
  `customFormat.condition.evaluate`, `notification.dispatch.observe`, and
  `importExport.adapter`.
- Marketplace, remote plugin fetch, auto-update, signing, trust, provenance, or
  community registry.
- A new plugin contract version or changes to manifest validation merely to
  accommodate Extism.
- Persistent run history, retry scheduler, circuit-breaker management API, or
  operator-configurable runtime policy. Internal bounded degradation is allowed;
  productized lifecycle management belongs to later phases.

## Decision Guidance

The recommended business decision is **GO only if every sandbox property is
demonstrated under the actual Deno execution and compilation paths Praxrr
supports**. Successful trivial execution alone is insufficient.
Timeout/cancellation, finite memory, finite fuel, absence of ambient
network/filesystem authority, cleanup, and optional-subsystem degradation are
co-equal gates.

If Extism cannot meet any gate without widening the frozen contract or granting
unsafe ambient authority, record **NO-GO** and preserve the foundation. The
correct fallback is to evaluate native Deno Worker + QuickJS behind the same
seam in a newly scoped implementation decision, not to dilute #262's sandbox or
pull later sibling features forward.

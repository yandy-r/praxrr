# Practices Research: Safe Runtime Boundary for Issue #262

## Executive Summary

Issue #262 should be treated as a security gate, not as a mandate to land an
executor regardless of the spike result. The current foundation is intentionally
well-factored: `PluginExecutor` is a small JSON-only port, `PluginHost` owns
orchestration and failure isolation, the registry owns only validated manifest
state, and `UnavailablePluginExecutor` keeps the optional subsystem inert. Those
boundaries should not be expanded merely to make the Extism JavaScript SDK look
compliant.

The Deno spike documented in `research-technical.md` is a **no-go for
`@extism/extism` under the issue's unchanged acceptance criteria**. The SDK can
import and execute under Deno and can terminate a worker on timeout, but it has
no enforced fuel/instruction API, and its `memory.maxPages` setting is not a
complete limit on guest-defined WebAssembly linear memory. A production
`ExtismPluginExecutor` built on that SDK would therefore be a partial, unsafe
implementation even if its class and tests appeared complete.

The minimal safe landing for the current decision is consequently:

1. record the no-go evidence and rationale in the design/architecture artifacts
   and roadmap;
2. leave `PluginExecutor`, `PluginHost`, the registry, validator, shared
   contract, startup behavior, and default unavailable executor unchanged;
3. do not add `@extism/extism`, regenerate `deno.lock`, add runtime selection,
   or check in an executable adapter that cannot enforce all mandatory limits;
   and
4. split or approve a materially larger native Extism/Wasmtime FFI design before
   implementation resumes.

This is a complete and useful result for a go/no-go issue. It preserves the
hedge that Phase 1 deliberately built and avoids normalizing security claims
that the selected dependency cannot substantiate.

## Existing Reusable Code

### Keep the execution port exactly as shipped

`packages/praxrr-app/src/lib/server/plugins/executor.ts` is the correct
abstraction:

```ts
export interface PluginExecutor {
  execute(req: PluginExecutionRequest): Promise<PluginJsonValue>;
}
```

Its strengths are worth preserving:

- runtime-neutral request and result types;
- an `AbortSignal` supplied by the host rather than a runtime-specific
  cancellation object;
- a type-only dependency on `RegisteredPlugin`, avoiding a runtime import cycle;
- no SDK object, compiled module, worker, WASI handle, FFI pointer, or runtime
  error type crossing the seam;
- an inert default whose behavior is explicit and tested.

Do not add limit fields, cache handles, Extism manifest options, a `dispose()`
method, or backend health state to this interface during #262. Limits belong to
the adapter's immutable policy, cache lifecycle belongs to the adapter instance,
and startup selection belongs to a runtime factory. Changing the port to
accommodate a particular backend defeats the seam's purpose and would require
coordinated changes to the host and its tests despite the issue's explicit
zero-change constraint.

### Preserve host ownership of orchestration

`packages/praxrr-app/src/lib/server/plugins/host.ts` already owns the concerns
that are truly common to any executor:

- feature-flagged discovery and registration;
- projection and secret scrubbing before execution;
- one finite outer timeout per plugin;
- sequential per-plugin dispatch;
- a per-plugin `try/catch` so one failure cannot stop later plugins;
- constructor injection and `setExecutor` for tests and startup selection;
- the process-wide registry reset.

The runtime adapter should never duplicate scanning, validation, registry
lookup, capability resolution, input projection, or dispatch iteration.
Conversely, `PluginHost` should not construct an Extism manifest, read Wasm
bytes, classify SDK errors, manage workers, or know whether the backend is
JavaScript, FFI, or another runtime.

The current outer `Promise.race` is containment for an executor that ignores its
signal; it is not proof that the underlying guest stopped. A compliant adapter
must still honor `req.signal` and synchronously initiate backend
cancellation/worker termination. Tests should distinguish “the caller returned”
from “the guest was actually stopped and resources were reclaimed.”

### Preserve registry and contract responsibilities

`packages/praxrr-app/src/lib/server/plugins/registry.ts` correctly owns only
in-memory registered manifests, namespaced by
`(apiVersion, lowercased plugin id)`. It should not become a store for compiled
modules, runtime instances, results, health, or last-execution state. Those
objects have different lifetimes and security implications from validated
metadata.

The following files are frozen inputs to this phase and should receive no
runtime-driven changes:

- `packages/praxrr-app/src/lib/shared/plugins/types.ts`
- `packages/praxrr-app/src/lib/shared/plugins/capabilities.ts`
- `packages/praxrr-app/src/lib/shared/plugins/extensionPoints.ts`
- `packages/praxrr-app/src/lib/shared/plugins/validator.ts`
- `packages/praxrr-app/src/lib/server/plugins/registry.ts`
- `packages/praxrr-app/src/lib/server/plugins/hostContext.ts`

In particular, do not add a capability just because an SDK host function needs
one, do not add an export mapping to the manifest to suit a fixture, and do not
weaken validation to accept a runtime-specific shape. The backend must adapt to
the published contract, not the reverse.

## Modularity Design

### No-go path: land no executable runtime code

For the proven no-go, the simplest safe implementation is no implementation.
Avoid all of the following:

- an `ExtismPluginExecutor` class that enforces only timeout;
- constants named `FUEL_LIMIT` or `MEMORY_LIMIT` that are never passed to an
  enforcing backend;
- cooperative fuel host functions that a guest can omit;
- Wasm byte rewriting or instrumentation introduced solely to simulate fuel
  metering;
- post-call memory inspection presented as a preventative bound;
- a native Worker wrapper around the same JS SDK presented as a new sandbox;
- a fallback that silently selects a weaker executor when the preferred runtime
  is absent;
- committed spike fixtures wired into application startup;
- dependency and lockfile churn for a backend explicitly rejected by the spike.

These approaches add code and maintenance surface while preserving the exact
risk the gate was intended to reject. A no-go design artifact plus unchanged
inert runtime is more complete than a partially functional executor with
misleading limit names.

### Future compliant path: one adapter and one small selector

If a native Extism/Wasmtime backend is separately approved, keep the module
graph narrow:

```text
hooks.server.ts
-> selectPluginExecutor()              runtime-neutral return type
-> ExtismPluginExecutor                only runtime-specific adapter
-> backend binding                     JS SDK or native FFI, private
-> pluginHost.setExecutor(executor)
-> pluginHost.initialize()
```

Recommended responsibilities:

| Module              | Single responsibility                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `executor.ts`       | Frozen runtime-neutral port and unavailable default                                            |
| `extismExecutor.ts` | Artifact confinement, policy application, invocation, cancellation, output validation, cleanup |
| `runtime.ts`        | Optional startup probe/selection returning only `PluginExecutor`                               |
| `host.ts`           | Existing discovery, dispatch, outer timeout, and failure isolation                             |

Do not introduce a generic plugin-runtime framework, factory hierarchy,
dependency-injection container, or abstract cache before a second runtime
demonstrates the need. One interface, one adapter, and one selection function
are enough.

The adapter should receive narrow dependencies for deterministic tests rather
than monkey-patching a whole SDK namespace. A private constructor dependency can
contain only the operations the adapter uses, such as compile/create, call,
cancel, and close. Production supplies the real binding; tests supply a small
fake. This mirrors `ScanDeps` in
`packages/praxrr-app/src/lib/server/plugins/scan.ts`, where filesystem
operations are injected without turning the scanner into a framework.

## Dependency Strategy

### Current JS SDK decision

Do not add `@extism/extism` to `deno.json` or `deno.lock` after a no-go. The
dependency is a release candidate, requires a Deno-specific worker-argument
override, and does not expose the required enforcement surface. Carrying it “for
later” would:

- enlarge builds without a usable production path;
- create automated update and vulnerability work for rejected code;
- invite later code to depend on the weaker API;
- make reviewers infer runtime support from the lockfile even though startup
  remains unavailable.

The spike command and resolved version belong in the design evidence, not the
application dependency graph.

### Requirements before approving a native backend

A native Extism/Wasmtime path must be reviewed as a deployment feature, not a
small package swap. Its design must answer, before code lands:

- exact Extism/Wasmtime and ABI versions, with immutable pins;
- supported OS/architecture matrix, including the repository's Linux and Windows
  standalone builds;
- how shared libraries are acquired, verified, licensed, packaged, and updated;
- what `deno compile` embeds versus what must be deployed beside the executable;
- required `--allow-ffi`, read, worker, and system permissions;
- cancellation-handle and native-memory safety across FFI;
- startup behavior for missing, incompatible, or corrupt libraries;
- reproducible build and CI coverage for every claimed target;
- ownership of security advisories and version upgrades.

Prefer an exact dependency version and full lockfile regeneration only after
these questions are resolved. Do not use a caret range for a release candidate
or allow the package manager to choose a different sandbox implementation
between CI and release builds.

## Runtime Policy and Error Boundaries

If implementation later resumes, define one immutable, server-only policy object
next to the adapter. Every value must be finite, positive, and test-asserted.
The adapter applies it directly to the enforcing backend; there must be no value
that exists only in configuration or logs.

The policy must cover at least:

- backend timeout shorter than the host's current 5,000 ms outer timeout;
- complete guest linear-memory/resource limiting, not only Extism host-context
  allocation;
- non-cooperative fuel/instruction metering;
- no WASI;
- explicit empty allowed-host and allowed-path sets;
- finite encoded input and output sizes;
- finite JSON nesting depth;
- finite Extism variable-store/host-context allocations if the backend exposes
  them.

Keep runtime error normalization inside the adapter.
`PluginRuntimeUnavailableError` means the runtime could not be selected or
initialized. A guest trap, invalid output, timeout, caller abort, fuel
exhaustion, memory limit, missing export, or denied capability is an invocation
failure (normally `PluginExecutionError`) and must remain isolated to that
plugin. Do not mark the whole runtime unavailable because one guest failed.

Likewise, never log raw guest input/output, Wasm bytes, paths, URLs, SDK error
objects, or guest-controlled text. The host's current `error: String(error)` is
acceptable for Phase-1 fakes but is too broad for an untrusted runtime unless
the adapter guarantees a host-authored, bounded message. Centralized
classification should return stable safe categories, not SDK prose.

## Cache Ownership and Lifecycle

### No result cache in issue #262

There is no production call-site in this issue, so a runtime **result cache has
no useful consumer**. Do not add one. This is both KISS and safer: observe
outputs are discarded, the behavior has not been benchmarked, and cache
invalidation would create more correctness surface than the spike needs.

If a later extension point needs result caching, mirror the parser cutover
discipline in `packages/praxrr-app/src/tests/server/parserCacheCutover.test.ts`.
The cache namespace must include all behavior-affecting identities, at minimum:

```text
runtimeBehaviorVersion
apiVersion
plugin.version
plugin artifact digest
extension point
canonical input digest
```

The issue text names the behavior version and `(apiVersion, plugin.version)`
tuple as mandatory. The artifact digest is additional defense against a plugin
file changing without its author bumping `version`. The point and input digest
prevent cross-operation reuse. As with the parser, an unavailable or unprobed
runtime must not compute misses under a stale namespace.

### Avoid compilation caching in the first compliant spike

Start with a fresh runtime instance and compilation per `execute`. That is
slower but makes ownership, cancellation, poisoning, state reset, and cleanup
obvious. Issue #262 has no production call-site, so there is no throughput
requirement that justifies a cache before sandbox correctness is proven.

If measurements later justify a compilation cache:

- the `ExtismPluginExecutor` instance owns it, never `pluginRegistry` or a
  module-level global;
- cache immutable compiled artifacts only, not mutable invocation/plugin
  instances;
- key by `(runtimeBehaviorVersion, apiVersion, plugin.version, artifactDigest)`;
- bound entry count and/or byte weight with explicit eviction;
- never reuse an instance after timeout, abort, trap, memory violation, or
  uncertain cleanup;
- deduplicate concurrent compilation without sharing mutable call state;
- make eviction release native resources deterministically;
- ensure a failed compilation is not cached indefinitely;
- clear the cache on executor replacement and process shutdown.

The frozen `PluginExecutor` port has no lifecycle method, so do not add a cache
that requires callers to know runtime-specific cleanup. A future selector may
own a concrete adapter long enough to register a shutdown hook, or the adapter
may use backend objects whose compiled representation is safely
garbage-collected. If neither is true, omit the cache rather than leak resources
or widen the seam.

## Startup Executor Selection

The current startup in `packages/praxrr-app/src/hooks.server.ts` is correctly
feature-gated and warn-and-continue. A future real runtime should be selected
before manifest initialization, but only inside the enabled branch:

```text
PLUGINS_ENABLED=false
  -> do not import/probe/load the runtime
  -> keep UnavailablePluginExecutor
  -> log intentional disabled state

PLUGINS_ENABLED=true
  -> select/probe runtime once
     -> success: pluginHost.setExecutor(realExecutor)
     -> failure: retain/set UnavailablePluginExecutor and warn once
  -> pluginHost.initialize()
  -> any unexpected host failure remains warn-and-continue
```

This ordering avoids loading a heavy or native dependency for operators who did
not opt in and makes the runtime-ready claim precede plugin registration. The
selection function should return `Promise<PluginExecutor>` and catch
loader/probe errors internally; no Extism type should appear in
`hooks.server.ts`.

Selection should occur once at boot. Do not retry on every plugin call,
dynamically import the backend from `execute`, or silently swap runtimes after a
guest failure. Repeated construction amplifies failure and log noise, while hot
fallback can change sandbox semantics mid-process. Recovery from global runtime
unavailability should be an explicit reinitialization/restart policy in a later
management phase.

The selector must not mutate the singleton before the probe has fully succeeded.
Construct and probe a local candidate, then install it atomically. On failure,
clean up the candidate and explicitly retain the unavailable default. This
prevents partially initialized native state from receiving dispatches.

## Testability and Patterns to Mirror

### Existing tests that pin the seam

Continue to use the repository's current plugin tests as contract tests:

- `src/tests/plugins/executor.test.ts`: unavailable default rejects with the
  typed runtime-unavailable error.
- `src/tests/plugins/host.test.ts`: disabled mode performs no filesystem work;
  missing/invalid plugins degrade; injected executors receive scrubbed JSON;
  executor failures are isolated; the next plugin still runs.
- `src/tests/plugins/registry.test.ts`: API-version namespaces and
  case-insensitive identity remain isolated.
- `src/tests/plugins/hostContext.test.ts`: projection and redaction happen
  before execution.
- `src/tests/plugins/scan.test.ts`: narrow `ScanDeps` injection and bounded
  scanning provide the pattern for adapter dependency injection.
- `src/tests/server/parserCacheCutover.test.ts`: behavior-version namespace
  changes, rollback isolation, unavailable-backend behavior, recovery, and log
  redaction provide the cache-safety pattern.

The `withPluginsEnabled` and `withPluginsDir` helpers in `host.test.ts` also
establish the local test style: change global configuration only inside a helper
and restore it in `finally`; clear the singleton registry after every test.
Runtime tests should use the same cleanup discipline for workers, temporary
files, signals, and any backend globals.

### Required tests for a future compliant adapter

Use checked-in, deterministic Wasm fixtures with source/provenance and hashes.
Do not download fixtures during tests. Each negative case must be followed by a
healthy invocation to prove isolation and cleanup:

1. valid fixture returns an exact `PluginJsonValue` through `PluginExecutor`;
2. pre-aborted request starts no guest work;
3. caller abort terminates the actual guest and settles within a bounded
   tolerance;
4. infinite loop hits backend timeout and the next invocation succeeds;
5. fuel burner exhausts enforced fuel and the next invocation succeeds;
6. memory grower hits the complete guest memory limit without killing the
   process;
7. network attempt cannot reach a controlled local listener even though the test
   process has network access;
8. filesystem attempt cannot read or change a sentinel even though the test
   process has filesystem access;
9. absolute path, traversal, directory, and symlink escape are rejected before
   runtime creation;
10. missing export, guest trap, invalid UTF-8, invalid JSON, excessive depth,
    and oversized output are rejected;
11. two plugins prove that one failure still permits the second dispatch;
12. runtime selection failure leaves the unavailable executor installed and
    startup continues;
13. disabled startup never imports, probes, reads, or constructs the runtime;
14. normal logs contain no request data, result data, guest strings, paths, or
    raw backend errors.

Tests for timeout, fuel, and memory must assert backend-observable enforcement,
not merely elapsed host time or an adapter-generated error. A fake is useful for
unit-level branching but cannot satisfy the sandbox acceptance tests; those
require the actual pinned backend.

### Validation commands

For a documentation-only no-go landing:

```bash
deno task format:plans
deno task lint:modified
git diff --check
```

Run the unchanged foundation suite as regression evidence if related code or
architecture docs change:

```bash
deno task test plugins
deno task check
```

For a future native runtime, add target-specific build and execution tests
rather than treating a TypeScript check as runtime proof. At minimum, exercise
every supported standalone build target claimed by the design.

## Minimal Safe Implementation Boundary

### Safe boundary for the current no-go

The mergeable scope should be limited to:

- Phase-1 design/architecture documentation updated with the dated Deno spike
  evidence;
- an explicit no-go decision explaining the absent fuel API and incomplete
  memory bound;
- `ROADMAP.md` updated to show that the runtime phase was evaluated but remains
  blocked on a compliant backend rather than claiming execution shipped;
- no changes to application source, shared contracts, dependencies, lockfile,
  fixtures, startup, or tests;
- a follow-up issue/design decision for native Extism/Wasmtime FFI if the
  maintainers want to pursue it.

This boundary satisfies the “negative result costs only the executor”
architecture. It does not satisfy the execution acceptance criteria, and the
issue/PR must say so plainly rather than checking those criteria or closing the
runtime milestone as shipped.

### Boundary if the issue is changed to approve a compliant backend

Only after the backend demonstrates every mandatory control should
implementation expand to:

- one server-only adapter implementing the unchanged `PluginExecutor`;
- one runtime-neutral startup selector;
- explicit enabled-only installation through `pluginHost.setExecutor`;
- deterministic fixtures and tests for timeout, cancellation, fuel, total
  memory, forbidden network/fs, path confinement, malformed output, cleanup, and
  isolation;
- exact dependency/ABI pins plus full lockfile and platform build validation;
- architecture and roadmap wording that accurately states the supported
  platforms and limitations.

Still exclude production observe call-sites, persistence, API, UI, SDK,
marketplace, retries, quarantine, result caching, new capabilities, new
extension points, and manifest changes. Those are later issues and would make it
harder to determine whether the runtime itself is safe.

## Review Checklist

- [ ] `PluginExecutor` and `PluginExecutionRequest` are unchanged.
- [ ] No Extism/FFI type reaches host, registry, validator, shared contract, or
      startup code.
- [ ] A no-go does not add a runtime dependency, lockfile churn, or dormant
      adapter.
- [ ] Every claimed limit maps to a real backend enforcement API and has an
      actual-backend negative test.
- [ ] Timeout tests prove guest termination, not only host `Promise.race`
      settlement.
- [ ] Memory tests cover guest-defined linear memory, not only Extism
      host-context storage.
- [ ] Fuel is non-cooperative and cannot be bypassed by guest code.
- [ ] Network and filesystem denial are proven while the outer Deno process has
      those permissions.
- [ ] Startup never imports/probes the runtime when plugins are disabled.
- [ ] Runtime selection is one-shot, atomic, fail-safe, and retains the
      unavailable default on failure.
- [ ] Registry stores only validated metadata; any compiled cache is private,
      bounded, and versioned.
- [ ] No result cache is added without a real consumer and a complete behavior
      namespace.
- [ ] Per-invocation resources are always cleaned up, including abort, timeout,
      trap, and decode failures.
- [ ] One failed plugin cannot poison the executor or block the next plugin.
- [ ] Logs contain only host-owned bounded classifications and safe correlation
      metadata.
- [ ] Linux/Windows release claims are backed by target-specific build and
      runtime tests.

## Recommendation

Accept the current spike as a **NO-GO for `@extism/extism`**, preserve the
Phase-1 unavailable executor, and land only the design/roadmap decision for
#262. If real execution remains desired, create or approve a separate native
Extism/Wasmtime FFI design with platform packaging and lifecycle work explicitly
in scope. Do not weaken the issue's finite fuel and total-memory requirements
and do not land a partial JS-SDK executor under the same security claim.

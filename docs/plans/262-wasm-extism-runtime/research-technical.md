# Technical Research: Extism Runtime for Issue #262

## Executive Summary

The Phase-1 architecture is ready for a runtime adapter: `PluginExecutor` is a
frozen JSON-only boundary, `PluginHost` already supports constructor injection
and `setExecutor`, and each dispatch is isolated behind a five-second
`AbortSignal`. No shared contract, registry, validator, capability id, or
production call-site needs to change.

The requested `@extism/extism` implementation is nevertheless a **no-go under
issue #262's current acceptance criteria**. A live Deno spike on 2026-07-11
proved that `npm:@extism/extism@2.0.0-rc13` imports and executes a trivial
plugin in a worker after overriding its Node-only default worker arguments. It
also proved that a looping guest is terminated by the SDK timeout. However, the
JavaScript SDK exposes no fuel/instruction limit at all. Its `maxPages` option
limits allocations made through the Extism host ABI, not every WebAssembly
linear-memory allocation. Consequently it cannot truthfully enforce all three
required limits: timeout, total memory, and fuel.

The Phase-1 design conflates APIs from two different Extism implementations.
Methods such as `with_fuel_limit` exist in Extism's Rust runtime and C ABI, but
not in the Deno-capable JavaScript SDK. Native Deno `Worker` plus `WebAssembly`
does not repair that gap; worker termination provides a wall-clock bound but not
deterministic instruction accounting, and native Wasm does not let a host
retrofit a maximum onto guest-defined memories. QuickJS is a JavaScript guest
runtime, not an Extism Wasm runtime.

The implementation workflow should therefore preserve the existing
`UnavailablePluginExecutor` and record a no-go unless the issue is explicitly
changed in one of two ways:

1. use the native Extism/Wasmtime runtime through a maintained Deno FFI adapter
   and ship the required platform libraries; or
2. relax the fuel and total-memory acceptance criteria and document the weaker
   JavaScript-SDK sandbox (not recommended for untrusted third-party code).

The rest of this document specifies the concrete adapter architecture to use if
a compliant Extism backend is selected, and the exact JavaScript-SDK shape if
the acceptance criteria are deliberately relaxed. In either case, Extism types
remain confined to one server-only adapter.

## Authoritative Baseline

Phase 1 already establishes the boundaries that issue #262 must not reopen:

- `PluginExecutor.execute(req): Promise<PluginJsonValue>` is the only execution
  seam.
- `PluginExecutionRequest` already carries the registered plugin, extension
  point, projected input, and a finite `AbortSignal`; its shape remains
  unchanged.
- `PluginHost` defaults to `UnavailablePluginExecutor`, accepts an executor in
  its constructor, and exposes `setExecutor`. These are sufficient injection
  points.
- `notifyObservers` projects and scrubs the input once, then dispatches plugins
  sequentially with a per-plugin `try/catch`; one failure never reaches the
  producer or skips later plugins.
- The registry namespace is `(apiVersion, lowercased plugin id)`. Manifest
  `version` is available on each `RegisteredPlugin`.
- `PLUGINS_ENABLED` defaults off. No production observe producer is wired in
  this issue.

One documentation invariant must change when a real executor lands: `scan.ts`
can no longer be described as the only server filesystem boundary. It remains
the only **discovery/manifest** filesystem boundary, while the runtime adapter
owns the narrowly scoped read of the selected Wasm entry artifact.

## Spike Evidence and Go/No-Go Decision

### Live Deno observations

The spike used the repository's Deno 2 environment and the published package,
without changing the worktree:

```text
deno eval --node-modules-dir=none 'import ... from
  "npm:@extism/extism@2.0.0-rc13" ...'
```

| Probe                                   | Result                                                                   | Architectural consequence                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Import `npm:@extism/extism@2.0.0-rc13`  | Pass                                                                     | npm is viable under Deno; no FFI permission is needed by this SDK.                                             |
| Import `jsr:@extism/extism`             | Fail: no published matching version                                      | Use an exact npm specifier; do not document a JSR dependency today.                                            |
| Worker plugin with SDK defaults         | Fail: Deno rejects `--disable-warning=ExperimentalWarning` in `execArgv` | Every Deno call to `createPlugin` must pass `nodeWorkerArgs: { execArgv: [] }`.                                |
| Same plugin with `execArgv: []`         | Pass; `count_vowels` returned valid JSON                                 | Basic Deno worker execution is viable.                                                                         |
| Infinite-loop guest, `timeoutMs: 100`   | Pass; rejected with `EXTISM: call canceled due to timeout`               | Worker termination is functional, although observed completion was about 393 ms and is not a precise deadline. |
| `allowedHosts: []`                      | Supported and fail-closed in SDK HTTP host function                      | Network can be denied through the Extism host API.                                                             |
| `allowedPaths: {}` and `useWasi: false` | Supported                                                                | Do not expose WASI or path preopens.                                                                           |
| `memory.maxPages`                       | Present                                                                  | Bounds Extism host-context blocks; do not describe it as a complete process/guest memory ceiling.              |
| Fuel/instruction option                 | Absent from `Manifest`, `ExtismPluginOptions`, and SDK source            | Current issue acceptance cannot be met.                                                                        |
| `AbortSignal` on `Plugin.call`          | Absent                                                                   | Adapter must bridge cancellation by racing the call and terminating its per-invocation worker.                 |

The package is also a release candidate: `2.0.0-rc13` is the npm `latest` tag
and was published on 2025-05-14. Exact pinning is required; a caret range across
release candidates would make the sandbox behavior non-reproducible.

### Why the fuel mismatch is decisive

The JavaScript SDK uses the host runtime's `WebAssembly` implementation. Its
public options include worker execution, timeout, allowed hosts/paths, and
host-context memory settings, but no fuel. By contrast, Extism's Rust
`PluginBuilder::with_fuel_limit` and C functions such as
`extism_plugin_new_with_fuel_limit` use Wasmtime's instruction accounting. Those
APIs are not reachable through `@extism/extism`.

A cooperative guest counter, an extra timer, or a host function named
`consume_fuel` is not an enforced instruction limit: hostile or buggy code can
omit it. Likewise, post-hoc inspection of a `WebAssembly.Module` cannot impose a
maximum on guest-defined memory. The go/no-go gate must judge the actual
backend, not the Extism project in aggregate.

### Decision

**NO-GO for `@extism/extism` while finite fuel and complete memory enforcement
remain mandatory.** Do not merge an `ExtismPluginExecutor` that defines an
unused `FUEL_LIMIT` constant or labels a host allocation cap as total Wasm
memory. That would satisfy the shape of the issue while violating its security
objective.

A native Extism FFI path is technically capable of the required behavior because
the C ABI exposes compiled-plugin fuel limits and cancellation handles. It is a
materially larger deployment design: Linux and Windows shared libraries,
architecture selection, artifact integrity, FFI safety, `deno compile`
packaging, licensing, upgrade policy, and absent-library degradation all need
explicit work. It should be approved as a scope change or split into a
prerequisite issue before coding.

## Architecture Design

If a backend with timeout, memory, fuel, and cancellation is approved, add a
sibling adapter rather than modifying the frozen seam:

```text
PluginHost
-> PluginExecutor (frozen)
-> ExtismPluginExecutor (server-only adapter)
-> artifact resolver + digest
-> compiled-module cache
-> per-invocation runtime instance
-> JSON protocol codec
-> backend timeout / memory / fuel / cancellation
```

Recommended files and ownership:

| File                               | Responsibility                                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/plugins/executor.ts`       | Keep the interface and unavailable default. Export runtime-independent constants/types only if needed.                                               |
| `server/plugins/extismExecutor.ts` | The only Extism import/FFI usage; artifact confinement, runtime creation, call, cancellation, output decoding, and cleanup.                          |
| `server/plugins/runtime.ts`        | Optional runtime selection factory. It catches loader/probe failure and returns `UnavailablePluginExecutor`. No Extism type in its public signature. |
| `server/plugins/index.ts`          | Export `ExtismPluginExecutor` and the selection factory without exporting SDK types.                                                                 |
| `tests/plugins/fixtures/*`         | Checked-in deterministic Wasm fixtures plus source/provenance and hashes. No network fetch in tests.                                                 |

## Data Models

### Stable guest call protocol

The manifest has no per-extension-point export mapping, and changing it would
violate the frozen contract. Use one runtime behavior protocol for every point:

- fixed guest export: `praxrr_execute`;
- UTF-8 JSON input:
  `{ "meta": { "pluginId", "apiVersion", "point" }, "input": <PluginJsonValue> }`;
- UTF-8 JSON output containing exactly one `PluginJsonValue`;
- missing export, null output, invalid UTF-8/JSON, or a non-JSON value becomes
  `PluginExecutionError`;
- no return value influences an observe producer; the host keeps discarding
  observe output.

Define `PLUGIN_RUNTIME_BEHAVIOR_VERSION = 'extism-json-v1'` beside the adapter
protocol. This is separate from `PLUGIN_API_VERSION`: the API version identifies
the public host/plugin contract, while the runtime behavior version identifies
serialization, export naming, sandbox construction, and cache interpretation.

The output must be recursively validated after `JSON.parse`; TypeScript casting
is insufficient. Reject non-finite numbers, prototype-bearing objects, excessive
nesting, and oversized input/output before they can become an unbounded
host-side resource. Reasonable initial limits are 1 MiB encoded input, 1 MiB
encoded output, and depth 64. These are additional host bounds, not substitutes
for Wasm fuel or memory limits.

### Entry artifact confinement

Resolve `plugin.manifest.entry` relative to `plugin.sourceDir`, canonicalize
both paths with `Deno.realPath`, and require the artifact path to remain inside
the canonical plugin directory. Reject absolute paths, traversal, a directory
entry, symlink escape, and any file other than the one selected by the validated
manifest. Read bytes in the adapter, hash them with SHA-256, and hand bytes or a
compiled module to the backend. Never pass the plugin-supplied path to an Extism
manifest that could independently fetch a URL.

This host read does not grant guest filesystem access. Guest WASI remains
disabled and the Extism allowed-path map remains empty.

### Finite limits and cancellation

Keep limit values in one immutable server-only object and test every value is
finite, positive, and below its enclosing host budget:

| Limit                 |      Initial value | Enforcement                                                                                                   |
| --------------------- | -----------------: | ------------------------------------------------------------------------------------------------------------- |
| Host dispatch timeout |  existing 5,000 ms | `PluginHost` `AbortController`; final containment if an executor misbehaves.                                  |
| Backend call timeout  |           4,000 ms | Runtime worker/epoch timeout; deliberately expires before the host timeout.                                   |
| Wasm memory           | 256 pages / 16 MiB | Backend-wide Wasm resource limiter, including guest linear memories. JS SDK `maxPages` alone is insufficient. |
| Fuel                  |   10,000,000 units | Wasmtime/Extism fuel metering; tune only from benchmark evidence.                                             |
| Variable store        |              1 MiB | Extism variable-store bound.                                                                                  |
| HTTP response         |             64 KiB | Defense in depth; HTTP remains unreachable because allowed hosts is empty.                                    |
| Input/output          |         1 MiB each | Host codec before/after the runtime call.                                                                     |

Honor `req.signal` in three places:

1. reject immediately if it is already aborted;
2. register a once-only listener before starting runtime work;
3. on abort, invoke the backend cancellation handle or terminate the per-call
   worker, await cleanup, and reject with `PluginExecutionError`.

Always remove the listener in `finally`. Attach a rejection handler to the
losing call promise before the race so late failures cannot become unhandled
rejections. Backend timeout, host abort, guest trap, missing export, malformed
output, and cleanup error all remain execution failures isolated by
`PluginHost`. Do not translate them to `PluginRuntimeUnavailableError`; that
type is reserved for a backend that could not be selected or initialized at all.

Use a fresh runtime instance per `execute` until reentrancy, state reset,
poison-after-timeout, and cancellation semantics are proven. Reusing a mutable
plugin instance risks cross-call state leakage and lets one timed-out invocation
poison later dispatches. Compilation may be cached separately.

### Capability enforcement

Runtime grants must remain narrower than, or equal to, the compile-time
capability model:

- no custom host functions in issue #262 (`functions: {}`);
- no WASI for the initial runtime contract;
- empty allowed-host list;
- empty allowed-path map;
- bytes come only from the confined local entry artifact;
- the only invocation data is the already projected and scrubbed request input
  plus immutable meta;
- no config, environment, logger object, DB handle, Arr client, credential, or
  live domain object is supplied as host context.

Tests must attempt network and filesystem access while the Deno test process
itself has broad permissions. A denial under a broadly privileged host proves
that the guest sandbox, rather than the outer Deno permission set, enforced the
boundary.

## Executor Selection and Optional-Runtime Degradation

Do not make `PluginHost` construct the runtime. Keep the default exactly as
Phase 1 shipped and bind the real executor explicitly at startup:

```ts
export async function selectPluginExecutor(): Promise<PluginExecutor> {
  if (!config.pluginsEnabled) return new UnavailablePluginExecutor();
  try {
    return await loadAndProbeExtismExecutor();
  } catch (error) {
    await logSanitizedRuntimeUnavailable(error);
    return new UnavailablePluginExecutor();
  }
}
```

`hooks.server.ts` should select and inject before `pluginHost.initialize()`,
inside the existing warn-and-continue plugin startup boundary. Selection should
be dependency-injected in tests so an import failure, unsupported
worker/cancellation capability, missing shared library, or probe failure can be
simulated deterministically. An unavailable runtime must not unregister
otherwise valid manifests, abort boot, or change `PLUGINS_ENABLED`'s default-off
behavior.

For the JavaScript SDK specifically, the probe must require worker and timeout
capability and create workers with `nodeWorkerArgs: { execArgv: [] }`. Because
the dependency is source-resolved at check and build time, “package absent” is
not a supported installed state; graceful degradation covers disabled
configuration and runtime initialization/health failure. A native FFI backend
can additionally degrade on an absent or unloadable shared library.

## Cache Namespacing

There is no useful result cache in issue #262: both wired points are
observe-only, no production producer calls them yet, and their return values are
discarded. Do not add a result cache merely to satisfy a wording check.

Cache only immutable compiled artifacts. The cache key must include all
behavior-affecting identity:

```text
PLUGIN_RUNTIME_BEHAVIOR_VERSION
  + apiVersion
  + lowercased plugin.id
  + plugin.version
  + canonical entry path
  + SHA-256 artifact digest
```

The explicitly required namespace is therefore present — runtime behavior
version plus `(apiVersion, plugin.version)` — while plugin id and digest prevent
collisions between different plugins or an artifact changed without a version
bump. Use a bounded LRU (initially 32 modules), evict on `host.reset`, and never
cache mutable runtime instances or failures.

If a future transform/provider phase adds a deterministic result cache, extend
that namespace with the extension point and a canonical input digest. A cached
result produced under a different runtime behavior, API version, plugin version,
plugin id, artifact digest, point, or input must be unreachable.

## Fixtures and Test Matrix

Vendor small deterministic fixtures in the repository; never download Wasm
during a test. Each binary should have its source (`.wat` or PDK source),
reproducible build command, upstream provenance and license if copied, and a
checked SHA-256 value.

Required fixtures:

| Fixture                   | Purpose                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `echo-json`               | Exports `praxrr_execute`, validates input envelope, returns a nested JSON value.                                                   |
| `loop-forever`            | Proves backend timeout and mid-call `AbortSignal` cancellation.                                                                    |
| `allocate-over-limit`     | Proves the backend-wide Wasm memory ceiling, not only host ABI allocation.                                                         |
| `consume-fuel`            | Deterministically exceeds fuel before wall-clock timeout. This test must fail to implement on the JS SDK and is the go/no-go gate. |
| `http-attempt`            | Calls the Extism HTTP host API and proves empty allowed hosts deny it.                                                             |
| `fs-attempt`              | Imports/uses WASI filesystem access and proves no WASI/preopen is available.                                                       |
| malformed output variants | Return invalid JSON, null output, excessive depth, and oversized output.                                                           |

Test layers:

1. **Pure codec/path/cache tests:** protocol envelope, JSON-value validation,
   path traversal and symlink escape, stable cache key,
   behavior/API/plugin-version/artifact namespace misses, LRU eviction.
2. **Executor integration tests:** echo success; missing export; invalid output;
   pre-aborted and mid-call signal; backend timeout; memory ceiling; fuel
   exhaustion; network denial; filesystem denial; cleanup after every result.
3. **Host tests:** injected real/fake executor; failure of plugin A still
   dispatches plugin B; timeout returns to caller inside five seconds;
   unavailable runtime is debug-level skip; ordinary execution errors remain
   warning-level and swallowed.
4. **Startup tests:** feature off never attempts runtime selection; feature on
   plus failed probe keeps the unavailable executor and completes
   initialization.
5. **Platform checks:** Deno Linux CI is mandatory; Windows must exercise worker
   creation because the shipped app has a Windows build target. Native FFI
   requires a matrix for every distributed library/architecture.

Validation commands remain:

```text
deno task test plugins
deno task check
deno task lint:modified
deno task build
deno task build:windows
```

The fuel test is not optional evidence. If it cannot pass, the current
acceptance criteria remain unmet even when all other tests are green.

## Dependency and Lockfile Changes

If the weaker JavaScript-SDK path is explicitly approved, add one exact root
import:

```json
"@extism/extism": "npm:@extism/extism@2.0.0-rc13"
```

Use the root `deno.json`, not the package-local app manifest, because root
aliases and tasks are the repository source of truth. Regenerate the complete
`deno.lock` with the repository's Deno version and commit it in the same change.
The package has no runtime npm dependencies or install scripts, so no
`allowScripts` entry should be added. Verify the lock diff does not
opportunistically upgrade unrelated packages; if Deno rewrites unrelated
entries, isolate and explain that churn.

Do not add the currently unresolvable `jsr:@extism/extism` specifier. A native
FFI design instead needs pinned Extism native artifacts and checksum/provenance
metadata; adding `@extism/extism` would not provide the native runtime and
should not be done.

## Documentation and Roadmap Updates

The implementation PR must update all of the following in lockstep with the
actual go/no-go result:

- `docs/plans/35-wasm-plugin-system/phase-1-foundation.md`: append a dated spike
  result correcting the Rust-vs-JS API assumption, the `execArgv: []` Deno
  requirement, npm-only resolution, timeout evidence, and fuel/memory
  limitation.
- `docs/architecture/plugins.md`: describe the selected runtime, fixed
  `praxrr_execute` JSON protocol, runtime behavior version, artifact read
  boundary, sandbox limits, cache namespace, and degraded selection path. Do not
  claim Phase 2 shipped on a no-go.
- `ROADMAP.md`: preserve the overall WASM initiative as deferred. Record issue
  #262 as either a shipped compliant runtime or a documented no-go with its
  follow-up prerequisite; update the existing #35 line without implying that
  #263 production wiring is complete.
- Issue #267 and child issues #263-#266: keep them blocked by a compliant
  runtime. A partial JavaScript-SDK spike does not unblock production observe
  wiring, persistence/API, SDK docs, or UI.

## Implementation Sequence

1. Commit the design/spike record and obtain a decision on strict native runtime
   versus relaxed JS SDK criteria.
2. Add backend dependency/artifacts and lock data only after that decision.
3. Add protocol codec, path confinement, runtime behavior version, cache key,
   and deterministic fixtures.
4. Implement the server-only executor and unit/integration tests behind the
   unchanged seam.
5. Add runtime selection and startup degradation tests; keep unavailable as the
   default.
6. Run plugin tests, full checks, lint, Linux build, and Windows build.
7. Update Phase-1 design, architecture note, ROADMAP, and issue links to match
   observed behavior.
8. Review specifically for false sandbox claims, Extism type leakage,
   worker/runtime cleanup, path escape, unbounded data, cache collisions, and
   optional-subsystem boot regressions.

## Sources

- Extism JavaScript SDK source and public interfaces:
  <https://github.com/extism/js-sdk/tree/bec25c60d0ad32ce06d3934563fd8560f486f323>
- JavaScript SDK npm package (`2.0.0-rc13`):
  <https://www.npmjs.com/package/@extism/extism/v/2.0.0-rc13>
- Extism Rust `PluginBuilder` fuel implementation:
  <https://github.com/extism/extism/blob/main/runtime/src/plugin_builder.rs>
- Extism C ABI fuel and cancellation functions:
  <https://github.com/extism/extism/blob/main/runtime/extism.h>
- Extism runtime manifest concepts: <https://extism.org/docs/concepts/manifest/>

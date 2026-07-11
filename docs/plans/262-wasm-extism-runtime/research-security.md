# Security Research: Extism Runtime for Issue #262

## Executive Summary

`npm:@extism/extism@2.0.0-rc13` is a **NO-GO** for issue #262 as written. This
is a security gate, not a preference about implementation style. The issue
requires finite, enforced wall-clock, total guest-memory, and fuel/instruction
limits. The Deno-capable JavaScript SDK has a worker timeout, but exposes no
fuel option and its `memory.maxPages` check accounts for Extism host-ABI blocks,
not all guest-defined WebAssembly linear memory. Calling this configuration a
sandbox would create a false security boundary.

The strict choices are therefore:

1. keep `UnavailablePluginExecutor`, document the failed spike, and defer #262
   until a compliant backend is selected; or
2. explicitly expand the design to a pinned native Extism/Wasmtime backend, with
   platform artifacts, FFI permissions, integrity/provenance, crash and lifetime
   analysis, and tests that prove all required limits.

Relaxing the issue's fuel or total-memory requirements is not a secure route for
untrusted third-party plugins. Native FFI can provide the missing Extism APIs,
but it moves trusted native code outside Deno's sandbox and materially enlarges
the supply-chain and process-integrity boundary. It should not be introduced as
an incidental adapter change.

## Classification Model

This report uses three action-oriented severities:

- **CRITICAL** — contradicts a mandatory sandbox invariant or can permit an
  untrusted guest to exhaust/escape the intended boundary. It blocks a GO
  decision and blocks shipping the claimed runtime until proved fixed.
- **WARNING** — a substantial security, availability, or supply-chain risk that
  must have an explicit mitigation and verification before enabling the runtime,
  but does not independently prove guest escape in the currently disabled,
  no-production-call-site phase.
- **ADVISORY** — defense in depth or future-proofing. It should be designed and
  tested now where cheap, but it is not by itself a release blocker for a
  backend that meets all mandatory gates.

Absence of a published advisory is not evidence that a dependency or native
artifact is safe. Severity here follows the demonstrated behavior and Praxrr's
threat model.

## Threat Model and Trust Boundaries

Treat all of the following as attacker-controlled:

- manifest fields, including `entry`, id, version, and future config;
- Wasm bytes and every import/export shape;
- guest computation, linear-memory growth, traps, logs, output bytes, and
  timing;
- projected input values to the extent that upstream data can be adversarial;
- a plugin update that reuses a version string or replaces an artifact on disk.

The attacker aims to:

- consume CPU indefinitely or evade deterministic accounting;
- exhaust process memory through guest memory, Extism blocks, variables, shared
  buffers, compilation, or oversized I/O;
- reach network, filesystem, environment, subprocess, FFI, database, Arr
  credentials, or other host capabilities;
- read a file outside the plugin directory through path traversal or symlinks;
- leak state or cached results across plugin versions, instances, or inputs;
- crash/poison the runtime so later plugins fail or the Praxrr process exits;
- exploit dependency, native-library, or dynamic-loader substitution.

Trusted components are Praxrr's host code, the selected runtime implementation,
the JavaScript dependency graph, Deno/V8, and—if FFI is chosen—the complete
native Extism/Wasmtime library and its transitive native dependencies. Wasm is
not trusted merely because validation or compilation succeeds.

The feature flag reduces current exposure but is not a sandbox control. A
default-off subsystem must still be secure before it can be described as ready
for future untrusted plugins.

## Findings by Severity

### SEC-262-01 — Missing fuel enforcement in the JavaScript SDK

**Severity: CRITICAL**

The `ExtismPluginOptions`, `ManifestOptions`, and `Manifest` interfaces in the
pinned JavaScript SDK contain timeout, allowed hosts/paths, and memory options,
but no fuel or instruction-budget field. The SDK uses the JavaScript runtime's
built-in `WebAssembly`; it is not an FFI binding to Extism's Wasmtime runtime.
Worker termination after a timer is a wall-clock containment mechanism, not
deterministic instruction accounting.

Consequences:

- the issue's explicit fuel acceptance criterion cannot be implemented;
- a cooperative guest counter or host function can be bypassed by hostile code;
- an unused `FUEL_LIMIT` constant, elapsed-time heuristic, or timeout error
  renamed to `fuel_exhausted` would be security theater.

The native C ABI separately exposes `extism_compiled_plugin_new_with_fuel_limit`
and `extism_plugin_new_with_fuel_limit`; their existence does not make those
APIs available in `@extism/extism`.

**Required disposition:** reject the JavaScript SDK for the strict issue. A GO
requires a backend-level fuel-burner fixture that predictably exhausts fuel
before the longer wall-clock timeout and leaves a subsequent invocation healthy.

### SEC-262-02 — `maxPages` is not a complete guest-memory ceiling

**Severity: CRITICAL**

The JavaScript SDK's `CallContext.alloc` sums buffers allocated through the
Extism host context and compares that total with `memory.maxPages`. It does not
install a V8/WebAssembly resource limiter over every guest-defined or imported
linear memory. A module can therefore declare or grow its own memory outside
that accounting path, while compilation, instance memory, shared buffers, and
host output copies also consume process memory.

Consequences:

- `maxPages` must not be documented as the issue's total Wasm-memory limit;
- Node worker `resourceLimits`, even if honored by Deno, governs JavaScript heap
  categories and is not proof of a Wasm linear-memory ceiling;
- worker termination can stop further growth but cannot guarantee that the
  process survives a sufficiently aggressive allocation.

**Required disposition:** reject the JavaScript SDK for the strict issue. A
native candidate must pass a fixture whose own linear memory grows beyond the
limit. The assertion must cover guest memory, not only Extism `alloc`/variable
paths, and must show that the process and next call remain healthy.

### SEC-262-03 — Worker timeout is viable but not sufficient cancellation

**Severity: WARNING**

The rc13 worker implementation races calls against `timeoutMs`, terminates the
worker, and creates a replacement. The live Deno spike confirmed a looping guest
is rejected. However:

- `Plugin.call` accepts no `AbortSignal`;
- the SDK timeout is not a precise deadline and observed cleanup can extend
  beyond the configured timeout;
- SDK source explicitly has poisoned/hanging recovery branches when restart
  itself times out or fails;
- the plugin object owns a mutable worker and variables, so sharing it across
  overlapping calls complicates state and cancellation;
- the SDK's `runInWorker` option is marked experimental and refers to an open
  worker bug in its own API documentation.

The host's `Promise.race` alone would only release the caller; it would not stop
the underlying CPU or memory consumption.

**Required mitigation:** one runtime instance/worker per invocation until
reentrancy and reset behavior are proved; pre-abort check; once-only abort
listener; terminate/cancel on abort; await cleanup; remove listeners in
`finally`; attach a rejection handler to any losing promise. Backend timeout
must expire before the host's five-second deadline. Test pre-abort, mid-call
abort, timeout during guest execution, timeout during initialization, repeated
timeouts, close, and a healthy post-failure call. Never return a timed-out
instance to a pool.

### SEC-262-04 — rc13's default worker arguments are incompatible with Deno

**Severity: WARNING**

The SDK defaults `nodeWorkerArgs.execArgv` to
`['--disable-warning=ExperimentalWarning']`. The live Deno 2.9.1 spike failed
until Praxrr supplied `nodeWorkerArgs: { execArgv: [] }`. This override is a
compatibility requirement for every Deno worker construction, not an optional
test detail.

The override does not create a sandbox, narrow Deno permissions, add fuel, or
bound guest memory. It merely prevents Deno from rejecting the Node-specific
worker flag.

**Required mitigation:** pin the exact SDK and Deno versions in spike evidence,
set `execArgv: []` centrally, probe worker creation at startup, and exercise it
in Linux and Windows build/runtime checks. Fail closed to
`UnavailablePluginExecutor` if the probe fails.

### SEC-262-05 — The Extism worker is not a Deno permission boundary

**Severity: WARNING**

Deno Web Workers inherit the parent's permissions by default; reduced worker
permissions require the Deno-specific worker option. rc13 creates a
`node:worker_threads.Worker` and its public `NodeWorkerArgs` mirrors Node
options, not Deno's `deno.permissions` option. The `execArgv: []` workaround
does not change this. Thus the Extism dependency code running in the worker
should be treated as having the application's ambient Deno authority.

Wasm still cannot call arbitrary Deno APIs without a matching import, so this is
not evidence that a guest can directly use inherited permissions. It does mean
the worker is isolation for CPU scheduling/termination, not a second permission
sandbox, and a runtime/dependency vulnerability has the parent's blast radius.

**Required mitigation:** grant the Praxrr process only its required permissions;
do not use `-A` as production or acceptance evidence; expose no custom host
functions in #262; keep WASI off; pass Wasm bytes instead of paths/URLs; and
test guest denial while the outer test process deliberately has network/read
access. If a separately permissioned Web Worker cannot be used by the selected
backend, document the single-process trust boundary rather than claiming layered
Deno isolation.

### SEC-262-06 — Network denial is fail-closed only through Extism's HTTP import

**Severity: WARNING**

In rc13, `HttpContext.makeRequest` parses the guest URL and checks
`allowedHosts.some(...)` before invoking `fetch`. An empty array therefore
denies every request through `extism:host/env::http_request`. This is the
correct #262 configuration.

Important limits:

- `allowedHosts` controls the Extism HTTP host function, not all code in the
  worker or process;
- supplying a custom host function that performs network I/O would bypass it;
- accepting a URL/path manifest would let host-side loading perform I/O before
  guest execution and must not be confused with guest allowlisting;
- future non-empty wildcard lists introduce DNS rebinding, redirects, ports, IP
  literals, and private-address questions outside #262.

**Required mitigation:** `allowedHosts: []`, no network-capable host functions,
no guest-provided fetch implementation, and only already-read local bytes in the
runtime manifest. Test an actual guest import with the host process granted
network access and assert `fetch` is never reached. Any future allowlisting
needs a new threat model and redirect/address validation.

### SEC-262-07 — Filesystem denial depends on disabling WASI, not merely an empty path map

**Severity: WARNING**

An empty `allowedPaths` object is useful only in the WASI path-mapping surface.
For #262, `useWasi: false` is the decisive control: a guest importing
`wasi_snapshot_preview1` must fail instantiation because no WASI implementation
is provided. The host must still read the selected `.wasm`; that host artifact
read is separate from guest filesystem authority.

**Required mitigation:** keep `useWasi: false`, `allowedPaths: {}`, and no
filesystem host functions. Pass bytes, never the plugin-controlled path, to the
runtime. Test a WASI filesystem fixture under a host process with broad read
permission and prove denial. Do not claim that Deno's outer read permission is
removed from the rc13 worker (SEC-262-05).

### SEC-262-08 — Plugin entry resolution can become a host file-read primitive

**Severity: CRITICAL**

If a manifest entry is handed directly to Extism as a path, a malicious plugin
can attempt an absolute path, `..` traversal, or symlink escape. This is a host
read occurring before the guest sandbox and can expose any file readable by the
Praxrr process.

**Required mitigation:** reject absolute entries and non-Wasm file types;
resolve relative to `sourceDir`; canonicalize both directory and entry with
`Deno.realPath`; require a true descendant path (path-segment comparison, not a
string prefix); require a regular file; read a bounded byte length; hash the
bytes; and pass only those bytes to the backend. A symlink-escape test is
mandatory. If plugin directories can be modified concurrently, document and
close the check/read race through immutable ownership/permissions or an
equivalent handle-based design. Hashing the actual bytes ensures cache identity
follows what executed, but is not by itself authorization to read an escaped
path.

### SEC-262-09 — Input/output decoding needs independent host bounds

**Severity: WARNING**

WebAssembly limits do not bound JSON parsing, UTF-8 decoding, recursion, or
host-side copies. `PluginOutput.json()` is only `JSON.parse`; it provides no
size, depth, prototype, or `PluginJsonValue` validation. A TypeScript cast is
not runtime validation.

**Required mitigation:** before execution, serialize the already projected input
and reject encoded UTF-8 over a fixed bound (recommended initial maximum: 1
MiB). After execution, reject missing output and byte length over the output
bound before decoding; decode with fatal UTF-8; parse once; validate iteratively
as exactly `PluginJsonValue`; accept only `null`, booleans, finite numbers,
strings, arrays, and plain own-property objects; reject excessive depth
(recommended 64), cycles/unsupported values in host input, dangerous reuse via
merging, and all other values. JSON bytes containing literal `null` are a valid
`PluginJsonValue`; SDK `null` meaning "no returned bytes" is not.

Do not log raw input, output, parse errors containing payload excerpts, guest
stacks, URLs, or host paths. Return a stable host-owned error classification.
Tests must cover invalid UTF-8, invalid JSON, oversized values, deep arrays and
objects, non-finite host input, `__proto__`/`constructor` keys, and missing
output.

### SEC-262-10 — Mutable instance and cache reuse can cross security domains

**Severity: WARNING**

Extism plugins may retain variables between calls; the JavaScript SDK documents
that variables persist until reset and are scoped to an instance. Reusing an
instance can leak data between invocations and allow a trap/timeout to poison
later work. A cache keyed only by plugin id/version can also execute stale bytes
when an artifact changes without a version bump or collide across API/runtime
semantics.

**Required mitigation:** cache only immutable compiled artifacts, not mutable
instances, outputs, failures, host contexts, or cancellation state. Use fresh
instances per call. Bound the compile cache (for example, LRU 32), clear it on
host reset, and key it with all behavior-affecting identity:

```text
runtime behavior version
+ apiVersion
+ lowercased plugin id
+ plugin.version
+ canonical entry path
+ SHA-256 of the exact executed bytes
```

Do not add a result cache in #262. If a future deterministic extension point
adds one, it also needs extension point, canonical input digest, sandbox-policy
version, and explicit secret/tenant partitioning.

## Dependency Security

### SEC-262-11 — rc13 is an aging release candidate with an unusual publication posture

**Severity: WARNING**

As verified on 2026-07-11, npm's `latest` is `2.0.0-rc13`, published 2025-05-14;
the repository's last source push is from the same date. The README warns of
breaking changes between RC versions. GitHub's latest ordinary release entry is
`v1.0.1` from 2024, while npm points consumers at the 2.0 RC. The package has no
runtime npm dependencies or lifecycle scripts, which reduces but does not remove
supply-chain risk. No repository security advisories were returned by GitHub;
that is not a security audit.

**Required mitigation if criteria are deliberately relaxed:** exact-pin
`npm:@extism/extism@2.0.0-rc13` (no caret, range, or dist-tag); commit and
review the full `deno.lock` integrity change; add no `allowScripts` entry; use
frozen lockfile/`deno ci` in CI; run `deno audit` and the repository's existing
audit gates; record the upstream commit and package integrity; and require
intentional review for upgrades. The rc13 dependency still does not solve
SEC-262-01/02.

### SEC-262-12 — Native FFI bypasses Deno's sandbox and can crash the process

**Severity: CRITICAL for an unreviewed in-process FFI implementation; WARNING
after an approved native design**

Deno documents `Deno.dlopen` libraries as native code outside its sandbox with
the same access level as the process: filesystem, network, environment, and
command execution are available regardless of the JavaScript permission model.
FFI requires `--allow-ffi`, and a memory-safety or ABI error can corrupt or
crash the Praxrr process. Wasmtime may sandbox the guest, but the
Extism/Wasmtime library itself becomes fully trusted.

The native C ABI does expose the required fuel constructors and a cancellation
handle, so it is a technically credible direction. It is not a drop-in security
equivalent to the pure-JS package.

**Required native design before coding:** pin an Extism release (not a moving
`latest` artifact), OS, architecture, C ABI symbols, and compatible Deno
version; obtain artifacts from a controlled release workflow; verify
checksums/signatures before installation and at packaging time; scope
`--allow-ffi` to the exact library path; do not use OS search-path loading;
bundle each platform artifact explicitly for `deno compile`; record
license/SBOM/provenance; and fail closed on missing, wrong-architecture,
wrong-version, or missing-symbol libraries.

Prefer a separately supervised runtime process if feasible: process isolation
contains native crashes and permits OS memory/CPU/filesystem/network controls.
If in-process FFI is selected, explicitly accept that a native fault can take
down Praxrr and test startup degradation without the library.

### SEC-262-13 — Native cancellation and pointer lifetimes require a concurrency proof

**Severity: CRITICAL for a native implementation until verified**

The C API states that a cancellation handle may cancel a running plugin from
another thread. An adapter must therefore make the blocking plugin call on a
non-main execution path and invoke cancellation without freeing the plugin or
handle concurrently. Output and error pointers are native borrowed memory and
must be copied while valid; constructor errors have a distinct free function.
Incorrect signatures, integer widths, pointer ownership, or free ordering can
cause use-after-free, leaks, data corruption, or process crashes.

**Required proof:** declare the ABI from the exact pinned header; use
`ExtismSize`/64-bit types correctly; keep input buffers alive for the entire
call; copy bounded output immediately after a successful call and before the
next call/free; copy/sanitize errors according to ownership rules; never free a
plugin until the call has returned after cancellation; free compiled plugins,
instances, functions, errors, and dynamic libraries exactly once; and serialize
or isolate calls per instance. Stress tests must race abort/timeout with return,
trap, and close under sanitizers in an upstream/native test harness where
possible.

### SEC-262-14 — Native limits must be evidenced, not inferred from API names

**Severity: CRITICAL**

The presence of `with_fuel_limit`, cancellation, or manifest `max_pages` APIs is
necessary but not sufficient. Version differences, manifest encoding mistakes,
or wrong constructor selection can silently omit a limit. The adapter must prove
the configured behavior of the exact shipped library on every supported target.

**Required proof:** deterministic fixtures for infinite loop, fuel burn, own
linear-memory growth, Extism allocation/variables, HTTP attempt, WASI filesystem
attempt, trap, malformed output, and healthy calls after each failure. Record
the exact limits and runtime version in safe startup metadata. A platform with
no passing enforcement matrix remains runtime-unavailable; it must not silently
fall back to the weaker JavaScript SDK.

### SEC-262-15 — Error and telemetry content can leak plugin-controlled secrets

**Severity: ADVISORY**

SDK and native errors may include guest strings, URLs, paths, function names,
payload fragments, or stacks. The rc13 HTTP denial error includes the full URL.
Forwarding guest stdout/stderr or raw runtime errors into normal logs converts
the plugin into a log-injection and data-exfiltration surface.

**Required hardening:** disable WASI output; use a silent runtime logger unless
a sanitized adapter is supplied; map failures to stable host-owned codes; log
only safe plugin identity, point, runtime version, policy values, elapsed
duration, and outcome; strip control characters from any identifier; never log
raw payloads, URLs, paths, Wasm bytes, headers, config, stacks, or native
pointers. Rate-limit repeated failures.

### SEC-262-16 — Optional-subsystem degradation must remain fail-closed

**Severity: ADVISORY**

Feature OFF must perform no runtime import/probe, artifact read, worker
creation, or FFI load. Feature ON plus an unavailable or unhealthy runtime must
leave `UnavailablePluginExecutor` installed and let Praxrr boot; it must not
weaken limits, switch to a noncompliant backend, or partially activate plugins.

An individual timeout, trap, bad output, or forbidden I/O is an execution
failure isolated to that plugin, not proof that all plugin support is globally
unavailable. Conversely, failed runtime probing, missing native artifacts, or
unsupported platform capability is runtime-unavailable.

Test both categories and ensure errors are swallowed only at the existing host
isolation boundary. Security failures must remain observable through sanitized,
bounded telemetry rather than being silently retried.

## Backend Risk Comparison

| Property                    | JS SDK rc13                                           | Native Extism/Wasmtime FFI                                      | Secure disposition                                 |
| --------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------- |
| Fuel/instruction limit      | Absent                                                | C ABI exposes fuel constructors                                 | JS is NO-GO; native must prove fixture             |
| Complete guest-memory limit | `maxPages` covers host-context blocks only            | Runtime manifest/Wasmtime can enforce, subject to proof         | JS is NO-GO; native must prove own-memory growth   |
| Wall-clock timeout          | Worker terminate/restart; experimental path           | Cancellation handle plus host deadline                          | Both require cleanup and post-failure tests        |
| `AbortSignal`               | Not accepted by `Plugin.call`                         | Adapter can bridge to cancel handle                             | Must implement explicitly                          |
| Guest network               | Empty `allowedHosts` denies Extism HTTP import        | Empty manifest allowlist should deny                            | Test with privileged host; no other host functions |
| Guest filesystem            | `useWasi: false`; empty paths                         | Disable WASI; no paths                                          | Test actual WASI import denial                     |
| Deno permission isolation   | Worker should be treated as inheriting host authority | Native library bypasses Deno sandbox                            | Neither is a second permission sandbox             |
| Host crash risk             | V8/runtime bugs; worker helps availability            | ABI/memory-safety/native library can crash process              | Prefer sidecar or accept and test blast radius     |
| Supply chain                | Exact npm RC + lock integrity                         | Per-platform native artifacts and transitive Rust/Wasmtime code | Pin, verify, SBOM, audit, upgrade policy           |
| Packaging                   | npm/lockfile                                          | Shared library per OS/arch, `deno compile --include`            | Native is a separate deployment design             |
| Current #262 decision       | Fails mandatory gates                                 | Plausible but unimplemented and unapproved                      | Defer or approve native prerequisite               |

## Required Security Acceptance Matrix

A future GO must provide current, platform-specific evidence for every row:

| Gate                     | Required evidence                                              | Failure disposition      |
| ------------------------ | -------------------------------------------------------------- | ------------------------ |
| Exact dependency/runtime | Version, commit/release, integrity/checksum, lock/SBOM         | Runtime unavailable      |
| Worker/native load       | Linux and Windows supported paths; missing artifact degrades   | Runtime unavailable      |
| Timeout                  | Infinite guest stopped before host deadline                    | Block GO                 |
| Host cancellation        | Pre-abort and mid-call abort stop work, cleanup completes      | Block GO                 |
| Fuel                     | Deterministic fuel burner exhausts before timeout              | Block GO                 |
| Guest memory             | Guest-owned memory growth hits finite ceiling                  | Block GO                 |
| Other memory             | Extism blocks, variables, shared buffers, input/output bounded | Block GO                 |
| Network                  | Actual Extism HTTP call denied; host `fetch` not reached       | Block GO                 |
| Filesystem               | WASI filesystem import/access denied under privileged host     | Block GO                 |
| Artifact confinement     | Absolute/traversal/symlink/directory/oversize rejected         | Block GO                 |
| Output codec             | Missing/invalid UTF-8/JSON/type/depth/size rejected            | Block GO                 |
| Failure isolation        | Trap/timeout/fuel/memory/I/O failure followed by healthy call  | Block GO                 |
| Cache isolation          | Runtime/API/id/version/path/digest changes all miss            | Block GO if cache exists |
| Disabled mode            | No dependency load, worker, FFI, or artifact read              | Block GO                 |
| Unavailable mode         | App boots with inert executor; no weaker fallback              | Block GO                 |
| Logs                     | No payload, path, URL, stack, pointer, or guest stdout leak    | Fix before enablement    |

The tests should run with the outer Deno process granted enough read/network
authority to make a sandbox regression meaningful. A denial caused only by the
test runner lacking permission does not prove the guest boundary.

## Recommended Decision Record

Record the spike as:

> **NO-GO (2026-07-11):** `@extism/extism@2.0.0-rc13` imports and executes under
> Deno 2.9.1 only after overriding worker `execArgv` to `[]`, and worker timeout
> termination functions. The backend exposes no fuel limit and its `maxPages`
> option is not a total guest linear-memory ceiling. It therefore cannot meet
> issue #262's mandatory sandbox contract. Praxrr retains
> `UnavailablePluginExecutor`; production plugin wiring remains blocked. A
> native Extism/Wasmtime backend requires a separately approved security and
> packaging design, or the runtime remains deferred.

Do not describe the JavaScript result as a partial production implementation. Do
not add the dependency solely to preserve a failed spike. Source-level evidence
and a reproducible design record are sufficient; introducing dormant runtime
code expands supply-chain exposure without meeting acceptance.

## Primary Sources

- [Extism JavaScript SDK at the evaluated commit](https://github.com/extism/js-sdk/tree/bec25c60d0ad32ce06d3934563fd8560f486f323)
  — Deno support, use of the host JavaScript WebAssembly runtime, RC warning,
  worker status, and plugin state behavior.
- [Extism JavaScript SDK public interfaces](https://github.com/extism/js-sdk/blob/bec25c60d0ad32ce06d3934563fd8560f486f323/src/interfaces.ts)
  — options, `Plugin.call`, worker arguments, allowed hosts/paths, and memory
  fields; no fuel or `AbortSignal` API.
- [Extism JavaScript SDK creation defaults](https://github.com/extism/js-sdk/blob/bec25c60d0ad32ce06d3934563fd8560f486f323/src/mod.ts)
  — `runInWorker`, empty host/path defaults, timeout requirement, and default
  `execArgv`.
- [Extism JavaScript SDK background runtime](https://github.com/extism/js-sdk/blob/bec25c60d0ad32ce06d3934563fd8560f486f323/src/background-plugin.ts)
  — timeout race, worker termination/restart, poisoned-state branches, shared
  buffer, and close behavior.
- [Extism JavaScript SDK memory accounting](https://github.com/extism/js-sdk/blob/bec25c60d0ad32ce06d3934563fd8560f486f323/src/call-context.ts)
  — `maxPages` is applied to host-context allocated blocks and variables have a
  separate byte limit.
- [Extism JavaScript SDK HTTP enforcement](https://github.com/extism/js-sdk/blob/bec25c60d0ad32ce06d3934563fd8560f486f323/src/http-context.ts)
  — host matching occurs before `fetch`; empty hosts deny the Extism HTTP
  import.
- [Extism C ABI header](https://github.com/extism/extism/blob/v1.30.0/runtime/extism.h)
  — native fuel constructors, cancellation handle, output/error pointers, and
  ownership/free functions.
- [Extism manifest documentation](https://extism.org/docs/concepts/manifest/) —
  byte/path/URL sources, hashes, memory settings, allowed hosts, and paths.
- [Deno Web Worker documentation](https://docs.deno.com/examples/web_workers/) —
  workers inherit permissions by default and Deno-specific reduced worker
  permissions.
- [Deno worker permission option stability](https://docs.deno.com/runtime/reference/cli/unstable_flags/#--unstable-worker-options)
  — the Deno-specific per-worker permission option and its unstable flag.
- [Deno FFI security and packaging](https://docs.deno.com/runtime/fundamentals/ffi/)
  — native code bypasses the Deno sandbox, path/loading semantics, explicit FFI
  permission, graceful load errors, and `deno compile --include` behavior.
- [Deno dependency management](https://docs.deno.com/runtime/packages/) — exact
  lock integrity, frozen installs, lifecycle-script policy, and audit.
- [Deno audit](https://docs.deno.com/runtime/reference/cli/audit/) — advisory
  scanning from the lockfile and CI guidance.

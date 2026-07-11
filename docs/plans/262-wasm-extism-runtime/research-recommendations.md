# Issue #262 Recommendations: Preserve the Sandbox Contract and Record the Extism JS No-Go

## Executive Summary

Land issue #262 as a **documented Deno/Extism viability spike with a NO-GO
decision for `@extism/extism`**, and leave the Phase-1 runtime foundation
unchanged. Do not add the npm dependency, do not implement or select an
`ExtismPluginExecutor`, and do not claim that Phase 2 has delivered WASM
execution.

This is the safest outcome that is faithful to the issue's actual purpose. The
Phase-1 design made the Deno-WASM spike a gate and explicitly stated that a
negative result should cost only the executor, never the foundation. The spike
has now produced that negative result:

- `npm:@extism/extism@2.0.0-rc13` can load and execute a compatible trivial
  guest on Deno;
- worker-backed timeout works only after overriding the SDK's Node-specific
  worker arguments with `nodeWorkerArgs: { execArgv: [] }`;
- the advertised JSR package is not published/resolvable;
- `Plugin.call` has no `AbortSignal` or cancellation argument, and closing the
  plugin during an active call did not promptly settle that call;
- `memory.maxPages` limits Extism host exchange allocations, not guest-owned
  WebAssembly linear memory;
- the JavaScript SDK has no fuel or instruction-metering facility.

Finite timeout, total guest-memory, fuel, and active cancellation are co-equal
acceptance gates in #262. A successful hello-world call cannot compensate for
failing them. Shipping a JS executor would therefore create a sandbox whose
implementation is weaker than its public and architectural claims.

The resulting pull request should be intentionally evidence-only: update the
Phase-1 design with the dated spike result, correct the architecture
documentation's Rust-versus-JavaScript Extism API assumption, and update
`ROADMAP.md` to record that the runtime phase remains blocked. The existing
`UnavailablePluginExecutor`, default-off feature flag, frozen `PluginExecutor`
seam, registry, validator, and host isolation remain the production state.

## Decision Matrix

| Option                                              | Meets #262 limits as written                                                                                              | Delivery and operational cost                                                                                                                               | Security confidence                                                                     | Recommendation                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1. Evidence-only no-go; foundation unchanged        | Truthfully records that the selected backend cannot meet them; does not pretend runtime delivery                          | Low; documentation and reproducible evidence only                                                                                                           | Highest near-term confidence because no weaker runtime enters the trusted boundary      | **Choose now**                                                                        |
| 2. Native `libextism` through Deno FFI              | Potentially: native Extism/Wasmtime exposes fuel, resource limits, and cancellation handles                               | High; bindings, unsafe/native boundary, shared libraries, checksums, platform packaging, compiled-artifact testing, upgrades, and optional-load degradation | Potentially strong, but unproven in Praxrr until a separate cross-platform spike passes | **Create a prerequisite follow-up; do not absorb into #262 without explicit rescope** |
| 3. Native Deno Worker + QuickJS or another fallback | Not automatically; a worker bounds wall time, while the chosen engine must separately prove instruction and memory limits | Medium to very high depending on engine and packaging                                                                                                       | Unknown; QuickJS is a JavaScript guest runtime, not a drop-in Extism/WASM backend       | **Run a backend-selection investigation after requirements are frozen**               |

## Why Option 1 Is the Scope-Faithful Outcome

Issue #262 is both an implementation task and a go/no-go gate. Its wording makes
the executor conditional on the spike: the foundation exists precisely so an
unsuitable runtime can be rejected without contract or pipeline churn. The
correct response to a failed mandatory gate is therefore to stop before
dependency and runtime integration, not to reinterpret the acceptance criteria
until the preferred SDK passes.

Option 1 preserves every valuable Phase-1 invariant:

- `PLUGINS_ENABLED` remains default OFF and disabled startup remains a hard
  no-op;
- `UnavailablePluginExecutor` remains the only selected executor;
- no Extism type or runtime behavior leaks into the frozen shared contract,
  host, registry, or validator;
- no production observe call-site is introduced;
- no release artifact acquires an unproven runtime or native dependency;
- later phases remain blocked instead of building persistence, API, SDK, or UI
  around a runtime that does not satisfy its sandbox contract.

The evidence-only result is still substantive completion of the spike portion of issue #262. It
is not evidence that the executor acceptance criteria are complete. The

PR, issue status, and roadmap must say exactly that. If project policy requires
every acceptance checkbox to pass before closing an issue, revise #262 into a
completed spike decision and move compliant-runtime delivery into a new
prerequisite issue. If the issue is left open, link the new prerequisite and
make the blocker explicit.

## Risk Assessment

### Option 2: Native `libextism` FFI

Native Extism is the closest technical match to the original intent. Its Rust
runtime and C ABI expose the facilities that the JS SDK lacks, including
fuel-limited construction, fuel accounting, cancellation handles, and
Wasmtime-backed resource control. It could implement the existing JSON-only
executor seam without changing plugin manifests or host contracts.

It is nevertheless a different product and release commitment from adding an npm
module. Before approval, a dedicated prerequisite issue should require a small
native-runtime spike that proves all of the following:

1. A narrow, reviewed Deno FFI binding covers construction, invocation,
   error/result ownership, cancellation, and deterministic cleanup without
   leaking native pointers or Extism types past the executor module.
2. Fuel exhaustion occurs before the outer host timeout and is distinguishable
   from a generic trap.
3. The configured resource limiter caps guest-owned linear memory, including
   memory growth paths, rather than only Extism exchange buffers.
4. An already-aborted signal prevents execution, and an in-flight abort invokes
   the native cancellation handle, settles promptly, and releases every native
   resource.
5. Linux and Windows artifacts used by Praxrr are pinned, checksum-verified,
   provenance/licensing-reviewed, and exercised in the actual `deno compile`
   output. Add macOS and architecture variants wherever the release matrix
   claims support.
6. An absent, incompatible, or unloadable shared library leaves
   `UnavailablePluginExecutor` selected and never aborts application startup.
7. The required `--allow-ffi` scope and shared-library lookup rules are
   explicit. No dynamic search through plugin-controlled directories is allowed.
8. Native crashes and ABI mismatches are assessed as process-level risks. If
   they cannot be contained in process, evaluate a supervised sidecar/worker
   process rather than assuming per-plugin `try/catch` is sufficient.

Only after this spike passes should the implementation add protocol codecs, path
confinement, deterministic WASM fixtures, runtime selection, or artifact
caching. Start with a fresh runtime instance per invocation; cache only
immutable compiled artifacts, bounded and keyed by runtime behavior version, API
version, normalized plugin id, plugin version, canonical entry, and artifact
digest.

#### Native FFI risks

- **Release expansion:** every supported OS/architecture becomes part of the
  runtime security and support matrix.
- **Process safety:** malformed FFI ownership or a native runtime fault can
  bypass JavaScript exceptions and terminate Praxrr.
- **Supply chain:** shared libraries require pinned versions, checksums,
  provenance, licenses, and an update policy independent of `deno.lock`.
- **Permission expansion:** `--allow-ffi` enlarges host authority even though it
  does not directly grant the guest I/O.
- **Compiled packaging:** finding and loading the correct library from a
  compiled binary is a release concern, not merely a development-test concern.
- **Maintenance concentration:** a custom binding becomes security-critical code
  that must track C ABI and runtime changes.

These risks do not rule out native Extism, but they make it unsuitable as an
unplanned implementation detail inside the current JS-SDK issue.

### Option 3: Deno Worker + QuickJS or Another Backend

Treat this as a backend-selection problem, not as a presumed solution. A Deno
Worker supplies termination and can narrow Deno permissions, but it does not add
deterministic instruction metering or retrofit maximums onto arbitrary
guest-defined WebAssembly memories. QuickJS runs JavaScript guests; it does not
execute the current Extism PDK/WASM artifact contract without another runtime or
a deliberate change to what a Praxrr plugin is.

A fallback investigation should compare at least these backend classes against
the frozen host seam:

- a maintained Wasmtime/libextism native binding;
- a separately supervised native runtime process with a bounded IPC protocol;
- a pure-JavaScript WebAssembly engine or interpreter that demonstrably supports
  fuel and total memory limits;
- ahead-of-time Wasm instrumentation/rewrite with a verifier, only if its
  proposal coverage and trusted computing base are acceptable;
- QuickJS only if the project intentionally changes the guest language/runtime
  while preserving the manifest's closed `'wasm'` contract or versions that
  contract explicitly.

The comparison must use adversarial fixtures, not API names. Every candidate
must prove timeout, caller cancellation, fuel exhaustion, guest-memory
exhaustion, no network, no filesystem, post-failure healthy execution,
optional-runtime boot degradation, and compatibility with distributed compiled
artifacts.

#### Fallback risks

- **Contract mismatch:** calling a QuickJS implementation a WASM executor could
  make the shipped manifest contract misleading.
- **False isolation:** a promise race or worker termination limits caller
  latency but is not fuel accounting.
- **Instrumentation bypass:** Wasm rewriting must cover imported and defined
  memories, multi-memory and evolving proposals, linked modules, and all
  control-flow paths.
- **Engine maturity:** a small or pure-JS engine may trade deployment simplicity
  for performance, compatibility, or a larger unreviewed parser/interpreter
  surface.
- **Scope drift:** choosing a new guest ecosystem can pull SDK, packaging,
  authoring, and compatibility work from #265 into the runtime decision.

## Implementation Recommendations

### Recommended Deliverable for the Current PR

Keep the PR small, reviewable, and explicit:

1. Append a dated NO-GO result to
   `docs/plans/35-wasm-plugin-system/phase-1-foundation.md` containing: Deno
   `2.9.1`, Linux x86_64, exact SDK `2.0.0-rc13`, npm/JSR findings, the
   `execArgv: []` workaround, trivial execution result, observed worker timeout,
   failed direct cancellation behavior, guest-memory growth beyond `maxPages`,
   absence of fuel, and denied HTTP/WASI observations.
2. Update `docs/architecture/plugins.md` to correct the statement that
   `with_memory_max`/`with_fuel_limit` are available through the Deno JS SDK.
   State that those facilities belong to native Extism and that the runtime seam
   remains intentionally unimplemented.
3. Update `ROADMAP.md` to show Phase 1 shipped, the #262 JS-SDK spike completed
   as NO-GO, and compliant runtime implementation still deferred/blocked on a
   new selection or native-runtime prerequisite.
4. Link the follow-up runtime-selection/native-FFI issue from #262 and #267.
   Keep #263-#266 blocked; they are siblings under #267, not children to
   implement in this PR.
5. Do not add `@extism/extism`, regenerate `deno.lock`, add production code,
   vendor WASM binaries, change the frozen seam, or add a production call-site.

The spike commands and raw temporary fixtures may be summarized in committed
documentation, but temporary downloads and local SDK clones should not enter the
repository. Source links, exact versions, observed values, and enough commands
to reproduce the decision are the durable artifact.

## Review and Validation Gates

Because the recommended change is documentation-only, review should focus on
fidelity rather than creating runtime-shaped tests for code that is
intentionally absent.

Required review assertions:

- no source, dependency, or lockfile change introduces Extism or another
  runtime;
- `UnavailablePluginExecutor` and the frozen executor request/result types are
  unchanged;
- no production sync, compile, parser, notification, import/export, API,
  persistence, or UI path changed;
- the design and roadmap do not call Phase 2 shipped or imply that later phases
  are unblocked;
- claims distinguish Extism JS SDK behavior from native Extism/Wasmtime
  behavior;
- `maxPages` is described as an exchange-memory limit, not a total guest-memory
  ceiling;
- worker timeout is not described as fuel or direct `AbortSignal` cancellation;
- the Deno workaround, prerelease pin, and unpublished JSR status are recorded
  as observed facts;
- issue #267's dependency ordering and sibling scope remain intact.

Run the repository's normal documentation/format checks applicable to the
touched Markdown files, plus `git diff --check`. Full runtime tests cannot prove
a runtime that was deliberately not added; the PR should state that
`deno task test plugins` remains the unchanged Phase-1 baseline rather than
evidence for a real executor.

## Follow-Up Issue Recommendation

Create one prerequisite issue titled along the lines of **WASM Plugin Runtime
Selection — native Extism FFI and bounded-backend spike**. Its decision output
should be a GO/NO-GO matrix across supported release platforms, not an executor
implementation assumed in advance.

The issue should freeze these non-negotiable gates before evaluating candidates:

- finite positive backend timeout strictly inside the host's outer timeout;
- active cancellation honoring `PluginExecutionRequest.signal` and proven
  cleanup;
- deterministic instruction/fuel limit;
- total guest linear-memory limit;
- no guest network, filesystem, environment, subprocess, database, credential,
  or host-object authority;
- a fixed JSON ABI behind the unchanged `PluginExecutor` seam;
- optional-subsystem degradation on missing or unhealthy runtime;
- successful execution after every timeout, cancellation, trap, memory, fuel,
  and forbidden-I/O failure;
- real Linux and Windows compiled-artifact evidence, plus every other advertised
  release target;
- bounded, sanitized diagnostics that never log input, output, paths, URLs,
  guest strings, or raw runtime errors.

If no candidate passes, keep the foundation dormant. That is an intentional and
safe state, not technical debt requiring a weaker executor.

## Final Decision

**Choose Option 1 now.** The JS SDK spike has served its purpose by falsifying
the original assumption that the Deno package exposed the same finite resource
controls as native Extism. Preserve the Phase-1 foundation, merge the evidence
and corrected documentation, and require a separately approved backend
selection/native-runtime spike before any real executor is implemented.

Do not relax fuel, total guest-memory, or active-cancellation requirements
merely to make `@extism/extism` fit. If the project later decides that plugins
are trusted local code and a wall-clock-only preview is acceptable, that is a
product/security-policy change requiring an explicitly revised issue and honest
threat model—not an implementation interpretation of #262.

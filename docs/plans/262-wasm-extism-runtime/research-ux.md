# UX Research: Extism Runtime Operator and Developer Experience

## Executive Summary

Issue [#262](https://github.com/yandy-r/praxrr/issues/262) has no end-user UI,
management API, or production plugin call-site. Its user experience is therefore
the quality of its operational states, logs, failure isolation, and maintainer
test workflow. The runtime should make five conditions unambiguous without
changing core application availability:

1. plugins are intentionally disabled;
2. plugins are enabled but the runtime cannot be selected;
3. the runtime is ready but no valid plugin can execute;
4. one plugin invocation was contained by a sandbox limit or failed validation;
   and
5. a plugin invocation completed successfully.

The application must remain available in the first four conditions. That is not
the same as hiding the condition: startup should emit one authoritative
availability event, while per-invocation events should identify the plugin,
extension point, bounded outcome class, and duration without logging the input,
output, WASM bytes, raw guest error text, host paths, URLs, or secrets.

The Deno/Extism spike should be a reproducible evidence exercise, not an
informal “hello world.” Record the exact Deno and Extism versions, platform,
minimum permissions, limit values, observed result, elapsed time, and whether
the caller remained responsive for every positive and negative fixture. Do not
accept `deno run -A` as proof of production viability: Extism's JS SDK README
uses `-A` for its example, while Deno explicitly warns that `--allow-all`
disables its permission sandbox. The spike must discover and document the narrow
permission set actually required.

## Scope and Experience Boundary

This research covers only issue #262: the executor and viability spike behind
the frozen `PluginExecutor` seam. Issues #263-#266 are sibling phases and remain
out of scope. In particular, this issue should not introduce:

- a plugin status page, settings controls, runtime health endpoint, or
  management API;
- production observe-point wiring;
- durable plugin execution history, retries, quarantine controls, or
  notifications;
- an author-facing SDK, packaging workflow, or marketplace terminology; or
- operator-facing promises based on the test fixture.

The direct audiences in this phase are:

- **Operator:** needs Praxrr to boot normally when plugins are off or the
  optional runtime is unhealthy, and needs logs to explain any opted-in
  degradation.
- **Maintainer/reviewer:** needs deterministic evidence that limits,
  cancellation, forbidden I/O, output validation, and per-plugin isolation work
  under Deno.
- **Future plugin author:** indirectly benefits from stable, classified failure
  behavior, but authoring documentation belongs to #265.

## User Workflows

### Feedback and State Design

#### State Model and Recommended Communication

The existing foundation already supplies the correct high-level semantics:
disabled is a hard no-op, missing plugin storage degrades to an empty registry,
runtime unavailability is typed, and dispatch failures are swallowed per plugin.
Issue #262 should preserve those meanings and make runtime selection observable.

| State                 | Meaning                                                                                                          | Startup communication                                                              | Invocation communication                                                                         | Recovery                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `disabled`            | `PLUGINS_ENABLED` is false; no runtime or plugin should load                                                     | One `info` event with `enabled:false`                                              | None; there should be no dispatch                                                                | Set `PLUGINS_ENABLED=true` only when intentionally testing plugins, then restart                       |
| `enabled_ready`       | Extism constructed and the real executor was selected                                                            | One `info` event with runtime name/version and finite limit profile                | `debug` success event when useful for spike/tests                                                | None                                                                                                   |
| `enabled_unavailable` | Runtime import, construction, worker startup, or viability check failed; unavailable executor remains selected   | One `warn` event with safe reason code and recovery hint; boot continues           | Existing typed unavailability may remain `debug` per skipped dispatch to avoid repeated warnings | Correct runtime/permission/platform problem or turn plugins off; restart and confirm the startup event |
| `empty`               | Runtime is ready, but directory is missing or no valid plugin registered                                         | Existing missing-dir warning or initialized summary with zero registered           | None                                                                                             | Install a valid test plugin only for the spike; this is not a core app error                           |
| `rejected`            | Manifest or registration failed before execution                                                                 | Existing bounded warning per candidate plus aggregate counts                       | None                                                                                             | Correct the listed manifest field/code or duplicate id; restart/rescan                                 |
| `execution_failed`    | One registered plugin trapped, exceeded a limit, attempted denied I/O, returned invalid output, or was cancelled | Runtime remains ready; do not downgrade the whole subsystem from one guest failure | One `warn` event with classified outcome and safe correlation fields                             | Fix/replace that plugin; do not raise limits as the first response                                     |
| `success`             | A call returned a valid `PluginJsonValue` within every limit                                                     | No extra startup claim                                                             | Optional `debug` event with duration and result byte count, never result content                 | None                                                                                                   |

Two distinctions are especially important:

- **Disabled is not unavailable.** Disabled is deliberate and should not
  generate warning noise. Enabled but unable to construct the configured runtime
  is actionable degradation and merits exactly one clear startup warning.
- **Runtime unavailable is not plugin failure.** Runtime selection failure
  affects every plugin and should be reported once at initialization. A timeout,
  fuel exhaustion, trap, or bad output belongs to one invocation and must not
  imply that Extism or Praxrr is globally unhealthy.

No production call-site exists in #262, so an `enabled_ready` startup event must
not imply “plugins are active in sync.” Prefer wording such as **Plugin runtime
ready for injected/test execution** in design and test evidence, or a neutral
structured event such as **Plugin runtime initialized** in code.

## Logging and Error Observability

### Event shape

Use stable structured metadata rather than requiring operators to parse Extism
prose. Recommended safe fields are:

| Field                                             | Purpose                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `enabled`                                         | Separates intentional opt-out from degradation                     |
| `runtime`                                         | Stable identifier such as `extism-js`, not a package object        |
| `runtimeVersion`                                  | Dependency version when reliably available; omit rather than guess |
| `pluginId`, `pluginVersion`, `apiVersion`         | Correlates a failure without exposing plugin payloads              |
| `point`                                           | Identifies the frozen extension-point contract used                |
| `outcome`                                         | Stable bounded class listed below                                  |
| `durationMs`                                      | Shows whether cancellation and finite deadlines behaved            |
| `timeoutMs`, `memoryMaxPages`, `fuelLimit`        | Confirms the applied finite policy; safe numeric values            |
| `errorClass`                                      | Host-owned typed category, not raw guest/SDK prose                 |
| `workerTerminated` or equivalent verified boolean | Useful only if the SDK exposes enough evidence to make this claim  |

Recommended bounded outcomes:

```text
success
runtime_unavailable
cancelled
timeout
fuel_exhausted
memory_limit
forbidden_host
forbidden_path
missing_export
trap
invalid_output
internal
```

Only emit a specific outcome when the SDK provides reliable evidence. If Extism
collapses multiple resource failures into one trap/error shape, report `trap` or
`internal` and preserve precise diagnosis in test assertions; do not infer
`memory_limit` or `fuel_exhausted` from elapsed time or message fragments.
Classification should be centralized at the executor boundary so host code never
learns Extism types.

### Severity and repetition

- `info`: deliberate disabled state; successful enabled initialization summary.
- `warn`: enabled runtime could not initialize; candidate was rejected; one
  plugin execution failed.
- `debug`: expected per-dispatch unavailable skip after the authoritative
  startup warning; successful spike/test invocation details.
- `error`: reserve for failures that escape the optional-subsystem boundary or
  invalidate the claimed host invariant. Ordinary guest traps and limit
  enforcement are not application errors.

The initialization summary is the authoritative answer to “is the optional
runtime usable?” Avoid logging the same runtime-construction stack for every
registered plugin. Conversely, do not reduce all invocation failures to a
generic “observe dispatch failed”; the bounded outcome is what tells a
maintainer whether the sandbox worked as intended.

### Secret and privacy boundary

Praxrr's logger sanitizes secret-shaped metadata keys and several common
embedded credential formats, but that sanitizer is defense-in-depth, not
permission to log untrusted guest material. A guest can encode a secret under an
innocuous key or in arbitrary text that the heuristic cannot recognize.

Never log:

- request `input` or returned plugin output;
- raw WASM bytes, manifest config values, host-function arguments, or guest
  stdout/stderr;
- raw Extism/Wasmtime error messages if they may embed guest strings, URLs,
  paths, or payload fragments;
- full `sourceDir`, WASM path, allowed/denied URL, query string, or filesystem
  target;
- an `Error` object or stack received from the guest/SDK as structured metadata;
  or
- environment values, Deno permission-audit values, or authorization headers.

If a raw SDK error is required during local spike diagnosis, gate it to a
consciously enabled local debug path, sanitize it before output, and do not make
it the normal application event. Prefer an opaque local correlation id plus the
stable `outcome`. Plugin ids and versions are user-controlled too: keep them as
separate sanitized metadata fields and do not interpolate them into large
free-form messages.

Deno's permission audit can be useful during the spike, but its records include
the permission value (such as a path, host, or environment variable name). Store
any JSONL artifact outside committed test fixtures, inspect it locally, and
summarize only the minimal permission conclusion in the design doc.

## Actionable Failure States

Every failure state should answer: what remained safe, what failed, and what to
do next.

| Outcome               | Operator/maintainer meaning                                                  | Action                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime_unavailable` | Praxrr stayed online; no WASM call ran                                       | Confirm Deno/Extism versions and required worker/import permissions. If plugins are not intended, disable the flag. Otherwise fix the runtime and restart. |
| `cancelled`           | Caller aborted before completion and the guest was contained                 | Reproduce with the cancellation fixture. Verify prompt settlement and worker cleanup; do not automatically retry.                                          |
| `timeout`             | Wall-clock budget was reached                                                | Inspect the plugin for an infinite/slow path. Keep the finite limit; only tune it with measured evidence.                                                  |
| `fuel_exhausted`      | Instruction budget was consumed                                              | Fix unbounded computation or loops. Do not retry the identical input automatically.                                                                        |
| `memory_limit`        | Guest could not grow within the configured page limit                        | Reduce guest allocation or input size; verify the app and next plugin call still work.                                                                     |
| `forbidden_host`      | The network-denial control rejected guest access                             | Treat as successful containment. Remove the plugin if access was unexpected; do not add a host allowlist in #262.                                          |
| `forbidden_path`      | Filesystem access was unavailable                                            | Treat as successful containment. Keep allowed paths absent; do not expose a path to make the fixture pass.                                                 |
| `missing_export`      | Module and requested point do not match                                      | Correct the fixture/plugin export contract; no runtime tuning needed.                                                                                      |
| `trap`                | Guest execution faulted safely but the host cannot classify it more narrowly | Reproduce with the same fixture and versions; inspect sanitized local diagnostics.                                                                         |
| `invalid_output`      | Bytes were returned but did not satisfy `PluginJsonValue`                    | Fix serialization and preserve fail-closed rejection; never coerce malformed output into success.                                                          |
| `internal`            | Host/SDK failure did not match a guest outcome                               | Capture versions and safe correlation fields, restart once, and use the unchanged unavailable executor if initialization remains unhealthy.                |

The recovery text should not suggest broadening `allowed_hosts`, adding an
`allowed_path`, enabling WASI, using `-A`, or raising every limit. Those actions
would make the symptom disappear by weakening the acceptance criteria.

## Deno/Extism Spike Workflow

### Evidence header

Record the following at the top of the spike result:

```text
date (UTC)
commit SHA
OS and architecture
deno --version
resolved @extism/extism version and lockfile state
exact command/task and permission flags
timeoutMs, memoryMaxPages, fuelLimit
useWasi value
allowedHosts shape
allowedPaths shape
```

Extism's manifest documentation has an important asymmetric default: an empty
`allowed_hosts` denies hosts, while `null` allows all; for `allowed_paths`,
empty or `null` grants no file access. Do not rely on “omitted probably means
denied” in the spike. Construct and assert the intended values explicitly, keep
WASI disabled unless a negative fixture specifically proves its denial behavior,
and verify the installed SDK's actual TypeScript API rather than copying builder
names from another language SDK.

### Test matrix

Run each case independently and then run a post-failure healthy invocation to
prove that isolation did not poison the host or executor:

| Fixture                             | Expected evidence                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Valid trivial plugin                | Returns the exact valid JSON value; finite elapsed time; no unexpected permission request                           |
| Hung/infinite plugin                | Settles within a bounded tolerance after timeout; caller remains responsive; subsequent healthy call succeeds       |
| Caller cancellation before deadline | `req.signal` causes prompt rejection/termination distinct from wall-clock timeout where the SDK permits distinction |
| Fuel burner                         | Finite fuel is actually enforced; failure is isolated; next call succeeds                                           |
| Memory grower                       | Memory maximum is enforced; process remains available; next call succeeds                                           |
| Network attempt                     | Access fails with explicit empty allowed-host configuration; no request reaches a controlled local listener         |
| Filesystem attempt                  | Access fails with no allowed paths and no WASI capability; controlled sentinel file is unchanged/unread             |
| Missing export or guest trap        | Typed execution failure; no raw guest data in normal logs                                                           |
| Non-JSON/unsupported JSON output    | Executor rejects; no coercion or cache entry                                                                        |
| Runtime construction failure        | Host retains unavailable executor, logs one classified startup warning, and application startup continues           |

Measure completion with a monotonic clock and assert a tolerance, not an exact
millisecond value. A timeout test that merely observes a rejected promise is
insufficient: the spike must also prove cancellation or worker termination
prevents continued guest work. If the SDK cannot provide that proof under Deno,
record a no-go or an explicit unresolved gate rather than describing
`Promise.race` as sandbox cancellation. The existing host race protects caller
latency, but by itself it does not stop underlying guest CPU or memory
consumption.

### Permission workflow

1. Begin with the narrow repo test task and no new broad permissions.
2. Capture each denied permission request locally. Deno can emit permission
   audit records and optional stacks; use that only for diagnosis because values
   can reveal paths/hosts.
3. Add the minimum scoped permission needed for the SDK/runtime itself, one
   category at a time.
4. Explicitly deny guest-facing network, write, environment, subprocess, and FFI
   capabilities wherever the task model permits.
5. Re-run forbidden-I/O fixtures after every permission change. Host permission
   needed to load a local fixture must not become guest filesystem capability.
6. Reject any production path that requires `--allow-all`. Deno documents that
   it disables the sandbox, and its untrusted-code guidance recommends multiple
   layers, reduced-permission workers, and OS sandboxing.

The Extism JS SDK supports Deno and uses the JavaScript runtime's built-in
WebAssembly rather than a native FFI library, which is a favorable starting
point. Still, its published example uses `deno run -A`; that is an example
convenience, not an acceptable Praxrr deployment requirement.

### Manual review checklist

- [ ] App boots normally with plugins disabled and performs no
      plugin-directory/runtime work.
- [ ] App boots normally with plugins enabled and forced runtime initialization
      failure.
- [ ] Startup log distinguishes disabled, ready, unavailable, and empty
      registry.
- [ ] Each negative fixture yields the expected bounded outcome and no raw
      input/output/path/URL.
- [ ] Caller cancellation and runtime timeout both settle within the recorded
      bound.
- [ ] A post-failure healthy fixture succeeds after timeout, fuel, memory, trap,
      and forbidden-I/O cases.
- [ ] Network listener receives no connection and filesystem sentinel remains
      unchanged.
- [ ] Test command uses the documented minimum permissions, not `-A`.
- [ ] `deno task test plugins` and `deno task check` pass with
      generated/lockfile changes included.
- [ ] Spike result states **go**, **no-go**, or **unresolved** and names the
      exact blocking observation.

## Patterns from Comparable Plugin and Sandbox Systems

Three primary-source patterns are applicable without copying their product
surfaces:

1. **Make failure policy explicit.** Envoy's Proxy-Wasm contract explicitly
   distinguishes fail-open from fail-closed behavior for fatal VM/plugin errors.
   Praxrr's observe-only plugin path is intentionally fail-open for the caller:
   bypass the failed observer and continue. That policy should be documented and
   tested, not left as an accidental consequence of `catch`.
2. **Bound execution, surface terminal status, preserve the host.** Nomad plugin
   guidance requires bounded operations, terminal errors, and cleanup while
   keeping unrelated agent work available. Praxrr should similarly emit one
   terminal invocation outcome and prove a subsequent plugin can run; it should
   not automatically retry a deterministic sandbox violation.
3. **Treat resource exhaustion as a guest trap, not host death.** Wasmtime's
   fuel model traps when fuel runs out. Praxrr should translate any reliably
   detected fuel exhaustion to a host-owned outcome while keeping the
   Extism/Wasmtime error type and text inside the executor boundary.

These systems also illustrate why “the core service is still running” is not
enough observability. A contained failure needs a stable status, bounded
diagnostics, and an explicit recovery path. Conversely, guest stdout/stderr and
arbitrary error text are unsafe as the primary operator contract; Nomad warns
that plugin output can contain sensitive information, reinforcing Praxrr's need
to classify rather than relay.

## Recommendations

### Must

- Preserve the disabled hard no-op and optional-subsystem startup degradation.
- Emit one authoritative, sanitized startup state distinguishing disabled,
  ready, unavailable, and empty.
- Keep runtime-wide availability separate from per-plugin execution outcomes.
- Centralize stable outcome classification inside the executor; do not leak
  Extism types into the host.
- Record safe correlation, applied finite limits, and duration; never log
  request/output or raw guest/SDK content in normal application logs.
- Run the full positive/negative spike matrix with a post-failure healthy call
  after every containment case.
- Prove actual guest cancellation/termination, not merely bounded caller
  waiting.
- Determine and document minimum Deno permissions; treat a requirement for
  `--allow-all` as a no-go.
- Make empty denied host access explicit and ensure `null` cannot accidentally
  mean allow-all.
- Leave UI, API, persistence, production call-sites, retries, and authoring
  workflows to their sibling issues.

### Should

- Use a bounded outcome enum and structured numeric limit fields so tests can
  assert logs without matching unstable SDK prose.
- Log runtime initialization failure once at `warn`, while keeping repeated
  expected dispatch skips at `debug`.
- Include exact version/platform/permission evidence in the design doc's
  go/no-go result.
- Test that forbidden network traffic never reaches a controlled listener and
  forbidden filesystem access never changes a sentinel, rather than accepting an
  error string as sole proof.
- Keep limit guidance conservative: fix deterministic guest behavior before
  tuning resource budgets.

### Nice (future phases, not #262)

- A management API exposing runtime/plugin state with the same bounded outcomes
  (#264).
- A UI distinguishing disabled, unavailable, rejected, and failed plugins with
  recovery copy (#266).
- Author documentation mapping stable outcomes to debugging steps and a
  supported local runner (#265).
- Durable rate-limited execution history or quarantine policy after real
  production call-sites exist (#263 and later design).

## Open Questions for Design and Spike

1. Can the installed JS SDK reliably distinguish timeout, explicit `AbortSignal`
   cancellation, fuel exhaustion, memory exhaustion, and a generic guest trap
   under Deno, or must some map to `trap`?
2. Does timeout/cancellation terminate the Web Worker and guest computation, and
   what observable evidence proves cleanup rather than only promise rejection?
3. What minimum Deno permissions does the SDK's worker path require in this
   repository's test and compiled binary contexts?
4. Is a plugin instantiated per call, per registered plugin, or cached, and how
   is poisoned/stateful runtime state discarded after a trap or cancellation?
5. Which export name maps the frozen extension-point id to a guest function
   without changing the seam?
6. How is runtime version obtained safely and deterministically, especially in
   compiled artifacts?
7. What tolerance around the finite timeout is reliable across supported CI
   platforms without weakening the caller-latency guarantee?
8. If the SDK cannot enforce fuel in its pure-JS/Deno runtime, is that an Extism
   no-go under #262's explicit acceptance criteria?

## Sources

- [Extism JS SDK README](https://github.com/extism/js-sdk) — Deno support,
  built-in WebAssembly runtime, package usage, and the upstream `deno run -A`
  example.
- [Extism Manifest](https://extism.org/docs/concepts/manifest/) — memory pages,
  allowed-host semantics, allowed-path semantics, and manifest configuration.
- [Deno security and permissions](https://docs.deno.com/runtime/fundamentals/security/)
  — no ambient I/O, `--allow-all` risk, same-privilege worker caveats, and
  layered guidance for untrusted code.
- [Deno permission reference](https://docs.deno.com/runtime/reference/permissions/)
  — deny precedence, permission audit records, dynamic worker/import
  permissions, and scoped categories.
- [Envoy Proxy-Wasm API](https://www.envoyproxy.io/docs/envoy/latest/api-v3/extensions/wasm/v3/wasm.proto.html)
  — explicit plugin failure policy and fatal VM states.
- [Wasmtime Store API](https://docs.wasmtime.dev/api/wasmtime/struct.Store.html)
  — fuel exhaustion traps and interruption behavior.
- [Nomad host-volume plugin guidance](https://developer.hashicorp.com/nomad/plugins/author/host-volume)
  — bounded operations, failure cleanup, startup degradation, retry behavior,
  and sensitive plugin output.

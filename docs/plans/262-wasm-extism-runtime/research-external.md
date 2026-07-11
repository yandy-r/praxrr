# Issue #262 external API research — Extism JS SDK on Deno

**Researched:** 2026-07-11

**Spike runtime:** Deno 2.9.1, V8 14.9.207.2, TypeScript 6.0.3, Linux x86_64

**SDK tested:** `npm:@extism/extism@2.0.0-rc13` (published 2025-05-14; current
npm `latest` and current repository tag at research time)

## Executive Summary

**No-go for `@extism/extism` as the issue #262 executor under the acceptance
criteria as written.** The JS SDK can execute Extism PDK modules on Deno and its
worker timeout works after a Deno-specific workaround. It can deny Extism HTTP
and omit WASI. However, it cannot enforce two required resource invariants and
does not directly honor `PluginExecutionRequest.signal`:

| Requirement                   | Result with JS SDK 2.0.0-rc13  | Evidence / consequence                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deno load + trivial call      | **Go with workaround**         | `npm:` import and `count_vowels` call succeed. `runInWorker: true` fails unless `nodeWorkerArgs: { execArgv: [] }` overrides the SDK's Node-only default flag.                                                                                                                                                      |
| Finite timeout                | **Go**                         | `timeoutMs` requires `runInWorker: true`; a non-terminating guest rejected in about 318 ms for a 250 ms limit with `EXTISM: call canceled due to timeout`. The SDK terminates and recreates its worker.                                                                                                             |
| `AbortSignal` cancellation    | **No-go as a direct contract** | `Plugin.call` has no signal/cancel argument. Calling `plugin.close()` from an abort listener terminated the worker but left the active `call()` promise unsettled beyond a 2 s guard. The host's existing `Promise.race` protects its caller, but does not prove prompt executor cancellation.                      |
| Finite guest memory           | **No-go**                      | `memory.maxPages` is implemented over JS SDK `CallContext` exchange blocks. A minimal guest grew its own exported linear memory from 1 to 11 pages and returned successfully with `maxPages: 2`. This is not an adversarial guest-memory ceiling.                                                                   |
| Finite fuel/instructions      | **No-go**                      | `ExtismPluginOptions`, `Manifest`, and JS SDK source expose no fuel option. The JS SDK uses the host's WebAssembly implementation rather than Wasmtime/libextism; the Web WebAssembly API has no instruction-fuel control. `with_fuel_limit` belongs to the native Rust/libextism runtime, not the JS SDK manifest. |
| No plugin network             | **Go for Extism PDK HTTP**     | `allowedHosts: []` rejected a guest HTTP call. Always pass an empty array explicitly; do not pass `null`. Load `.wasm` as host-read bytes so the SDK never receives a URL.                                                                                                                                          |
| No plugin filesystem          | **Go if WASI stays disabled**  | Use `useWasi: false` and `allowedPaths: {}`. A WASI filesystem fixture could not instantiate. `allowedPaths` only controls WASI preopens, so disabling WASI is the stronger invariant.                                                                                                                              |
| No application host functions | **Go**                         | Pass `functions: {}`. The SDK still supplies the mandatory `extism:host/env` ABI; no Praxrr capability is added.                                                                                                                                                                                                    |
| Optional-runtime degradation  | **Go by Praxrr design**        | Keep `UnavailablePluginExecutor` as default; dynamically load/probe the SDK only when plugins are enabled and catch import/probe/instantiation failures before calling `PluginHost.setExecutor`.                                                                                                                    |

This is a **partial technical go but a product/acceptance no-go**. Implementing
the JS executor and calling the above limits “finite and enforced” would
overstate the sandbox. Do not substitute wall time for fuel or host
exchange-memory limits for guest linear-memory limits.

## Primary APIs

### Extism JS SDK

- SDK repository and Deno compatibility statement:
  <https://github.com/extism/js-sdk/tree/v2.0.0-rc13>
- Exact source commit/tag tested:
  <https://github.com/extism/js-sdk/commit/bec25c60d0ad32ce06d3934563fd8560f486f323>
- npm package/version (the usable Deno import in this spike):
  <https://www.npmjs.com/package/@extism/extism/v/2.0.0-rc13>
- JSR package page (no published version resolved during the spike):
  <https://jsr.io/@extism/extism>
- `createPlugin` API:
  <https://extism.github.io/js-sdk/functions/createPlugin.html>
- `ExtismPluginOptions` (`runInWorker`, `timeoutMs`, `memory`, `allowedHosts`,
  `allowedPaths`, `functions`, `useWasi`, `nodeWorkerArgs`):
  <https://extism.github.io/js-sdk/interfaces/ExtismPluginOptions.html>
- `Manifest` API: <https://extism.github.io/js-sdk/interfaces/Manifest.html>
- Exact option validation/defaulting source:
  <https://github.com/extism/js-sdk/blob/v2.0.0-rc13/src/mod.ts>
- Exact worker timeout/termination implementation:
  <https://github.com/extism/js-sdk/blob/v2.0.0-rc13/src/background-plugin.ts>
- Exact public interfaces; there is no fuel or `AbortSignal` member:
  <https://github.com/extism/js-sdk/blob/v2.0.0-rc13/src/interfaces.ts>
- Exact `maxPages`/`maxVarBytes` JS implementation:
  <https://github.com/extism/js-sdk/blob/v2.0.0-rc13/src/call-context.ts>
- Exact HTTP allowlist implementation:
  <https://github.com/extism/js-sdk/blob/v2.0.0-rc13/src/http-context.ts>
- Upstream timeout, network, path, and memory tests:
  <https://github.com/extism/js-sdk/blob/v2.0.0-rc13/src/mod.test.ts>
- Generic Extism manifest semantics (empty hosts deny; paths only affect WASI; a
  page is 64 KiB): <https://extism.org/docs/concepts/manifest/>
- Host functions are explicit capabilities supplied by the host:
  <https://extism.org/docs/concepts/host-functions/>

### Native Extism (important API distinction)

- Rust `PluginBuilder::with_fuel_limit` is a native Wasmtime feature:
  <https://docs.rs/extism/1.30.0/extism/struct.PluginBuilder.html#method.with_fuel_limit>
- Native `Plugin::cancel_handle` and `fuel_consumed`:
  <https://docs.rs/extism/1.30.0/extism/struct.Plugin.html>
- Native C API includes `extism_plugin_new_with_fuel_limit`,
  `extism_plugin_cancel_handle`, and `extism_plugin_cancel`:
  <https://docs.rs/extism/1.30.0/extism/sdk/index.html>

Those native APIs are **not** members of `@extism/extism`. Reaching them from
Deno would require a new FFI binding and shipping compatible `libextism`
artifacts for every supported platform. That is a materially different design
and distribution commitment from the pure-JS SDK proposed by #262.

### Deno

- Deno WebAssembly API/reference:
  <https://docs.deno.com/runtime/reference/wasm/>
- Deno `node:worker_threads` compatibility; `worker.terminate()` may stop
  execution at any point: <https://docs.deno.com/api/node/worker_threads/>
- Deno security guidance: code, Wasm, dynamic imports, and workers at the same
  privilege level are not resource-limited by Deno; reduced-permission Web
  Workers are recommended for untrusted code:
  <https://docs.deno.com/runtime/fundamentals/security/>
- Deno Web Worker permissions are inherited by default and can be narrowed only
  with the Deno Web Worker `deno.permissions` option:
  <https://docs.deno.com/api/web/workers/>

The JS SDK uses `node:worker_threads`, not a caller-created Deno Web Worker. Its
public options do not expose Deno's `deno.permissions`. This is not itself guest
I/O access—the Wasm module can call only imports the SDK links—but it means
worker-level Deno permissions are not an extra sandbox layer.

## Version and import compatibility

1. The repository README advertises Deno 1.36+ and a `jsr:@extism/extism`
   import. On 2026-07-11, `deno info jsr:@extism/extism` failed with:

   ```text
   Could not find version of '@extism/extism' that matches specified version constraint '*'
   ```

2. npm's current `latest` is the prerelease `2.0.0-rc13`; pin it exactly. The
   upstream README warns that RCs may break. Do not use an unbounded `^` range
   for a security boundary.
3. Praxrr has `nodeModulesDir: "manual"` behavior in this checkout. A standalone
   `deno info
npm:@extism/extism` asked for `--node-modules-dir=auto`; adding
   the dependency to the root import map and fully regenerating
   `deno.lock`/install state must be tested in the repository's real build.
4. The npm ESM build chooses its Node compatibility bundle under Deno. Its
   default worker arguments include `--disable-warning=ExperimentalWarning`,
   which Deno 2.9.1 rejects:

   ```text
   Initiated Worker with invalid execArgv flags: --disable-warning=ExperimentalWarning
   ```

   Passing `nodeWorkerArgs: { execArgv: [] }` made the worker path execute
   successfully.

5. The latest official `count_vowels.wasm` worked. The old v0.3.0 fixture linked
   an older Extism ABI (`extism_error_set`) and did not instantiate under SDK
   2.0.0-rc13. Pin a compatible fixture or build Praxrr's fixture from pinned
   PDK sources; “any Extism plugin” is not a compatibility claim.

## Reproducible Deno spike

The commands below were run outside the repository in `/tmp` so they did not
change Praxrr. The first download is only fixture acquisition; production should
host-read the validated plugin entry and give `createPlugin` bytes, never a URL.

### Setup and successful call

```bash
mkdir -p /tmp/praxrr-extism-spike-262
curl -fsSL https://github.com/extism/plugins/releases/latest/download/count_vowels.wasm \
  -o /tmp/praxrr-extism-spike-262/count_vowels.wasm
cd /tmp/praxrr-extism-spike-262
deno eval --node-modules-dir=auto '
import createPlugin from "npm:@extism/extism@2.0.0-rc13";
const bytes = await Deno.readFile("/tmp/praxrr-extism-spike-262/count_vowels.wasm");
const plugin = await createPlugin(bytes.buffer, {
  runInWorker: true,
  nodeWorkerArgs: { execArgv: [] },
  timeoutMs: 5000,
  memory: { maxPages: 32, maxVarBytes: 65536, maxHttpResponseBytes: 65536 },
  allowedHosts: [],
  allowedPaths: {},
  functions: {},
  useWasi: false
});
try {
  console.log((await plugin.call("count_vowels", "hello world"))?.text());
} finally {
  await plugin.close();
}'
```

Observed:

```json
{ "count": 3, "total": 3, "vowels": "aeiouAEIOU" }
```

### Timeout

The official SDK repository contains the exact infinite-loop fixture used by its
own test suite.

```bash
git clone --depth 1 --branch v2.0.0-rc13 https://github.com/extism/js-sdk.git \
  /tmp/extism-js-sdk-262
cd /tmp/praxrr-extism-spike-262
deno eval --node-modules-dir=auto '
import createPlugin from "npm:@extism/extism@2.0.0-rc13";
const bytes = await Deno.readFile("/tmp/extism-js-sdk-262/wasm/loop-forever.wasm");
const plugin = await createPlugin(bytes.buffer, {
  runInWorker: true, nodeWorkerArgs: { execArgv: [] }, timeoutMs: 250,
  memory: { maxPages: 32 }, allowedHosts: [], allowedPaths: {},
  functions: {}, useWasi: false
});
const started = performance.now();
try {
  await plugin.call("loop", "hello");
} catch (error) {
  console.log(JSON.stringify({
    elapsedMs: Math.round(performance.now() - started),
    message: error.message
  }));
} finally {
  await plugin.close();
}'
```

Observed:

```json
{ "elapsedMs": 318, "message": "EXTISM: call canceled due to timeout" }
```

`timeoutMs` applies to instantiation and every call on that plugin instance. It
is not a per-call argument. On timeout, the SDK terminates and recreates the
worker and resets call context. Its source also documents a poisoned state if
termination/recreation itself does not complete within the same timeout. Praxrr
should discard that plugin instance after any timeout rather than trust reuse.

### Empty network allowlist

Using the upstream `wasm/http.wasm` fixture with `allowedHosts: []` and
`useWasi: false`:

```text
Call error: HTTP request to "https://example.com/" is not allowed
(no allowedHosts match "example.com")
```

The allowlist is checked before `fetch`. Pass `[]` explicitly. The generic
Extism manifest documentation says empty means deny while `null` means allow
all, and the JS SDK uses fallback logic where falsy values are replaced; `null`
must never cross this boundary.

### Guest memory counterexample

This minimal valid Wasm module exports one page of memory and a `grow` function
that adds ten pages. It imports nothing, so it is an adversarial check
independent of PDK behavior.

```bash
cd /tmp/praxrr-extism-spike-262
deno eval --node-modules-dir=auto '
import createPlugin from "npm:@extism/extism@2.0.0-rc13";
const bytes = new Uint8Array([
  0,97,115,109,1,0,0,0, 1,4,1,96,0,0, 3,2,1,0, 5,3,1,0,1,
  7,17,2,6,109,101,109,111,114,121,2,0,4,103,114,111,119,0,0,
  10,9,1,7,0,65,10,64,0,26,11
]);
console.log("valid=" + WebAssembly.validate(bytes));
const plugin = await createPlugin(bytes.buffer, {
  runInWorker: true, nodeWorkerArgs: { execArgv: [] }, timeoutMs: 1000,
  memory: { maxPages: 2 }, allowedHosts: [], allowedPaths: {},
  functions: {}, useWasi: false
});
try {
  await plugin.call("grow", "");
  console.log("grow succeeded despite maxPages=2");
} finally {
  await plugin.close();
}'
```

Observed:

```text
valid=true
grow succeeded despite maxPages=2
```

The source explains the result: `CallContext.alloc()` sums its JS `Block`
buffers and checks that against `maxPages`; it does not apply a maximum to each
guest `WebAssembly.Memory`. The SDK's memory fixture exercises Extism host
allocation, not arbitrary `memory.grow`. Therefore the option is useful for
host/guest message memory but is insufficient as issue #262's sandbox memory
ceiling.

### AbortSignal counterexample

An abort listener that invoked `plugin.close()` at 100 ms while
`loop-forever.wasm` was running did not settle the active `plugin.call()`
promise before a 2 s guard rejected. The SDK API has no `AbortSignal` or cancel
handle. A safe wrapper may still:

- reject immediately when `req.signal.aborted` before instantiation;
- race `plugin.call()` with `req.signal` so the Praxrr executor promise settles;
- invoke `plugin.close()` best-effort on abort;
- configure `timeoutMs` no greater than Praxrr's host deadline as the
  authoritative worker kill;
- discard the instance after abort/timeout.

That wrapper honors caller responsiveness but does **not** turn the signal into
verified prompt guest cancellation. The issue must distinguish those claims.

## Integration Patterns

The following is the narrowest safe JS-SDK shape for a prototype only. It does
not solve fuel or guest-memory limits.

```ts
const sdk = await import('@extism/extism'); // only after PLUGINS_ENABLED and inside a caught probe
const wasm = await Deno.readFile(resolvedEntryPath); // validated path; do not give SDK a path/URL
const plugin = await sdk.createPlugin(wasm.buffer, {
  runInWorker: true,
  nodeWorkerArgs: { execArgv: [] },
  timeoutMs: EXECUTOR_TIMEOUT_MS,
  memory: {
    maxPages: EXCHANGE_MEMORY_MAX_PAGES,
    maxVarBytes: VAR_MEMORY_MAX_BYTES,
    maxHttpResponseBytes: HTTP_RESPONSE_MAX_BYTES,
  },
  allowedHosts: [],
  allowedPaths: {},
  functions: {},
  useWasi: false,
});

try {
  if (req.signal.aborted) throw req.signal.reason;
  if (!(await plugin.functionExists(req.point))) {
    throw new Error(`Plugin does not export ${req.point}`);
  }
  const output = await plugin.call(req.point, JSON.stringify(req.input));
  return output === null ? null : output.json();
} finally {
  await plugin.close(); // safest initial lifecycle: one worker/instance per execution
}
```

Design constraints for that prototype:

- Keep all Extism types in `extismExecutor.ts`; the frozen executor seam remains
  unchanged.
- Resolve the manifest entry against `RegisteredPlugin.dir`, re-check
  containment after symlink resolution, read bytes in the host, and pass only
  bytes to Extism.
- Use an exact export-name convention and test it. WebAssembly export names can
  contain dots, so the simplest convention is export name equals `req.point`,
  but it must be documented for plugin authors.
- Serialize exactly one JSON input and parse exactly one JSON output. Reject
  invalid UTF-8/JSON, non-finite numbers, and values outside `PluginJsonValue`;
  do not return `PluginOutput` or `bigint`.
- Start with one instance per execution. Reuse is stateful, not reentrant, and
  requires cache/lifecycle analysis. If compiled artifacts/results are cached
  later, key by the behavior/interface version and
  `(apiVersion, plugin.version)` as required by #262; include plugin id/content
  hash to prevent two plugins with equal versions from sharing artifacts.
- Treat SDK import, capability probe, worker initialization, ABI mismatch, and
  close failure as optional-subsystem failures. Keep the host on
  `UnavailablePluginExecutor` unless the entire probe succeeds. Never make
  module evaluation or application startup depend on runtime health.
- `functions: {}` is intentional. Do not expose logging, fetch, filesystem,
  config, environment, or a generic callback. Future mediated host functions
  require explicit capability design and API-version changes.

## Viable decision paths

1. **Recommended for #262 as written: do not implement the JS executor yet.**
   Record the no-go and open a focused runtime-selection issue. The existing
   seam and unavailable default already provide correct optional degradation.
2. **Native libextism via Deno FFI:** technically offers Wasmtime guest-memory
   limiting, fuel, and a native cancel handle. It requires maintained Deno
   bindings, FFI safety review, platform-specific shared-library packaging for
   Linux/macOS/Windows, compile/release changes, and failure isolation around
   native code. This is not a small swap of the npm dependency.
3. **Relax the milestone explicitly:** ship a clearly labeled
   trusted/local-plugin preview using the JS SDK, wall timeout, exchange-memory
   limits, empty HTTP/path grants, and no WASI. Do not describe it as safe for
   arbitrary untrusted plugins and do not mark fuel or finite guest memory
   accepted.
4. **Instrument/rewrite Wasm before execution:** inject metering and cap/replace
   memories before `WebAssembly.compile`. This adds a verifier/rewriter to the
   trusted computing base and must cover multi-memory, imported memories, linked
   modules, proposals, and bypass attempts. No such component exists in the
   current plan, so this is a separate design rather than an executor detail.

## Open questions for design review

1. Is finite fuel a hard security invariant, or may a terminating worker timeout
   replace it? The issue currently requires both, so the answer defaults to
   “hard invariant.”
2. Does “memory max” mean Extism exchange memory only or all guest linear
   memories? For sandboxing untrusted plugins it must mean all guest memories;
   the JS SDK does not provide that.
3. Is Praxrr willing to ship and support `libextism` native artifacts on every
   supported platform and grant/use Deno FFI for this optional subsystem?
4. What is the canonical export ABI: one export per extension-point id, a single
   `run`, or a dispatcher envelope? The frozen host seam does not currently
   state this.
5. Must `req.signal` actively terminate the guest before `execute()` rejects, or
   is caller isolation plus a bounded executor timeout sufficient? The current
   issue says the executor must honor it, which implies active termination.
6. What exact finite limits are operationally acceptable (timeout, total guest
   pages, Extism exchange bytes, var bytes, HTTP response bytes, fuel), and are
   they global constants or future validated config? Every zero/null/falsy edge
   needs fail-closed parsing because the JS SDK uses falsy defaults.
7. Should the first implementation instantiate once per call for isolation, or
   cache instances? Reuse preserves vars/state, is non-reentrant, and
   complicates abort recovery and versioned cache safety.
8. What plugin/PDK versions are supported? The latest fixture worked while the
   documented v0.3.0 fixture did not, so compatibility must be explicit and
   tested.
9. Must the compiled Deno binaries support the SDK worker/data-URL path on Linux
   and Windows? A `deno task build` plus execution test of the compiled artifact
   is required before any go decision.

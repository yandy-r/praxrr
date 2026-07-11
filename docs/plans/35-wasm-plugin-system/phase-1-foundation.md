# WASM Plugin System — Phase-1 Foundation

**Feature-flagged, sandbox-ready executor seam.**

- **Issue:** [#35 — WASM Plugin System](https://github.com/yandy-r/praxrr/issues/35)
- **Status:** Phase 1 (foundation) — design accepted. Phase 2 (runtime) **DEFERRED** (12+ months, low priority).
- **Default state:** `PLUGINS_ENABLED=false` (OFF). The subsystem is a hard no-op unless explicitly enabled.
- **Commit convention:** internal doc — commit as `docs(internal): …`.

---

## 1. Problem Framing — why build a foundation for a _deferred_ issue?

Issue #35 is explicitly deferred: the real WASM runtime is 12+ months out, low priority, and gated on an
**unvalidated Deno-WASM integration path**. Building the runtime now would violate the repo's
"no heavy new runtime dependency" guardrail and couple the codebase to a runtime whose viability is unproven.

So why ship anything now? Because the _hard, expensive, irreversible_ decisions in a plugin system are not the
runtime — they are the **contract, the capability model, and the pipeline coupling**. Those must be right the
first time:

- A plugin surface over Praxrr is a lateral path to **every connected Arr instance's API key**. The
  credential-denial guarantee has to be structural, decided now, and impossible to misconfigure later.
- Once a live call-site lands inside the sync/compile/parser pipeline, it becomes a high-blast-radius
  dependency that is painful to remove. Getting "zero pipeline coupling" wrong is a one-way door.
- The versioned contract (`apiVersion`, closed capability/extension-point unions) is what third-party SDKs bind
  to. Changing it after plugins exist is a breaking change for the whole ecosystem.

Phase 1 therefore ships the **stable, versioned contract + lifecycle scaffolding** and nothing that executes
untrusted code:

- **No** `@extism/extism` or any WASM runtime dependency anywhere.
- **No** WASM execution — the shipped executor throws `PluginRuntimeUnavailableError('wasm runtime not yet available')`.
- **No** call-site inserted into the sync, compile, parser, or notification pipelines. The core pipeline is
  _provably_ untouched; the dispatch path is exercised only at the host seam in tests.
- **Default OFF**, in-memory only, ~12 new files + 5 small shared edits — **maximally reversible**.

The result: the design-now/build-later split recommended by the research (futurist persona) is realized as a
concrete, tested, mergeable slice that de-risks the runtime decision without taking on runtime risk.

---

## 2. Goals

1. Ship a typed `PluginManifest` schema plus a **pure, fail-fast, multi-error-accumulating** validator in
   `$shared/plugins` (client + server safe).
2. Provide a capability model that **denies credential/auth/secret/network/filesystem/DB/write access by
   construction** (closed `CapabilityId` union; forbidden ids simply do not exist), with a least-privilege
   capability↔extension-point policy.
3. Declare a typed enumeration of stable, versioned extension points; **wire only a safe observe-only subset**
   at the host dispatch seam, leaving mutating/transform points declared-but-unwired.
4. Build an **in-memory `PluginRegistry` namespaced by `apiVersion`** so an enable/disable/rollback cannot
   resurrect a plugin validated under an incompatible contract version.
5. Ship a `PluginExecutor` seam whose default `UnavailablePluginExecutor` throws a typed
   `PluginRuntimeUnavailableError`; a Phase-2 executor drops in with **zero** host/registry/validator/contract
   changes.
6. Add `PLUGINS_ENABLED` (default OFF, non-throwing) and `PLUGINS_DIR` config flags; `PluginHost` is a hard
   no-op when disabled.
7. Wire `PluginHost.initialize()` into startup with **graceful degradation** on both the disabled path and any
   scan/validation failure (never abort boot).
8. Route the plugin boundary through a **least-privilege projection + secret-redaction scrubber** so plugins
   never observe live domain objects, DB rows, or credentials.
9. Deliver unit + integration tests, this internal design doc, an architecture note, a ROADMAP entry, and
   CLAUDE.md env-var docs.
10. Evaluate Extism and specify the deferred Phase-2 execution phase + Deno-WASM go/no-go spike, keeping the
    executor seam ready.

---

## 3. Non-Goals

- **No** real Extism/WASM runtime dependency and no `@extism/extism` import anywhere — the default executor
  throws `'wasm runtime not yet available'`.
- **No** actual WASM execution in Phase 1 (or anywhere), and no per-call timeout/memory/fuel enforcement yet
  (that arrives with the real executor in Phase 2).
- **No** call-sites inserted into the sync, compile, parser, or notification pipelines — even the two wired
  observe points have **no production trigger**; the dispatch path is proven only at the host seam in tests.
- **No** plugin marketplace, remote/registry fetch, auto-update, or community hub — local `PLUGINS_DIR` scan +
  fail-fast manifest validation only (the Buildarr/Kodi over-scope trap).
- **No** plugin signing/trust/provenance/supply-chain infrastructure — the `author` field carries no trust
  semantics.
- **No** network, filesystem, database, environment, secret, credential, or auth/write/mutate capability —
  **unrepresentable** in the `CapabilityId` union, not merely flag-gated.
- **No** wiring of mutating/transform/provider points (`parser.releaseTitle.transform`,
  `customFormat.condition.evaluate`, `notification.dispatch.observe`, `importExport.adapter`) and **no** wiring
  of `sync.beforeApply.observe` (apply-critical path).
- **No** plugin HTTP/API route, UI, or management pages in Phase 1 (the 404-when-disabled route gate is
  documented for the future surface only).
- **No** DB migration / persistence — the registry is strictly in-memory, rebuilt from the manifest scan each
  boot (avoids the migration-version-collision hazard).
- **No** new exported env parser and no `PLUGINS_MAX_MANIFESTS` in Phase 1 — reuse the existing non-throwing
  `parseBooleanEnv`; defer any throwing finite-limit parser until the executor lands.
- **No** auto-creation of `PLUGINS_DIR` in `config.init()` — the host stats-and-degrades instead, so a disabled
  feature never litters an empty dir.
- **No** MCP-style version negotiation — `apiVersion` is **strict support** (reject, never coerce).

---

## 4. Capability Model — deny-by-construction, three defense layers

The single most important requirement in issue #35 is: _plugins must NOT access credentials/auth or bypass
sandboxing._ This is satisfied structurally, not by a runtime blocklist that could be misconfigured. The model
mirrors the existing `$shared/security` `CHECK_IDS` catalog, the `mcp/context.ts` projection, and the
`mcp/redact.ts` scrubber.

### Layer 1 — Type layer (the forbidden grant is unrepresentable)

`CapabilityId` is a **closed string-literal union** with a `readonly CAPABILITY_IDS` catalog. The Phase-1
grantable capabilities are all observe-only and credential-free:

```ts
export type CapabilityId =
  | 'read:resolved-profile'
  | 'read:sync-preview'
  | 'read:custom-format'
  | 'read:config-validation';
```

There is deliberately **no** capability id for credentials/API keys, auth/session/users, secrets,
network/HTTP, filesystem, database, environment, or any write/mutate/sync-apply action. Those grants are
**unrepresentable** — a manifest cannot even _name_ them. This makes "no credential access" a compile-time
structural guarantee, not a runtime check.

Each catalog entry is tagged, and a pinning test asserts every Phase-1 capability is non-mutating and
secret-free:

```ts
interface CapabilityDescriptor {
  readonly id: CapabilityId;
  readonly label: string;
  readonly description: string;
  readonly mutates: false;
  readonly touchesSecrets: false;
  readonly compatiblePoints: readonly ExtensionPointId[];
}
```

### Layer 2 — Validation layer (fail-closed + least privilege)

The pure validator rejects any capability not in `CAPABILITY_IDS` (fail-closed) **and** enforces least
privilege via `checkCapabilityGrant(point, capability)`: a plugin may request a capability only if one of its
declared extension points can legitimately consume it, else the manifest is rejected.

```ts
function checkCapabilityGrant(
  point: ExtensionPointId,
  capability: CapabilityId
): boolean;
```

`read:custom-format` is consumable by the compiled-profile observer (a compiled profile snapshot carries
custom-format assignments); it is **not** grantable to any transform point.

### Layer 3 — Runtime boundary layer (sole I/O mediator + projection + redaction)

The `PluginHost` (via `hostContext.ts`) is the **sole mediator** of all data crossing the seam. Plugins never
receive live domain objects, DB handles, config, env, or credential-bearing rows. The host:

1. Builds a **least-privilege projection** — copies only the fields a granted capability entitles
   (`mcp/context.ts` precedent), then
2. Runs the projection through a **secret scrubber** (reusing `redactSecrets` / `SECRET_KEY_PATTERN` from
   `$server/mcp/redact.ts`) as defense-in-depth, so even a projection regression cannot leak an
   `api_key`/`token`.

Inputs **and** outputs across the seam are strictly `PluginJsonValue` (structured-clone-safe). Adding a
grantable capability is a deliberate, test-guarded contract change that **bumps `PLUGIN_API_VERSION`** — never
an ambient default.

---

## 5. Extension Points — the full contract, only a subset wired

All nine points are **declared** in one `readonly EXTENSION_POINTS: readonly ExtensionPointDescriptor[]` array
(the `ALL_CHECKS` / `TOOLS` declare-all-in-one-array pattern). Only the observe-only subset is **wired** at the
host dispatch seam. Safety rests on the **absence of a wired handler**, not on a flag — a declared-but-unwired
point that is dispatched throws `PluginPointNotWiredError`.

Even the two `wired: true` points have **no production call-site** in Phase 1: dispatching them reaches only
the throwing `UnavailablePluginExecutor`, and the path is exercised solely at the host seam in tests.

| id                                | kind      | wired | mutates | requiredCapability          | purpose                                                                                                                                                                                                                                                 |
| --------------------------------- | --------- | ----- | ------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.profileCompiled.observe`  | observe   | ✅    | ❌      | `read:resolved-profile`     | Receive a redacted, structured-clone-safe snapshot of a freshly compiled quality/custom-format profile (read-only, post-compile). Wired at the host seam; **no** production call-site in Phase 1.                                                       |
| `sync.previewComputed.observe`    | observe   | ✅    | ❌      | `read:sync-preview`         | Receive a redacted sync-preview diff snapshot **after** the preview is built and **before** any apply (never mutates preview or apply). The single reference-wired live observe point; no `sync/preview/store.ts` (or any pipeline) call-site is added. |
| `config.validation.observe`       | observe   | ❌    | ❌      | `read:config-validation`    | Declared future observer of config-validation result snapshots. Not wired: registering is accepted, but `notifyObservers` throws `PluginPointNotWiredError`.                                                                                            |
| `sync.beforeApply.observe`        | observe   | ❌    | ❌      | —                           | Declared future observe-only pre-apply hook. Unwired because it runs adjacent to the mutating sync pipeline; wiring waits until the sandboxed executor + finite timeouts land.                                                                          |
| `sync.afterApply.observe`         | observe   | ❌    | ❌      | —                           | Declared future observe-only post-apply hook (audit/notification use). Unwired in Phase 1.                                                                                                                                                              |
| `parser.releaseTitle.transform`   | transform | ❌    | ✅      | — (never grantable)         | Declared future mutating point (community release-title parsers). Never wired until sandbox execution exists; transform points have **no grantable Phase-1 capability**.                                                                                |
| `customFormat.condition.evaluate` | transform | ❌    | ✅      | — (never grantable)         | Declared future compute point (custom-format condition evaluators). Unwired; requires a sandboxed, timeout-bounded executor.                                                                                                                            |
| `notification.dispatch.observe`   | provider  | ❌    | ✅      | — (needs absent net cap)    | Declared future side-effecting notification-provider point. Unwired; a provider needs a network capability that does not exist in Phase 1.                                                                                                              |
| `importExport.adapter`            | transform | ❌    | ✅      | — (needs absent fs/net cap) | Declared future side-effecting import/export adapter point. Unwired; needs fs/network capabilities that are unrepresentable in Phase 1.                                                                                                                 |

**Invariants enforced by tests:** exactly `config.profileCompiled.observe` + `sync.previewComputed.observe`
are `wired: true`, and both are `kind: 'observe'`; **no** transform/provider point is wired. Every point stamps
`PLUGIN_API_VERSION` and an independent `interfaceVersion`.

```ts
interface ExtensionPointDescriptor {
  readonly id: ExtensionPointId;
  readonly apiVersion: string; // stamps PLUGIN_API_VERSION
  readonly interfaceVersion: string; // per-point, independently versioned
  readonly kind: ExtensionPointKind; // 'observe' | 'transform' | 'provider'
  readonly wired: boolean;
  readonly mutates: boolean;
  readonly requiredCapability: CapabilityId | null;
}
```

---

## 6. Manifest Schema

A manifest lives at `<plugin-subdir>/praxrr.plugin.json`. The validator is pure and fail-fast, accumulating
**all** field errors in one pass. **Any unknown top-level key is rejected fail-closed** (no silent
passthrough).

| Field             | Type                                                                                            | Required | Validation                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apiVersion`      | `string` (member of `SUPPORTED_PLUGIN_API_VERSIONS`, Phase-1 `['1']`)                           | ✅       | **Hard reject** if not a member (strict support, no negotiation). This is the registry namespace key (parser cache-safety analog) so a rollback/toggle cannot resurrect a plugin validated under an incompatible contract.                                                                                                     |
| `id`              | `string` (reverse-dns slug `^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$`) | ✅       | Reject empty/whitespace/malformed. Case-insensitive uniqueness enforced **within** an `apiVersion` namespace (repo entity-name convention). Not trimmed on persist.                                                                                                                                                            |
| `name`            | `string`                                                                                        | ✅       | Reject empty/whitespace-only after trim; the **persisted value is not trimmed** (Portable Contract Fidelity: validate non-empty, keep as authored).                                                                                                                                                                            |
| `version`         | `string` (semver)                                                                               | ✅       | Reject empty/whitespace. The plugin's own behavior version; forms the `(apiVersion, version)` tuple used to namespace any future result cache so an upgrade cannot reuse results from a prior build.                                                                                                                           |
| `runtime`         | `'wasm'` (closed literal union)                                                                 | ✅       | Only `'wasm'` accepted in Phase 1. Reserved as a closed union so a native Deno Worker / QuickJS executor can be added later without a manifest breaking change.                                                                                                                                                                |
| `entry`           | `string` (normalized relative path to a `.wasm` module)                                         | ✅       | Must end in `.wasm`; reject absolute paths, Windows drive paths, and `..` traversal/escape shapes. **Never read or executed in Phase 1** (existence is not checked; only shape).                                                                                                                                               |
| `extensionPoints` | `readonly ExtensionPointId[]` (non-empty)                                                       | ✅       | Reject empty. Every id must be a member of `EXTENSION_POINT_IDS` (unknown ⇒ reject). Known-but-unwired ids validate fine (a plugin authored for a Phase-2 point registers but is never dispatched).                                                                                                                            |
| `capabilities`    | `readonly CapabilityId[]` (may be empty)                                                        | ✅       | Every id must be a member of `CAPABILITY_IDS`; any id outside the set (e.g. `read:credentials`, `net:http`, `fs:read`, `db:write`) is unknown ⇒ **hard reject** (fail-closed). Least-privilege: each requested capability must be consumable by at least one declared extension point via `checkCapabilityGrant`, else reject. |
| `description`     | `string`                                                                                        | ❌       | Advisory only; if present must be a string.                                                                                                                                                                                                                                                                                    |
| `author`          | `string`                                                                                        | ❌       | Attribution only, **no** trust/signing semantics; if present must be a string.                                                                                                                                                                                                                                                 |
| `engines`         | `{ praxrr?: string }` (semver range)                                                            | ❌       | Advisory host-version constraint in Phase 1 (enforced once the runtime lands). If present, `praxrr` must be a valid semver range string.                                                                                                                                                                                       |

```ts
interface PluginManifest {
  readonly apiVersion: string;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly runtime: PluginRuntime; // 'wasm'
  readonly entry: string;
  readonly extensionPoints: readonly ExtensionPointId[];
  readonly capabilities: readonly CapabilityId[];
  readonly description?: string;
  readonly author?: string;
  readonly engines?: { readonly praxrr?: string };
}

interface PluginManifestIssue {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

type ManifestValidationResult =
  | { readonly ok: true; readonly manifest: PluginManifest }
  | { readonly ok: false; readonly errors: readonly PluginManifestIssue[] };

function validatePluginManifest(raw: unknown): ManifestValidationResult;
```

---

## 7. Lifecycle States

Phase-1-reachable states plus states declared for the runtime phase:

| State        | Reachable in Phase 1 | Meaning                                                                                                                                                                         |
| ------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discovered` | ✅                   | `scan.ts` lists each immediate subdir of `PLUGINS_DIR` and reads its `praxrr.plugin.json` (the **only** `Deno.readDir`/`readTextFile` boundary in the subsystem).               |
| `validated`  | ✅                   | `validatePluginManifest(raw)` runs fail-fast, accumulating **all** field errors; on `ok:false` the plugin becomes `rejected` (skipped + logged, never throws).                  |
| `registered` | ✅                   | On `ok:true` the host calls `pluginRegistry.register(sourceDir, manifest)`; the entry is keyed by `(apiVersion, lowercased id)`; a duplicate id within a namespace is rejected. |
| `rejected`   | ✅                   | Terminal Phase-1 state for a bad/malformed manifest; recorded with its `PluginManifestIssue[]` and logged. Initialization **continues** with the remaining plugins.             |
| `activated`  | ❌ (declared)        | A Phase-2 executor is bound and the plugin can be dispatched.                                                                                                                   |
| `failed`     | ❌ (declared)        | The plugin threw/timed out at execution; the host isolates per-plugin and marks it failed.                                                                                      |
| `unloaded`   | ❌ (declared)        | The plugin is unregistered (`host.reset()` / `registry.clear()` on re-scan or shutdown).                                                                                        |

### Dispatch path (present, inert)

`host.notifyObservers(point, buildInput)` is callable **only** for wired observe points. It projects + redacts
input, calls `executor.execute` per registered plugin inside a per-plugin `try/catch` bounded by a finite
`AbortSignal` timeout, logs `PluginRuntimeUnavailableError` at `debug` (expected) and any other throw at `warn`,
and **never propagates** — so a plugin can never abort or corrupt a caller. Dispatching a declared-but-unwired
point throws `PluginPointNotWiredError`.

```
discovered ──validate──▶ validated ──ok:true──▶ registered ──▶ (Phase-2) activated ⇄ failed ──▶ unloaded
     │                       │
     └───────ok:false────────┴──────────────────▶ rejected  (skip + log, boot continues)
```

---

## 8. PluginExecutor Seam + Inert Default

A **swappable executor seam** with an **inert default** and **no dependency**. All execution routes through a
single interface over `PluginJsonValue`; no Extism/WASM type ever leaks into the host, registry, or validator,
keeping Extism vs. native Deno Worker vs. QuickJS open.

```ts
type PluginJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly PluginJsonValue[]
  | { readonly [k: string]: PluginJsonValue };

interface PluginInvocationMeta {
  readonly pluginId: string;
  readonly apiVersion: string;
  readonly point: ExtensionPointId;
}

interface PluginExecutionRequest {
  readonly plugin: RegisteredPlugin;
  readonly point: ExtensionPointId;
  readonly input: PluginJsonValue;
  readonly signal: AbortSignal;
}

interface PluginExecutor {
  execute(req: PluginExecutionRequest): Promise<PluginJsonValue>;
}

// Shipped default — inert, no runtime dependency.
class UnavailablePluginExecutor implements PluginExecutor {
  execute(_req: PluginExecutionRequest): Promise<never> {
    return Promise.reject(
      new PluginRuntimeUnavailableError('wasm runtime not yet available')
    );
  }
}
```

**Injection:** `PluginHost` receives the executor via constructor injection
(`constructor(executor: PluginExecutor = new UnavailablePluginExecutor())`) plus a
`setExecutor(executor: PluginExecutor): void` seam, so tests can supply a resolving fake and Phase 2 can drop
in an `ExtismPluginExecutor` implementing the **identical** interface with **zero** changes to
host/registry/validator/contract.

**Isolation:** the host wraps every executor call in a per-plugin `try/catch` + finite `AbortSignal` timeout
(fire-and-forget isolation) so a throw, hang, or missing runtime can never destabilize the caller — the same
graceful-degradation contract as the optional Go parser.

**Error taxonomy** (mirrors `mcp/errors.ts`, each sets `this.name`; a rejected/malformed-manifest **skip** must
never be conflated with an execution-seam **throw**):

- `PluginManifestError` (carries `readonly issues: readonly PluginManifestIssue[]`)
- `PluginValidationError`
- `PluginCapabilityDeniedError`
- `PluginPointNotWiredError`
- `PluginRuntimeUnavailableError` (thrown by the default executor)
- `PluginExecutionError`

---

## 9. Extism Evaluation + Phase-2 Deno-WASM Go/No-Go Spike

**Extism is the recommended future (Phase-2) runtime but is intentionally not added in Phase 1**, honoring the
"no heavy new runtime dependency" guardrail and the unvalidated Deno-WASM path.

### Why Extism fits

- Its `Manifest` capability model is **default-deny** and maps 1:1 to our deny-by-construction model:
  - `with_allowed_host` is an explicit HTTP allow-list (empty = no network),
  - `with_allowed_path` makes filesystem opt-in (none = no fs),
  - `with_memory_max` / `with_timeout` / `with_fuel_limit` bound resource use (finite limits, matching the
    parser "keep limits finite" convention).
- It is **language-agnostic** (Rust/Go/JS/Python/Ruby/.NET PDKs), which fits community-contributed
  release-title parsers and custom-format evaluators.

### Risk context

Research rates Extism _"production-ready but faces an existential identity challenge"_ (RedMonk). Committing
hard to one runtime is risky, so the **swappable executor seam** (Extism vs. native Deno Worker vs. QuickJS) is
the hedge, and no Extism types leak past the seam.

### Phase-2 go/no-go spike (issue #35's explicit "Deno WASM integration needs validation")

Before committing, validate on Deno that:

1. `@extism/extism` loads from npm/JSR under Deno's permission model and required flags (wasm-backed runtime /
   `--allow-ffi` / `--allow-read` as applicable);
2. plugin **timeout + cancellation** work — the JS SDK enforces timeouts by running the plugin in a Web Worker,
   so confirm that path executes and cancels under Deno; and
3. **host functions + memory/fuel limits** behave.

A **negative result costs only the `ExtismPluginExecutor` implementation, never the foundation.**

### Phase-2 sequencing

1. Land `ExtismPluginExecutor` behind the spike + finite per-call timeouts.
2. Wire the remaining observe points, **starting with `sync.previewComputed`'s real pipeline call-site**.
3. Only later — after sandbox hardening — consider the mutating parser/custom-format transform points.

Explicitly out of scope indefinitely until runtime + demand are proven: plugin marketplace, remote/auto fetch,
signing/trust, and any community hub (Buildarr/Kodi over-scope cautionary tales).

---

## 10. `apiVersion` Cache-Safety Rationale

The registry and any future result cache are namespaced by `apiVersion` (and the `(apiVersion, plugin.version)`
tuple), mirroring the parser `parser/client.ts` cache-safety discipline (which keys its cache by
`(cacheKey, parserVersion)`).

**Why it matters:** the config flag alone does not namespace anything. Without `apiVersion` namespacing, an
operator could toggle `PLUGINS_ENABLED` off/on (or roll back a release) and **silently reuse a plugin validated
under an incompatible contract version** — the exact class of bug the parser behavior-version rule exists to
prevent.

Concretely:

- `apiVersion` is treated as a **behavior version**, not merely a schema version. It is **strict-support**: a
  manifest whose `apiVersion` is outside `SUPPORTED_PLUGIN_API_VERSIONS` is **rejected, never coerced** (no
  MCP-style negotiation).
- The registry key is `(apiVersion, lowercased id)`. The **same id under two different `apiVersion`s coexist
  and are isolated**; a lookup under the wrong `apiVersion` returns `undefined`, so a rollback/upgrade cannot
  resurrect an incompatible plugin.
- `PLUGIN_API_VERSION` is declared **once** in `$shared/plugins/types.ts` and manually bumped on any contract
  change (the `SECURITY_POSTURE_ENGINE_VERSION` discipline). A pinning test asserts `PLUGIN_API_VERSION` is a
  member of `SUPPORTED_PLUGIN_API_VERSIONS` and that a manifest outside the set is rejected — guarding against
  forgetting to bump the constant.

---

## 11. Risk Register

| #   | Risk                                                                                                                                                                                                                      | Mitigation                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Credential/identity blast-radius** — Praxrr is a centralized store of Arr API keys; a plugin surface is a potential lateral path to every connected instance.                                                           | Credential access is **ungrantable by construction** (no such `CapabilityId` exists) + typed projection (`hostContext.ts`) + `redactSecrets` boundary. Never merely flag-hidden.                                                               |
| R2  | **Core-pipeline destabilization** — a wired hook running inside sync could abort/corrupt an apply if it throws or hangs.                                                                                                  | Zero pipeline call-sites in Phase 1. All execution routes through the seam (throws typed "not yet available"); only fire-and-forget observers with per-plugin `try/catch` + finite `AbortSignal` timeout.                                      |
| R3  | **Module-eval boot-brick** — Config fields are `readonly` and populated at module-eval, **before** `hooks.server.ts` try/catch exists; any parse that throws bricks boot with no degradation path.                        | `PLUGINS_ENABLED`/`PLUGINS_DIR` use the existing **non-throwing** `parseBooleanEnv` / trimmed-string helpers (invalid ⇒ OFF/default). Reserve the throwing `parsePositiveIntEnv` for genuinely load-bearing limits only — deferred to Phase 2. |
| R4  | **Env-timing trap** — unlike `PARSER_HOST/PORT` (set by `spawn.ts` before the config import), plugin env vars have no pre-import setter, so mutating `Deno.env` after `import { config }` has no effect on the singleton. | Tests flip `config.pluginsEnabled` via a `readonly`-cast + `finally`-restore (the `mcp.test.ts:570` pattern), **never** `Deno.env`. Documented explicitly for reviewers.                                                                       |
| R5  | **`apiVersion` cache-reuse** — an upgrade/rollback could reuse a plugin validated under an incompatible contract.                                                                                                         | Registry (and any future result cache) namespaced by `apiVersion` / `(apiVersion, version)`; strict-support rejection; pinning test. See §10.                                                                                                  |
| R6  | **"Wired-but-seam-throws" reviewer ambiguity** — the two `wired:true` points have no production call-site and reach only the throwing executor, which can read as "half-done."                                            | This doc + the architecture note state it explicitly: "wired" means _dispatchable at the host seam and exercised in tests_, not _triggered from the pipeline_. No production trigger is intentional.                                           |
| R7  | **Contract drift between declared and wired points** — declaring the full enum but wiring a subset invites accidental activation of unimplemented points.                                                                 | Explicit per-point `wired:boolean` typing; `notifyObservers` throws `PluginPointNotWiredError` for unwired points; tests pin the exact wired set (`config.profileCompiled.observe` + `sync.previewComputed.observe`).                          |
| R8  | **Premature heavy dependency** — adding Extism/WASM now couples the foundation to an unvalidated Deno-WASM path.                                                                                                          | Executor is an interface with a throwing default; **no** `@extism/extism` import in Phase 1. A negative Deno-WASM spike costs only the `ExtismPluginExecutor`.                                                                                 |
| R9  | **Deno-WASM viability unproven** — Extism's timeout/cancellation depends on Web Worker execution + specific Deno permissions/flags.                                                                                       | Treated as a Phase-2 **go/no-go spike gate** (§9), not an assumption.                                                                                                                                                                          |
| R10 | **WASM "existential identity" / runtime fragmentation** (RedMonk) — committing hard to one runtime is risky.                                                                                                              | Swappable executor seam; no Extism type leaks past the seam into host/registry/validator.                                                                                                                                                      |
| R11 | **Supply-chain / trust attack surface** — community plugins are untrusted code.                                                                                                                                           | Local `PLUGINS_DIR` scan + fail-fast validation only. No remote/auto-load, no signing/trust/hub in Phase 1 (Kodi-addon / n8n-supply-chain lessons).                                                                                            |
| R12 | **Maintainer over-scope** — Buildarr died from overambitious plugin/IaC scope; ~60% of OSS maintainers burn out.                                                                                                          | Minimal, single-responsibility, DRY contract within the ~500-line file cap; resist expanding beyond the declared observe-only subset. No `PLUGINS_MAX_MANIFESTS` in Phase 1.                                                                   |
| R13 | **Empty-dir litter when disabled** — auto-mkdir'ing `PLUGINS_DIR` in `config.init()` would create an empty dir every boot even when OFF.                                                                                  | Not created in `config.init()`; `PluginHost` stats the dir and degrades to an empty registry on `Deno.errors.NotFound`.                                                                                                                        |

---

## 12. Orchestrator Decisions

This design was selected from three converging proposals. All three agreed on the correct skeleton (pure
`$shared/plugins` contract mirroring `shared/security`, single `PLUGIN_API_VERSION`, closed
`CapabilityId`/`ExtensionPointId` unions, `apiVersion`-namespaced in-memory registry, `PluginExecutor` seam
whose default throws `'wasm runtime not yet available'`, `parseBooleanEnv` default-OFF like `pullOnStart`,
warn-and-continue startup wiring, no Extism dep, Extism behind a Deno-viability spike). Judgment turned on the
**two hardest guardrails**.

### Decision 1 — Winner: "Phase-1 Foundation (sandbox-ready executor seam)" (score 9/10)

It delivers the **strongest actually-built-and-tested sandbox**: three defense layers with a least-privilege
`checkCapabilityGrant` cross-check, a `{mutates, touchesSecrets}`-tagged catalog, a real projection + redaction
boundary (`hostContext.ts`) with a shipped secret-scrub test, and fail-closed rejection of unknown manifest
keys — while keeping **zero pipeline call-sites**. Runner-up (score 8) was the leanest slice but under-built
the sandbox (deny-by-union only; projection/redaction described as future, not shipped) and self-contradicted
on which points are wired. Third (score 7) had the best futureproofing framing but was the **only** proposal to
violate "zero core-pipeline coupling" by editing the high-blast-radius `sync/preview/store.ts` to add a live
call-site — buying no Phase-1 value since the executor throws anyway.

### Decision 2 — Grafts adopted into the winner

- **Per-extension-point `interfaceVersion`** and an advisory **`engines.praxrr`** host-version constraint (from
  Proposal 2) — third-party SDKs bind to an independently versioned point surface without adding runtime or
  coupling.
- **Explicit reviewer-facing documentation** of the "wired-but-seam-throws" ambiguity and the
  env-timing/boot-brick risk entries (from Proposal 1) — captured as R3, R4, R6 above.
- **Single-purpose `scan.ts`** as the sole `Deno.readDir`/`readTextFile` boundary injected into the host, so
  host logic stays pure/unit-testable (from Proposal 1).

### Decision 3 — Trims applied (avoid-and-invert)

- **Drop `PLUGINS_MAX_MANIFESTS`** and any throwing finite-limit parser from Phase 1 — keep the env surface to
  exactly `PLUGINS_ENABLED` + `PLUGINS_DIR`, both strictly non-throwing, to minimize module-eval boot risk
  while OFF. The throwing finite-limit parser lands with the executor in Phase 2.
- **Do NOT insert any live call-site** into `sync/preview/store.ts` or any pipeline module. Prove the
  dispatch → executor → per-plugin-isolation path end-to-end **only at the host seam** in tests, preserving
  zero core-pipeline coupling for one-PR mergeability.

### Decision 4 — Config surface (locked)

- `PLUGINS_ENABLED` via the existing non-throwing `Config.parseBooleanEnv(Deno.env.get('PLUGINS_ENABLED'))`
  (default OFF, like `pullOnStart` — **not** the default-ON `parseBooleanEnvWithDefault` used by `mcpEnabled`).
  Add `public readonly pluginsEnabled: boolean;` beside `mcpEnabled`.
- `PLUGINS_DIR` as a `get plugins(): string` getter inside the readonly `config.paths` object, returning
  `Deno.env.get('PLUGINS_DIR')?.trim() || \`${config.basePath}/plugins\``. **Not** auto-created in
`config.init()`.
- Startup: wire `await pluginHost.initialize()` immediately after `trashGuideManager.initialize()` in a
  `pullOnStart`-style `if (config.pluginsEnabled) { try … catch → logger.warn(…continuing startup) } else {
logger.info('Plugins disabled via PLUGINS_ENABLED') }` — graceful degradation on **both** the disabled path
  and any failure path. Never throws to abort boot.

### Open questions (to resolve before/with implementation)

1. **Manifest filename** — this design assumes `praxrr.plugin.json` per plugin subdir; confirm vs. a flat
   `<dir>/plugin.json` convention before `scan.ts` is built.
2. **Pure `parsePluginsEnabled` export** vs. the private `parseBooleanEnv` + readonly-cast integration test —
   this design chose the latter (DRY; the flag is boolean-identical to `pullOnStart`). Revisit if a mode enum
   is ever needed.
3. **Where the deferred throwing finite-limit lives** (`PLUGINS_MAX_MANIFESTS` / scan timeout) — with the
   executor (Phase 2) or as an interim scan guard.
4. **Registry re-scan/reload semantics** — Phase-1 registry is built once at boot; confirm whether
   `host.reset()` + re-scan (e.g. a future admin trigger) is needed before Phase 2.
5. **`interfaceVersion` governance** — per-point vs. global `PLUGIN_API_VERSION` bump policy, and whether a
   manifest may pin a required `interfaceVersion` per point.
6. **Exact projection field lists per capability** — the four Phase-1 capabilities need their concrete
   allow-listed snapshot shapes finalized against the real resolved-profile / sync-preview types before
   `hostContext.ts` projections are authored (kept minimal/observe-only).
7. **`redactSecrets` reuse** — import the existing `$server/mcp/redact.ts` scrubber (recommended, DRY) vs.
   extracting a shared scrubber into `$shared`; validate no client-bundle leakage results.

---

## Appendix A — File Contract (≈12 new files + 5 shared edits + 2 docs)

### Pure contract — `packages/praxrr-app/src/lib/shared/plugins/` (client + server safe)

| File                 | Responsibility                                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`           | Pure source of truth: `PLUGIN_API_VERSION` (declared once), `SUPPORTED_PLUGIN_API_VERSIONS`, closed `ExtensionPointId` / `ExtensionPointKind` / `CapabilityId` / `PluginRuntime` / `PluginLifecycleState` unions, `PluginJsonValue`, `PluginManifest`, `PluginManifestIssue`, `ManifestValidationResult`. Type-only imports, zero I/O. Mirrors `$shared/security/types.ts`. |
| `capabilities.ts`    | `CAPABILITY_IDS`, `CapabilityDescriptor`, `CAPABILITY_CATALOG`, `getCapability`, `checkCapabilityGrant`. Contains **no** credential/auth/secret/network/fs/db/write id. Pure.                                                                                                                                                                                               |
| `extensionPoints.ts` | `ExtensionPointDescriptor`, `EXTENSION_POINT_IDS`, `EXTENSION_POINTS` (all 9, stable order; `wired:true` only for the two observe points), `listExtensionPoints`, `getExtensionPoint`, `wiredObservePoints`. Pure.                                                                                                                                                          |
| `validator.ts`       | `validatePluginManifest(raw): ManifestValidationResult` — pure, fail-fast, accumulates all field errors. No I/O, no `Deno.env`.                                                                                                                                                                                                                                             |
| `index.ts`           | Pure barrel — one import surface, safe from client and server.                                                                                                                                                                                                                                                                                                              |

### Server — `packages/praxrr-app/src/lib/server/plugins/`

| File             | Responsibility                                                                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `errors.ts`      | Typed error taxonomy (mirrors `mcp/errors.ts`); each sets `this.name`.                                                                                                                                                                                    |
| `executor.ts`    | `PluginExecutor` seam + `UnavailablePluginExecutor` (throwing default). **No** Extism import; the Phase-2 `ExtismPluginExecutor` lands here.                                                                                                              |
| `registry.ts`    | `RegisteredPlugin`, `PluginRegistry` over nested `Map<apiVersion, Map<lowercased id, RegisteredPlugin>>`, singleton `pluginRegistry`. Adds `unregister` + `apiVersion` namespacing + per-namespace case-insensitive id uniqueness. No DB.                 |
| `hostContext.ts` | `buildCapabilityInput` (least-privilege projection) + `scrubPluginBoundary` (reuses `redactSecrets`). Sole place domain data is projected for plugins.                                                                                                    |
| `scan.ts`        | Isolated I/O boundary — the **only** file touching `Deno.readDir`/`readTextFile`. Reads each subdir's `praxrr.plugin.json`, JSON-parses, returns raw entries (collects parse errors; rethrows only unexpected fs errors).                                 |
| `host.ts`        | `PluginHost` (constructor-injected executor + `setExecutor` + `initialize` + `notifyObservers` + `reset`), singleton `pluginHost`. Sole I/O mediator; no-op when disabled; warn-and-degrade on scan/validation failure; per-plugin isolation on dispatch. |
| `index.ts`       | Server barrel imported by `hooks.server.ts`.                                                                                                                                                                                                              |

### Shared edits

| File                       | Edit                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `…/utils/config/config.ts` | Add `pluginsEnabled` field (non-throwing `parseBooleanEnv`) + `get plugins()` path getter. Do **not** mkdir in `init()`.                |
| `hooks.server.ts`          | Import `pluginHost`; after `trashGuideManager.initialize()`, add the `pullOnStart`-style enabled/disabled guard with warn-and-continue. |
| `scripts/test.ts`          | Register the `plugins` alias covering the two new test suites.                                                                          |
| `CLAUDE.md`                | Document `PLUGINS_ENABLED` (default OFF) + `PLUGINS_DIR`.                                                                               |
| `ROADMAP.md`               | Add the Phase-1-shipped / Phase-2-deferred entry.                                                                                       |

### Docs (new)

| File                                                     | Content                                                                                                                                                          |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/plans/35-wasm-plugin-system/phase-1-foundation.md` | This internal design doc. Commit as `docs(internal)`.                                                                                                            |
| `docs/architecture/plugins.md`                           | Architecture note: extension-point catalog, `apiVersion` semantics, lifecycle states, capability projection/redaction boundary, the sole-I/O-mediator invariant. |

## Appendix B — Test Plan (summary)

- **`validator.test.ts`** — accept a minimal well-formed manifest; reject missing/empty/whitespace fields;
  reject non-member `apiVersion` (strict); reject unknown/credential/network/fs/write-shaped capability strings
  (fail-closed); reject a capability not consumable by any declared point (least-privilege); reject unknown
  extension-point id; reject entry path traversal / absolute / drive / non-`.wasm`; reject an unknown top-level
  key; accumulate multiple field errors in one result.
- **`capabilities.test.ts`** — `CAPABILITY_IDS` contains only the 4 observe-only read ids and none matches
  `/credential|secret|auth|token|api.?key|net|http|fs|file|write|mutate|db/`; every `CapabilityId` maps to ≥1
  observer point; catalog covers each id exactly once as `{mutates:false, touchesSecrets:false}`;
  `checkCapabilityGrant` returns false for an incompatible pair.
- **`extensionPoints.test.ts`** — bijection between `EXTENSION_POINTS` and `EXTENSION_POINT_IDS` in stable
  order; exactly the two observe points are `wired:true`; no transform/provider is wired; every point stamps
  `PLUGIN_API_VERSION` + an `interfaceVersion`; accessor round-trips.
- **`apiVersion.test.ts`** — `PLUGIN_API_VERSION ∈ SUPPORTED_PLUGIN_API_VERSIONS`; a manifest outside the set
  is rejected (pins the cache-safety/namespacing contract).
- **`registry.test.ts`** — register/get/unregister; same id under two `apiVersion`s coexist and are isolated;
  wrong-`apiVersion` lookup returns `undefined`; case-insensitive duplicate within one namespace rejected;
  `listForPoint` scoping; `clear()` empties all.
- **`executor.test.ts`** — `UnavailablePluginExecutor.execute()` rejects with `PluginRuntimeUnavailableError`
  (exact `.name` + message `'wasm runtime not yet available'`); `instanceof`-distinct from the manifest/wiring
  errors.
- **`host.test.ts`** — disabled ⇒ hard no-op (registry empty, dir never statted); enabled + missing dir ⇒
  warn/degrade, no throw; enabled + mixed valid/invalid manifests ⇒ valid registers, invalid skipped+logged,
  init completes; `notifyObservers` on a wired point swallows `PluginRuntimeUnavailableError` per-plugin (caller
  never throws; one plugin's failure does not block another); with a resolving fake executor the input reaching
  `execute()` is a projected, secret-free `PluginJsonValue`; `notifyObservers` on an unwired point throws
  `PluginPointNotWiredError`.
- **`hostContext.test.ts`** — `buildCapabilityInput` includes only allow-listed fields; a planted
  `api_key`/`token` is scrubbed to `[REDACTED]`; a capability with no grant yields no snapshot; output is
  structured-clone-safe.
- **`scan.test.ts`** — a raw entry per subdir with a manifest; `parseError` entry for malformed JSON (not
  thrown); skips manifest-less subdirs; tolerates an empty dir; rethrows an unexpected fs error.
- **`pluginsConfig.test.ts`** — `pluginsEnabled` defaults false; true for `1|true|yes|on`; invalid/empty ⇒
  false and does not throw at construction; `config.paths.plugins` returns the default under `basePath` and
  honors a trimmed `PLUGINS_DIR` override.

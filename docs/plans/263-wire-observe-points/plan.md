# #263 — Wire the two observe points to real producers

**Issue:** [#263](https://github.com/yandy-r/praxrr/issues/263) — WASM Plugin System | Sync | Wire the two
observe points to real producers. Parent initiative #35 / #267.

**Status of the runtime dependency (#262):** the Phase-2 Extism runtime is a documented NO-GO on the
Deno-WASM cancellation/fuel/memory gates, so `UnavailablePluginExecutor` remains the only production
executor. Wiring the observe points is still **complete and meaningful now**: the host degrades
gracefully (`PluginRuntimeUnavailableError` → debug-log skip, never propagates), so the producers fire
`notifyObservers`, the projection/scrub runs, and dispatch no-ops at the executor seam. When a compliant
Phase-2 executor lands it drops into the existing seam and the already-wired producers fire through to
real plugins with **no further call-site changes**.

## Goal

The two already-wired observe points fire from their **real** producers behind `PLUGINS_ENABLED`, handing
plugins a finalized, minimal, secret-free `PluginJsonValue` snapshot, with **zero** effect on
preview/apply when a plugin fails, and **byte-identical** behavior when the flag is off.

## Producers (decided after adversarial design review)

### 1. `config.profileCompiled.observe` → `read:resolved-profile`

- **Producer:** `QualityProfileSyncer.syncQualityProfiles` per-profile loop, at the codebase's own
  "Compile:QualityProfile" moment (`packages/praxrr-app/src/lib/server/sync/qualityProfiles/syncer.ts`,
  between the "Compiled quality profile" debug log and `writeQualityProfilePayload`).
- **Source object:** `{ ...pcdProfile, arrType: this.instanceType }`. `PcdQualityProfile` is
  **arr-agnostic** (no `arrType` field); the Arr discriminator is injected explicitly from
  `this.instanceType` (`'radarr' | 'sonarr' | 'lidarr'`) — never a guessed sibling (Cross-Arr policy).
  The shallow spread never mutates `pcdProfile`.
- **Scope:** the direct-sync compile path only (the canonical compile). Preview build and reviewed apply
  do **not** recompile a profile, so they do not fire — matching "a freshly compiled profile."

### 2. `sync.previewComputed.observe` → `read:sync-preview`

- **Producer:** `_handleSyncPreviewCreateRequest` in
  `packages/praxrr-app/src/routes/api/v1/sync/preview/+server.ts`, immediately after the
  `generatePreview` result is destructured and before persistence/branching.
- **Why the route, not `generatePreview` itself:** the orchestrator's `generatePreview` is reused by
  drift, canary, liveDiff, sync-history, MCP, and — critically — apply-time re-materialization
  (`arrSync.ts materializeReview`). Wiring the orchestrator would over-fire and fire **mid-apply**,
  violating "before any apply." The API preview-create route is the singular user-facing "preview
  computed" producer; apply is a physically separate endpoint/request, so this call site is inherently
  post-compute and pre-apply.
- **Source object:** `generated: GeneratePreviewResult`, which natively carries the Arr-explicit
  `arrType: SyncPreviewArrType`.

## Finalized allow-lists (`hostContext.ts`)

Replaces the illustrative Phase-1 allow-lists (which contained phantom field names), verified against the
real types:

- `read:resolved-profile`: `['arrType', 'id', 'name', 'qualities', 'customFormats']`
  (`PcdQualityProfile` + injected `arrType`; `id`/`customFormats` replace the illustrative
  `profileId`/`customFormatScores`).
- `read:sync-preview`: `['arrType', 'instanceId', 'summary', 'sections']` (`GeneratePreviewResult`;
  drops the illustrative `changeCount`/`entities` which do not exist on the type). Deliberately **omits**
  the `qualityProfiles`/`delayProfiles`/`mediaManagement`/`metadataProfiles` payloads whose
  `EntityChange.fields[].current/desired` are typed `unknown` — the one place arbitrary Arr config could
  ride along (least-privilege omission).
- `read:custom-format` and `read:config-validation` are left **untouched** (their points stay unwired,
  out of scope). The `CAPABILITY_FIELD_ALLOWLIST` doc-comment is updated to reflect that the two wired
  capabilities are now finalized against real producers while the other two remain placeholders.

## Fail-open & guard

Each call-site is `if (config.pluginsEnabled) { try { await pluginHost.notifyObservers(point, () =>
buildCapabilityInput(cap, source)); } catch (error) { await logger.warn(...) } }`:

- Guard **outside** the `try` ⇒ flag-off path is byte-identical (no try frame, no closure, no projection).
- The guard is required for correctness: `notifyObservers` is not flag-gated and throws
  `PluginPointNotWiredError` for a non-wired point.
- The dedicated **inner** try/catch makes fail-open **structural**, not merely contingent on the host's
  invariants: at the preview site it prevents the outer classifying catch from flipping a good preview to
  a 500 FAILED; at the syncer site (no enclosing classifying catch) it prevents an aborted sync batch. It
  logs at `warn` via the already-imported, non-throwing sanitized `logger` (no silent swallow).
- **Await** both calls: `notifyObservers` early-returns when no plugins are registered and bounds each
  plugin at a 5s `AbortSignal`; fire-and-forget would create a dangling promise that could outlive the
  request/loop scope.

## Tests

- `packages/praxrr-app/src/tests/sync/qualityProfilesObservePoint.test.ts` (profile-compile).
- `packages/praxrr-app/src/tests/base/syncPreviewObservePoint.test.ts` (preview).

Each pins five invariants — FIRES (minimal redacted snapshot; exact allow-listed keys; Arr-explicit
`arrType`), DISABLED-INVARIANCE (flag off ⇒ executor never called, output unchanged), THROWING-PLUGIN
INVARIANCE, NO-PLUGIN, and CALL-SITE THROW ISOLATION (stub `notifyObservers` to reject ⇒ producer still
succeeds) — plus a Cross-Arr matrix over `radarr`/`sonarr`/`lidarr`.

## Out of scope / follow-ups

- The runtime/executor (Phase-2, #262). No new capability id. No mutating/transform/provider point.
- Persistence, management API, UI, SDK.
- Phase-2 latency: the syncer emission is per-profile and the host awaits observers serially; when a real
  executor lands, add a single aggregate per-call-site dispatch budget or a registered-observer cap.
- `read:sync-preview` is also the capability for the still-unwired `sync.beforeApply.observe` /
  `sync.afterApply.observe`; #264/#265 must re-verify the apply-side source object before reusing the
  allow-list.

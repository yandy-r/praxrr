/**
 * Plugin-system error taxonomy (issue #35, Phase-1).
 *
 * Two failure kinds must never be conflated (mirrors `mcp/errors.ts`, design capabilityModel §3):
 *
 * - MANIFEST / SKIP faults describe a plugin that never becomes runnable: a malformed manifest, a
 *   failed validation, or a denied capability. The host RECORDS these (with their
 *   `PluginManifestIssue[]` where applicable), logs them, skips the offending plugin, and continues
 *   initialization — they NEVER abort boot.
 * - EXECUTION / THROW faults arise at the dispatch seam once a plugin is registered: a
 *   declared-but-unwired point was dispatched, the WASM runtime is not yet available, or a bound
 *   executor threw. The host isolates these per-plugin (try/catch + finite `AbortSignal` timeout at
 *   the seam) and NEVER lets them propagate to a caller.
 *
 * Each class sets `this.name` so structured logs and `instanceof` checks stay unambiguous.
 *
 * See docs/plans/35-wasm-plugin-system/plan.md for the authoritative Phase-1 spec.
 */

import type { PluginManifestIssue } from '$shared/plugins/index.ts';

/**
 * A manifest was malformed or failed validation. Carries every accumulated {@link PluginManifestIssue}
 * so the host can log a precise, fail-closed reason before SKIPPING the plugin. A SKIP fault — never
 * thrown across the dispatch seam and never aborts boot.
 */
export class PluginManifestError extends Error {
  constructor(
    message: string,
    public readonly issues: readonly PluginManifestIssue[] = []
  ) {
    super(message);
    this.name = 'PluginManifestError';
  }
}

/**
 * A plugin failed a non-manifest validation invariant (e.g. a registration precondition). A SKIP
 * fault, kept distinct from {@link PluginManifestError} which additionally carries field issues.
 */
export class PluginValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginValidationError';
  }
}

/**
 * A plugin requested or exercised a capability it was not granted under the least-privilege policy.
 * A SKIP fault surfaced during validation/registration.
 */
export class PluginCapabilityDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginCapabilityDeniedError';
  }
}

/**
 * Dispatch was attempted for a declared-but-unwired extension point. A THROW fault raised by the
 * host seam to guard against dispatching a point that has no Phase-1 wiring.
 */
export class PluginPointNotWiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginPointNotWiredError';
  }
}

/**
 * The plugin runtime is not available. The shipped default executor rejects with this; the host
 * treats it as the EXPECTED Phase-1 outcome and logs it at debug rather than warn.
 */
export class PluginRuntimeUnavailableError extends Error {
  constructor(message = 'wasm runtime not yet available') {
    super(message);
    this.name = 'PluginRuntimeUnavailableError';
  }
}

/**
 * A bound executor threw or misbehaved while running a plugin. A THROW fault the host isolates
 * per-plugin at the seam so one plugin's failure can never destabilize the caller.
 */
export class PluginExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginExecutionError';
  }
}

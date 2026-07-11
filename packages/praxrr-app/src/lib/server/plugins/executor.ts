/**
 * Plugin execution seam — swappable executor contract + inert default (issue #35, Phase-1).
 *
 * ALL plugin dispatch routes through the {@link PluginExecutor} interface: a single typed boundary
 * over {@link PluginJsonValue} only, so no Extism/WASM (or any runtime) type ever leaks into the
 * host, registry, validator, or contract. Phase-1 ships exactly one implementation,
 * {@link UnavailablePluginExecutor}, whose `execute` rejects with a typed
 * {@link PluginRuntimeUnavailableError} — no WASM is loaded or run. A Phase-2 `ExtismPluginExecutor`
 * (or a native Deno Worker / QuickJS executor) drops in here implementing the IDENTICAL interface
 * with zero changes to host/registry/validator/contract.
 *
 * Cycle-avoidance: the `RegisteredPlugin` import is `import type` ONLY (type-erased, zero runtime
 * edge) so `executor.ts → registry.ts` adds no runtime import cycle; `registry.ts` imports nothing
 * from here. There is NO Extism/WASM import anywhere in this module.
 *
 * See docs/plans/35-wasm-plugin-system/plan.md for the authoritative Phase-1 spec.
 */

import type { ExtensionPointId, PluginJsonValue } from '$shared/plugins/index.ts';
import type { RegisteredPlugin } from './registry.ts';
import { PluginRuntimeUnavailableError } from './errors.ts';

export type { PluginJsonValue } from '$shared/plugins/index.ts';

/** Immutable, secret-free metadata handed to a plugin alongside its projected input at dispatch time. */
export interface PluginInvocationMeta {
  readonly pluginId: string;
  readonly apiVersion: string;
  readonly point: ExtensionPointId;
}

/**
 * A single execution request crossing the seam. `input` is an already projected + secret-scrubbed
 * {@link PluginJsonValue} snapshot (the host does the projection/redaction before calling `execute`);
 * `signal` carries the host's finite timeout so a runtime can honor cancellation.
 */
export interface PluginExecutionRequest {
  readonly plugin: RegisteredPlugin;
  readonly point: ExtensionPointId;
  readonly input: PluginJsonValue;
  readonly signal: AbortSignal;
}

/**
 * The swappable execution boundary. An implementation MUST resolve to a structured-clone-safe
 * {@link PluginJsonValue} (or reject); no Extism/WASM type is permitted in the signature.
 */
export interface PluginExecutor {
  execute(req: PluginExecutionRequest): Promise<PluginJsonValue>;
}

/**
 * The shipped Phase-1 default: an inert executor that runs no code and always rejects with
 * {@link PluginRuntimeUnavailableError}. This is the point where a real WASM runtime plugs in later.
 */
export class UnavailablePluginExecutor implements PluginExecutor {
  execute(_req: PluginExecutionRequest): Promise<never> {
    return Promise.reject(new PluginRuntimeUnavailableError('wasm runtime not yet available'));
  }
}

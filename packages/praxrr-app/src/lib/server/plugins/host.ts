/**
 * Plugin host — the optional-subsystem orchestrator + sole I/O mediator (issue #35, Phase-1).
 *
 * `PluginHost` is the single convergence point of the server plugin layer (trashguide manager /
 * `NotificationManager` shape). It owns discovery, validation, registration, and the observe-dispatch
 * seam, and it degrades gracefully at every step so it can NEVER abort boot:
 *
 * - `initialize()` is a hard NO-OP + info log when `PLUGINS_ENABLED` is off. When enabled it stats
 *   `config.paths.plugins`, warns + degrades to an empty registry on {@link Deno.errors.NotFound},
 *   scans → validates → registers valid manifests, skips + logs invalid ones, and ends with a summary
 *   info log. Only unexpected errors propagate (hooks.server.ts wraps this in warn-and-continue).
 * - `notifyObservers(point, buildInput)` dispatches ONLY wired observe points (else throws
 *   {@link PluginPointNotWiredError}). It projects + secret-scrubs the input AT THE SEAM (via
 *   `scrubPluginBoundary`) BEFORE any `executor.execute`, isolates every plugin in a try/catch bounded
 *   by a finite `AbortSignal` timeout, logs a runtime-unavailable outcome at debug and any other throw
 *   at warn, and NEVER propagates — one plugin's failure can neither abort the caller nor block another.
 * - `reset()` clears the registry (re-scan / shutdown).
 *
 * Execution routes through the injected {@link PluginExecutor} seam (default
 * {@link UnavailablePluginExecutor}); `setExecutor` lets Phase-2 (or a test fake) swap in a real
 * runtime with zero other changes. No WASM/Extism type ever reaches this module.
 *
 * See docs/plans/35-wasm-plugin-system/plan.md for the authoritative Phase-1 spec.
 */

import { config } from '$config';
import { logger } from '$logger/logger.ts';
import {
  getExtensionPoint,
  PLUGIN_API_VERSION,
  validatePluginManifest,
  type ExtensionPointId,
  type PluginJsonValue,
} from '$shared/plugins/index.ts';
import { scanPluginDir, type RawManifestEntry } from './scan.ts';
import { pluginRegistry, type RegisteredPlugin } from './registry.ts';
import { UnavailablePluginExecutor, type PluginExecutionRequest, type PluginExecutor } from './executor.ts';
import { PluginExecutionError, PluginPointNotWiredError, PluginRuntimeUnavailableError } from './errors.ts';
import { scrubPluginBoundary } from './hostContext.ts';

/** Finite per-plugin dispatch budget. A hung observer is aborted so it can never stall a caller. */
const OBSERVE_DISPATCH_TIMEOUT_MS = 5000;

/** Log `source` tag for every host message. */
const LOG_SOURCE = 'Plugins';

/** The disposition of one scanned manifest entry after validation + registration. */
type EntryOutcome = 'registered' | 'rejected';

/**
 * A promise that rejects with a {@link PluginExecutionError} when `signal` aborts. Lets the host bound
 * an executor that ignores its `signal` and never settles, so a hung plugin can never stall the caller.
 * It never resolves; the caller clears the backing timer once `execute` settles, so it can only reject
 * on a real timeout.
 */
function rejectOnAbort(signal: AbortSignal, pluginId: string): Promise<never> {
  return new Promise<never>((_, reject) => {
    signal.addEventListener(
      'abort',
      () =>
        reject(
          new PluginExecutionError(
            `Observe dispatch for plugin '${pluginId}' exceeded ${OBSERVE_DISPATCH_TIMEOUT_MS}ms`
          )
        ),
      { once: true }
    );
  });
}

/**
 * Optional-subsystem plugin manager. Constructed with an executor (default
 * {@link UnavailablePluginExecutor}); the shared {@link pluginHost} singleton is what
 * `hooks.server.ts` initializes.
 */
export class PluginHost {
  private executor: PluginExecutor;

  constructor(executor: PluginExecutor = new UnavailablePluginExecutor()) {
    this.executor = executor;
  }

  /** Swap the execution seam (Phase-2 runtime or a test fake). Takes effect on the next dispatch. */
  setExecutor(executor: PluginExecutor): void {
    this.executor = executor;
  }

  /**
   * Discover, validate, and register plugins. A hard NO-OP + info log when `PLUGINS_ENABLED` is off.
   * When enabled it stats `config.paths.plugins` (warn + degrade to an empty registry on
   * {@link Deno.errors.NotFound}), scans + validates each manifest, registers the valid ones, skips +
   * logs the invalid ones, and ends with a summary info log. Only unexpected errors propagate — this
   * never throws on the disabled, missing-dir, or invalid-manifest paths, so it cannot abort boot.
   */
  async initialize(): Promise<void> {
    if (!config.pluginsEnabled) {
      await logger.info('Plugins disabled via PLUGINS_ENABLED', {
        source: LOG_SOURCE,
        meta: { enabled: false },
      });
      return;
    }

    const dir = config.paths.plugins;
    let discovered = 0;
    let registered = 0;
    let rejected = 0;

    if (await this.pluginDirExists(dir)) {
      const entries = await scanPluginDir(dir);
      discovered = entries.length;
      for (const entry of entries) {
        const outcome = await this.registerEntry(entry);
        if (outcome === 'registered') {
          registered += 1;
        } else {
          rejected += 1;
        }
      }
    }

    await logger.info('Plugin host initialized', {
      source: LOG_SOURCE,
      meta: { enabled: true, discovered, registered, rejected },
    });
  }

  /**
   * Dispatch a wired observe point to every registered plugin declaring it. Throws
   * {@link PluginPointNotWiredError} for any unknown, unwired, or non-observe point. The projected +
   * secret-scrubbed input is built ONCE at the seam before the first `executor.execute`; each plugin
   * runs in isolation under a finite {@link AbortSignal} timeout and never propagates a failure.
   */
  async notifyObservers(point: ExtensionPointId, buildInput: () => PluginJsonValue): Promise<void> {
    const descriptor = getExtensionPoint(point);
    if (!descriptor || !descriptor.wired || descriptor.kind !== 'observe') {
      throw new PluginPointNotWiredError(`Extension point '${point}' is not a wired observe point`);
    }

    const plugins = pluginRegistry.listForPoint(PLUGIN_API_VERSION, point);
    if (plugins.length === 0) {
      return;
    }

    const input = scrubPluginBoundary(buildInput());
    for (const plugin of plugins) {
      await this.dispatchOne(plugin, point, input);
    }
  }

  /** Clear every registered plugin (re-scan / shutdown). */
  reset(): void {
    pluginRegistry.clear();
  }

  /**
   * Stat `dir` to decide whether discovery can proceed. Warns + degrades (returns `false`) when the
   * directory is missing or is not a directory; only an unexpected fs error propagates.
   */
  private async pluginDirExists(dir: string): Promise<boolean> {
    try {
      const info = await Deno.stat(dir);
      if (!info.isDirectory) {
        await logger.warn('PLUGINS_DIR is not a directory; degrading to empty plugin registry', {
          source: LOG_SOURCE,
          meta: { dir },
        });
        return false;
      }
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        await logger.warn('PLUGINS_DIR not found; degrading to empty plugin registry', {
          source: LOG_SOURCE,
          meta: { dir },
        });
        return false;
      }
      throw error;
    }
  }

  /**
   * Validate and register one scanned entry. Malformed JSON, a failed validation, or a duplicate id is
   * SKIPPED + logged (returns `'rejected'`), never thrown — one bad manifest never blocks the rest.
   */
  private async registerEntry(entry: RawManifestEntry): Promise<EntryOutcome> {
    if (entry.parseError !== undefined) {
      await logger.warn('Skipping plugin with unparseable manifest', {
        source: LOG_SOURCE,
        meta: { dir: entry.dir, error: entry.parseError },
      });
      return 'rejected';
    }

    const result = validatePluginManifest(entry.raw);
    if (!result.ok) {
      await logger.warn('Skipping plugin with invalid manifest', {
        source: LOG_SOURCE,
        meta: { dir: entry.dir, issues: result.errors },
      });
      return 'rejected';
    }

    try {
      pluginRegistry.register(entry.dir, result.manifest);
      return 'registered';
    } catch (error) {
      await logger.warn('Skipping plugin that failed registration', {
        source: LOG_SOURCE,
        meta: { dir: entry.dir, id: result.manifest.id, error: String(error) },
      });
      return 'rejected';
    }
  }

  /**
   * Run a single plugin for `point` under a finite timeout. A {@link PluginRuntimeUnavailableError} is
   * the EXPECTED Phase-1 outcome (logged at debug); any other throw is logged at warn. Never propagates.
   */
  private async dispatchOne(plugin: RegisteredPlugin, point: ExtensionPointId, input: PluginJsonValue): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OBSERVE_DISPATCH_TIMEOUT_MS);
    const request: PluginExecutionRequest = { plugin, point, input, signal: controller.signal };

    try {
      const executed = this.executor.execute(request);
      // Prevent a late rejection (arriving after a timeout already won the race) from surfacing as an
      // unhandled rejection; the race below still observes the original settlement.
      void executed.catch(() => {});
      // Enforce the finite budget at the HOST even if the executor ignores `signal` and never settles,
      // so a non-cooperative or hung plugin can never stall notifyObservers (or the caller).
      await Promise.race([executed, rejectOnAbort(controller.signal, plugin.manifest.id)]);
    } catch (error) {
      if (error instanceof PluginRuntimeUnavailableError) {
        await logger.debug('Plugin runtime unavailable; observe dispatch skipped', {
          source: LOG_SOURCE,
          meta: { pluginId: plugin.manifest.id, point },
        });
        return;
      }
      await logger.warn('Plugin observe dispatch failed', {
        source: LOG_SOURCE,
        meta: { pluginId: plugin.manifest.id, point, error: String(error) },
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Process-wide singleton host wired into startup and shared by tests. */
export const pluginHost = new PluginHost();

/**
 * Executor seam tests (issue #35, Phase-1).
 *
 * Pins the shipped default {@link UnavailablePluginExecutor}: it runs no code and always rejects with
 * a typed {@link PluginRuntimeUnavailableError} carrying the exact name + message
 * `'wasm runtime not yet available'`, and that error is `instanceof`-distinct from the manifest/SKIP
 * error taxonomy so the host can log the EXPECTED Phase-1 runtime-unavailable outcome at debug without
 * conflating it with a rejected-manifest fault.
 */

import { assert, assertEquals, assertRejects } from '@std/assert';

import { PLUGIN_API_VERSION, type PluginManifest } from '$shared/plugins/index.ts';
import {
  PluginManifestError,
  PluginPointNotWiredError,
  PluginRuntimeUnavailableError,
  PluginValidationError,
  UnavailablePluginExecutor,
  type PluginExecutionRequest,
  type RegisteredPlugin,
} from '$server/plugins/index.ts';

const manifest: PluginManifest = {
  apiVersion: PLUGIN_API_VERSION,
  id: 'com.example.observer',
  name: 'Example Observer',
  version: '1.0.0',
  runtime: 'wasm',
  entry: 'plugin.wasm',
  extensionPoints: ['config.profileCompiled.observe'],
  capabilities: ['read:resolved-profile'],
};

const plugin: RegisteredPlugin = {
  manifest,
  sourceDir: '/tmp/plugins/com.example.observer',
  state: 'registered',
  registeredAt: new Date().toISOString(),
};

/** A well-formed request the inert executor is expected to reject regardless of its contents. */
function buildRequest(): PluginExecutionRequest {
  return {
    plugin,
    point: 'config.profileCompiled.observe',
    input: { profileId: 1 },
    signal: new AbortController().signal,
  };
}

Deno.test(
  'UnavailablePluginExecutor.execute rejects with PluginRuntimeUnavailableError (exact name + message)',
  async () => {
    const executor = new UnavailablePluginExecutor();

    const error = await assertRejects(
      () => executor.execute(buildRequest()),
      PluginRuntimeUnavailableError,
      'wasm runtime not yet available'
    );

    assertEquals(error.name, 'PluginRuntimeUnavailableError');
    assertEquals(error.message, 'wasm runtime not yet available');
  }
);

Deno.test(
  'UnavailablePluginExecutor rejection is instanceof-distinct from the manifest/SKIP error taxonomy',
  async () => {
    const executor = new UnavailablePluginExecutor();

    const error = await assertRejects(() => executor.execute(buildRequest()), PluginRuntimeUnavailableError);

    assert(error instanceof PluginRuntimeUnavailableError);
    assert(error instanceof Error);
    assert(!(error instanceof PluginManifestError));
    assert(!(error instanceof PluginValidationError));
    assert(!(error instanceof PluginPointNotWiredError));
  }
);

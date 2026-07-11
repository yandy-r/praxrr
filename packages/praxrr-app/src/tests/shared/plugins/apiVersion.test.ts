/**
 * Pure tests for the plugin api-version contract (issue #35, Phase-1).
 *
 * Pins the cache-safety/namespacing invariant: `PLUGIN_API_VERSION` is a member of
 * `SUPPORTED_PLUGIN_API_VERSIONS` (guards the constant against silent drift), and a manifest whose
 * `apiVersion` is outside the supported set is rejected (strict support, no negotiation). No I/O.
 */

import { assert, assertEquals } from '@std/assert';
import { PLUGIN_API_VERSION, SUPPORTED_PLUGIN_API_VERSIONS, validatePluginManifest } from '$shared/plugins/index.ts';

/** A well-formed manifest whose apiVersion can be overridden per case. */
function manifestWithApiVersion(apiVersion: string): Record<string, unknown> {
  return {
    apiVersion,
    id: 'com.example.observer',
    name: 'Example Observer',
    version: '1.0.0',
    runtime: 'wasm',
    entry: 'plugin.wasm',
    extensionPoints: ['config.profileCompiled.observe'],
    capabilities: ['read:resolved-profile'],
  };
}

Deno.test('PLUGIN_API_VERSION is a member of SUPPORTED_PLUGIN_API_VERSIONS', () => {
  // Widen to `readonly string[]` so `.includes` type-checks against the literal-union element (TS2345).
  const supported: readonly string[] = SUPPORTED_PLUGIN_API_VERSIONS;
  assert(supported.includes(PLUGIN_API_VERSION), 'PLUGIN_API_VERSION must be a supported version');
});

Deno.test('a manifest with a supported apiVersion is accepted', () => {
  const result = validatePluginManifest(manifestWithApiVersion(PLUGIN_API_VERSION));
  assert(result.ok, 'a manifest pinned to the current api version must be accepted');
});

Deno.test('a manifest whose apiVersion is outside the supported set is rejected', () => {
  const supported: readonly string[] = SUPPORTED_PLUGIN_API_VERSIONS;
  const unsupported = '9999';
  assertEquals(supported.includes(unsupported), false, 'the test fixture must use an unsupported version');

  const result = validatePluginManifest(manifestWithApiVersion(unsupported));
  assert(!result.ok, 'an unsupported apiVersion must be rejected');
  assert(
    result.errors.some((error) => error.field === 'apiVersion' && error.code === 'unsupported_api_version'),
    'rejection must cite an unsupported_api_version issue on apiVersion'
  );
});

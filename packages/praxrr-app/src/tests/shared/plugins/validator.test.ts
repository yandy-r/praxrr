/**
 * Pure tests for the plugin manifest validator (issue #35, Phase-1).
 *
 * Exercises {@link validatePluginManifest}: accept a minimal well-formed manifest; reject each
 * missing/empty required field, a non-member apiVersion, unknown/credential/network/fs/write-shaped
 * capabilities (fail-closed), unknown extension points, unsafe `entry` shapes, and unknown top-level
 * keys; accumulate multiple errors in one pass; and enforce the load-bearing least-privilege denial
 * (a mutating/transform point paired with a read capability is rejected). No I/O, no mocks — the
 * validator is pure.
 */

import { assert, assertEquals } from '@std/assert';
import { type PluginManifestIssue, validatePluginManifest } from '$shared/plugins/index.ts';

/** A fresh, minimal well-formed manifest as untyped JSON (the validator's `unknown` input). */
function baseManifest(): Record<string, unknown> {
  return {
    apiVersion: '1',
    id: 'com.example.observer',
    name: 'Example Observer',
    version: '1.0.0',
    runtime: 'wasm',
    entry: 'plugin.wasm',
    extensionPoints: ['config.profileCompiled.observe'],
    capabilities: ['read:resolved-profile'],
  };
}

/** Return a shallow copy of `source` with `key` removed (avoids `delete` on an index signature). */
function omit(source: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([k]) => k !== key));
}

/** Assert a manifest is rejected and return its accumulated issues. */
function expectRejected(raw: unknown): readonly PluginManifestIssue[] {
  const result = validatePluginManifest(raw);
  assert(!result.ok, 'expected manifest to be rejected');
  return result.errors;
}

/** Whether any issue carries the given machine code. */
function hasCode(errors: readonly PluginManifestIssue[], code: string): boolean {
  return errors.some((error) => error.code === code);
}

Deno.test('validatePluginManifest accepts a minimal well-formed manifest', () => {
  const result = validatePluginManifest(baseManifest());
  assert(result.ok, 'expected the minimal manifest to be accepted');
  assertEquals(result.manifest.id, 'com.example.observer');
  assertEquals(result.manifest.runtime, 'wasm');
  assertEquals(result.manifest.extensionPoints, ['config.profileCompiled.observe']);
  assertEquals(result.manifest.capabilities, ['read:resolved-profile']);
});

Deno.test('validatePluginManifest rejects a non-object manifest', () => {
  for (const raw of [null, undefined, 'a string', 42, ['array'], true]) {
    const errors = expectRejected(raw);
    assert(hasCode(errors, 'invalid_type'), `expected invalid_type for ${String(raw)}`);
  }
});

Deno.test('validatePluginManifest rejects each missing required field', () => {
  const requiredFields = ['apiVersion', 'id', 'name', 'version', 'runtime', 'entry', 'extensionPoints', 'capabilities'];
  for (const field of requiredFields) {
    const errors = expectRejected(omit(baseManifest(), field));
    assert(
      errors.some((error) => error.field === field && error.code === 'missing'),
      `expected a missing-error for ${field}`
    );
  }
});

Deno.test('validatePluginManifest rejects empty/whitespace id, name, version, entry', () => {
  assert(hasCode(expectRejected({ ...baseManifest(), id: '' }), 'empty'));
  assert(hasCode(expectRejected({ ...baseManifest(), name: '   ' }), 'empty'));
  assert(hasCode(expectRejected({ ...baseManifest(), version: '' }), 'empty'));
  assert(hasCode(expectRejected({ ...baseManifest(), entry: '   ' }), 'empty'));
});

Deno.test('validatePluginManifest rejects a malformed (non-slug) id', () => {
  const errors = expectRejected({ ...baseManifest(), id: 'Not A Slug!' });
  assert(errors.some((error) => error.field === 'id' && error.code === 'invalid_format'));
});

Deno.test('validatePluginManifest rejects a non-member apiVersion (strict, no negotiation)', () => {
  const errors = expectRejected({ ...baseManifest(), apiVersion: '2' });
  assert(hasCode(errors, 'unsupported_api_version'), 'expected unsupported_api_version');
});

Deno.test('validatePluginManifest rejects runtime other than wasm', () => {
  const errors = expectRejected({ ...baseManifest(), runtime: 'native' });
  assert(errors.some((error) => error.field === 'runtime'));
});

Deno.test('validatePluginManifest rejects unknown and forbidden-shaped capabilities fail-closed', () => {
  const forbidden = ['read:credentials', 'net:http', 'fs:read', 'db:write', 'write:config', 'auth:session'];
  for (const capability of forbidden) {
    const errors = expectRejected({
      ...baseManifest(),
      // Pair with a broad point set so the ONLY defect is the unrepresentable capability.
      extensionPoints: ['config.profileCompiled.observe', 'sync.previewComputed.observe'],
      capabilities: [capability],
    });
    assert(hasCode(errors, 'unknown_capability'), `expected unknown_capability for ${capability}`);
  }
});

Deno.test('validatePluginManifest rejects an unknown extension point', () => {
  const errors = expectRejected({
    ...baseManifest(),
    extensionPoints: ['does.not.exist'],
    capabilities: [],
  });
  assert(hasCode(errors, 'unknown_extension_point'), 'expected unknown_extension_point');
});

Deno.test('validatePluginManifest rejects unsafe entry shapes (traversal, absolute, drive, non-.wasm)', () => {
  assert(hasCode(expectRejected({ ...baseManifest(), entry: '../evil.wasm' }), 'unsafe_entry'));
  assert(hasCode(expectRejected({ ...baseManifest(), entry: '/abs/plugin.wasm' }), 'unsafe_entry'));
  assert(hasCode(expectRejected({ ...baseManifest(), entry: 'C:\\plugin.wasm' }), 'unsafe_entry'));
  assert(hasCode(expectRejected({ ...baseManifest(), entry: 'plugin.txt' }), 'invalid_format'));
});

Deno.test('validatePluginManifest rejects an unknown top-level key (fail-closed)', () => {
  const errors = expectRejected({ ...baseManifest(), surprise: 'value' });
  assert(
    errors.some((error) => error.field === 'surprise' && error.code === 'unknown_key'),
    'expected unknown_key for the surprise field'
  );
});

Deno.test(
  'validatePluginManifest rejects a read capability paired with a mutating/transform point (least-privilege)',
  () => {
    // parser.releaseTitle.transform is a mutating transform point; read:sync-preview cannot consume it.
    // Proves a plugin cannot gain read data via a mutating point.
    const errors = expectRejected({
      ...baseManifest(),
      extensionPoints: ['parser.releaseTitle.transform'],
      capabilities: ['read:sync-preview'],
    });
    assert(hasCode(errors, 'least_privilege'), 'expected a least_privilege rejection');
  }
);

Deno.test('validatePluginManifest rejects a capability not consumable by any declared point (least-privilege)', () => {
  // read:custom-format is a valid capability, but its only point (customFormat.condition.evaluate)
  // is not declared here, so it is not consumable.
  const errors = expectRejected({
    ...baseManifest(),
    extensionPoints: ['config.profileCompiled.observe'],
    capabilities: ['read:custom-format'],
  });
  assert(hasCode(errors, 'least_privilege'), 'expected a least_privilege rejection');
});

Deno.test('validatePluginManifest accumulates multiple field errors in one pass', () => {
  const errors = expectRejected({
    apiVersion: '99',
    id: '',
    // name, version, runtime, entry, extensionPoints, capabilities all missing
  });
  assert(errors.length >= 3, `expected multiple accumulated errors, got ${errors.length}`);
  const fields = new Set(errors.map((error) => error.field));
  assert(fields.size >= 3, 'expected errors spanning multiple distinct fields');
});

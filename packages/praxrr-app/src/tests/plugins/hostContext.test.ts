/**
 * Plugin boundary projection + secret-scrub tests (issue #35, Phase-1).
 *
 * Pins the sole domain-data projection path (`$server/plugins/hostContext.ts`): the least-privilege
 * allow-list projection is the PRIMARY guarantee (only allow-listed top-level fields cross the seam)
 * and `redactSecrets` is defense-in-depth at the boundary. Covers the design testPlan cases: only
 * allow-listed fields projected, planted secret-shaped keys scrubbed to `[REDACTED]`, no grantable
 * fields yields no snapshot, and the projection is structured-clone-safe.
 *
 * See docs/plans/35-wasm-plugin-system/plan.md for the authoritative Phase-1 spec.
 */

import { assert, assertEquals } from '@std/assert';
import { buildCapabilityInput, scrubPluginBoundary } from '$server/plugins/hostContext.ts';
import type { PluginJsonValue } from '$shared/plugins/index.ts';

/** Narrow a {@link PluginJsonValue} to a JSON object so keyed access type-checks. */
function isJsonRecord(value: PluginJsonValue): value is { readonly [key: string]: PluginJsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Narrow a {@link PluginJsonValue} to a JSON array (avoids the `Array.isArray` readonly-narrowing pitfall). */
function isJsonArray(value: PluginJsonValue): value is readonly PluginJsonValue[] {
  return Array.isArray(value);
}

Deno.test('buildCapabilityInput projects ONLY allow-listed fields for a granted capability', () => {
  const source = {
    profileId: 'profile-1',
    name: 'HD Bluray',
    qualities: ['Bluray-1080p', 'WEBDL-1080p'],
    customFormatScores: { x264: 100 },
    // Fields NOT on the read:resolved-profile allow-list must never cross the boundary.
    apiKey: 'sk-should-not-appear',
    internalDbRow: { id: 42 },
    credentials: { password: 'hunter2' },
  };

  const projected = buildCapabilityInput('read:resolved-profile', source);
  assert(isJsonRecord(projected));

  assertEquals(Object.keys(projected).sort(), ['customFormatScores', 'name', 'profileId', 'qualities']);
  assertEquals(projected.profileId, 'profile-1');
  assertEquals(projected.name, 'HD Bluray');
  assert(!('apiKey' in projected));
  assert(!('internalDbRow' in projected));
  assert(!('credentials' in projected));
});

Deno.test('scrubPluginBoundary redacts planted secret-shaped keys at the seam', () => {
  const source = {
    summary: 'sync preview',
    changeCount: 3,
    // A secret planted INSIDE an allow-listed field survives projection, so the scrub must catch it.
    entities: [{ name: 'Radarr A', api_key: 'sk-live-abcdef', token: 'raw-bearer-token' }],
    instanceId: 'inst-1',
  };

  const projected = buildCapabilityInput('read:sync-preview', source);
  const scrubbed = scrubPluginBoundary(projected);
  assert(isJsonRecord(scrubbed));

  const entities = scrubbed.entities;
  assert(isJsonArray(entities));
  const first = entities[0];
  assert(isJsonRecord(first));

  assertEquals(first.api_key, '[REDACTED]');
  assertEquals(first.token, '[REDACTED]');
  // Non-secret fields are preserved through the scrub.
  assertEquals(first.name, 'Radarr A');
  assertEquals(scrubbed.summary, 'sync preview');
  assertEquals(scrubbed.instanceId, 'inst-1');
});

Deno.test('buildCapabilityInput yields no snapshot when the source exposes no grantable fields', () => {
  // Plain object with none of the capability's allow-listed fields present.
  assertEquals(buildCapabilityInput('read:custom-format', { unrelated: 1, other: 'x' }), null);
  assertEquals(buildCapabilityInput('read:config-validation', {}), null);
  // Source is not a plain object.
  assertEquals(buildCapabilityInput('read:resolved-profile', null), null);
  assertEquals(buildCapabilityInput('read:resolved-profile', 'not-an-object'), null);
  assertEquals(buildCapabilityInput('read:resolved-profile', ['array']), null);
});

Deno.test('buildCapabilityInput output is structured-clone-safe and JSON round-trips', () => {
  const source = {
    valid: true,
    issues: [{ code: 'x', nested: { deep: [1, 2, 3] } }],
    entity: { kind: 'quality-profile', count: 2 },
    // Non-allow-listed, non-JSON value: dropped by the allow-list before conversion.
    ignored: () => 'fn',
  };

  const projected = buildCapabilityInput('read:config-validation', source);
  assert(isJsonRecord(projected));

  assertEquals(Object.keys(projected).sort(), ['entity', 'issues', 'valid']);
  assertEquals(JSON.parse(JSON.stringify(projected)), projected);
  assertEquals(structuredClone(projected), projected);
});

Deno.test('buildCapabilityInput coerces non-JSON values in allow-listed fields to a clone-safe shape', () => {
  const source = {
    profileId: 'p',
    name: 'n',
    // Non-finite numbers collapse to null; a function value is dropped from the object.
    qualities: [Infinity, Number.NaN, 'ok'],
    customFormatScores: { score: 5, compute: () => 1 },
  };

  const projected = buildCapabilityInput('read:resolved-profile', source);
  assert(isJsonRecord(projected));

  assertEquals(projected.qualities, [null, null, 'ok']);
  assertEquals(projected.customFormatScores, { score: 5 });
  assertEquals(JSON.parse(JSON.stringify(projected)), projected);
  assertEquals(structuredClone(projected), projected);
});

/**
 * Pure tests for the plugin capability catalog + least-privilege policy (issue #35, Phase-1).
 *
 * Pins the deny-by-construction model: `CAPABILITY_IDS` is exactly the 4 observe-only read ids and
 * none has a credential/network/fs/write shape; every capability grants at least one DECLARED point
 * (any kind) via `checkCapabilityGrant` (no orphan capability); and — the real security invariant —
 * no capability's `compatiblePoints` includes a mutating (`mutates === true`) point. Every catalog
 * entry is covered once as `{ mutates: false, touchesSecrets: false }`, and an incompatible
 * point<->capability pair is denied. No I/O, no mocks — the catalog is pure.
 */

import { assert, assertEquals } from '@std/assert';
import {
  CAPABILITY_CATALOG,
  CAPABILITY_IDS,
  checkCapabilityGrant,
  EXTENSION_POINT_IDS,
  getCapability,
  getExtensionPoint,
} from '$shared/plugins/index.ts';

/**
 * Forbidden capability shapes. Anchored to segment boundaries (`^` or a `:._-` separator) so the
 * guard flags a token like `net`/`fs`/`write` while the benign substring "file" inside
 * `read:resolved-profile` (pro-FILE) does not false-match. Guards `CAPABILITY_IDS` against drift.
 */
const FORBIDDEN_CAPABILITY_SHAPE =
  /(?:^|[:._-])(?:credential|secret|auth|token|api.?key|net|http|fs|file|write|mutate|db)s?(?![a-z])/;

Deno.test('CAPABILITY_IDS is exactly the 4 observe-only read ids', () => {
  assertEquals<readonly string[]>(CAPABILITY_IDS, [
    'read:resolved-profile',
    'read:sync-preview',
    'read:custom-format',
    'read:config-validation',
  ]);
});

Deno.test('no CapabilityId has a credential/network/fs/write shape', () => {
  for (const id of CAPABILITY_IDS) {
    assertEquals(FORBIDDEN_CAPABILITY_SHAPE.test(id), false, `capability id ${id} must not match a forbidden shape`);
  }
});

Deno.test('every CapabilityId grants at least one declared extension point', () => {
  for (const id of CAPABILITY_IDS) {
    const grantsSomeDeclaredPoint = EXTENSION_POINT_IDS.some((point) => checkCapabilityGrant(point, id));
    assert(grantsSomeDeclaredPoint, `capability ${id} must grant at least one declared point`);
  }
});

Deno.test('no CapabilityId can consume a mutating point (least-privilege invariant)', () => {
  for (const id of CAPABILITY_IDS) {
    const descriptor = getCapability(id);
    assert(descriptor, `capability ${id} must have a descriptor`);
    for (const point of descriptor.compatiblePoints) {
      const extensionPoint = getExtensionPoint(point);
      assert(extensionPoint, `compatible point ${point} must be a declared extension point`);
      assertEquals(extensionPoint.mutates, false, `capability ${id} must not consume the mutating point ${point}`);
    }
  }
});

Deno.test('CAPABILITY_CATALOG covers every CapabilityId exactly once as {mutates:false, touchesSecrets:false}', () => {
  assertEquals(CAPABILITY_CATALOG.length, CAPABILITY_IDS.length);
  for (const id of CAPABILITY_IDS) {
    const matches = CAPABILITY_CATALOG.filter((descriptor) => descriptor.id === id);
    assertEquals(matches.length, 1, `capability ${id} must appear exactly once in the catalog`);
    assertEquals(matches[0].mutates, false);
    assertEquals(matches[0].touchesSecrets, false);
    assert(matches[0].compatiblePoints.length > 0, `capability ${id} must list at least one compatible point`);
  }
});

Deno.test('checkCapabilityGrant returns false for an incompatible point<->capability pair', () => {
  // read:resolved-profile only grants config.profileCompiled.observe.
  assertEquals(checkCapabilityGrant('sync.previewComputed.observe', 'read:resolved-profile'), false);
  assertEquals(checkCapabilityGrant('parser.releaseTitle.transform', 'read:resolved-profile'), false);
  // read:sync-preview never grants the config-compile point.
  assertEquals(checkCapabilityGrant('config.profileCompiled.observe', 'read:sync-preview'), false);
});

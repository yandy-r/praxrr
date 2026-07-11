/**
 * Pure tests for the plugin extension-point catalog (issue #35, Phase-1).
 *
 * Pins the wired-vs-declared contract: `EXTENSION_POINTS` and `EXTENSION_POINT_IDS` are a bijection
 * in stable order; exactly `config.profileCompiled.observe` + `sync.previewComputed.observe` are
 * `wired: true` and both are `observe` (no transform/provider is wired); every point stamps
 * `PLUGIN_API_VERSION` + `interfaceVersion`; and each descriptor's `requiredCapability` agrees, in
 * both directions, with the pinned capability<->point map in `capabilities.ts`. Getters round-trip.
 * No I/O, no mocks — the catalog is pure.
 */

import { assert, assertEquals } from '@std/assert';
import {
  CAPABILITY_IDS,
  checkCapabilityGrant,
  EXTENSION_POINT_IDS,
  EXTENSION_POINTS,
  getCapability,
  getExtensionPoint,
  listExtensionPoints,
  PLUGIN_API_VERSION,
  wiredObservePoints,
} from '$shared/plugins/index.ts';

const WIRED_POINT_IDS = ['config.profileCompiled.observe', 'sync.previewComputed.observe'];

Deno.test('EXTENSION_POINTS and EXTENSION_POINT_IDS are a bijection in stable order', () => {
  assertEquals(EXTENSION_POINTS.length, EXTENSION_POINT_IDS.length);
  EXTENSION_POINTS.forEach((point, index) => {
    assertEquals(point.id, EXTENSION_POINT_IDS[index], `point ${index} must be in stable order`);
  });
  // Every id resolves back to a descriptor (reverse direction).
  for (const id of EXTENSION_POINT_IDS) {
    assertEquals(getExtensionPoint(id)?.id, id);
  }
});

Deno.test('exactly the two observe points are wired', () => {
  const wired = EXTENSION_POINTS.filter((point) => point.wired);
  assertEquals(wired.length, 2);
  assertEquals(wired.map((point) => point.id).sort(), [...WIRED_POINT_IDS].sort());
  for (const point of wired) {
    assertEquals(point.kind, 'observe', `wired point ${point.id} must be an observe point`);
  }
});

Deno.test('no transform or provider point is wired', () => {
  for (const point of EXTENSION_POINTS) {
    if (point.kind !== 'observe') {
      assertEquals(point.wired, false, `${point.kind} point ${point.id} must not be wired`);
    }
  }
});

Deno.test('every extension point stamps PLUGIN_API_VERSION and interfaceVersion', () => {
  for (const point of EXTENSION_POINTS) {
    assertEquals(point.apiVersion, PLUGIN_API_VERSION, `${point.id} must stamp PLUGIN_API_VERSION`);
    assertEquals(point.interfaceVersion, '1', `${point.id} must stamp interfaceVersion '1'`);
  }
});

Deno.test('requiredCapability agrees with the capability compatiblePoints map (both directions)', () => {
  // Direction A: a point's declared requiredCapability must actually be able to consume it.
  for (const point of EXTENSION_POINTS) {
    if (point.requiredCapability !== null) {
      assertEquals(
        checkCapabilityGrant(point.id, point.requiredCapability),
        true,
        `${point.id} requiredCapability ${point.requiredCapability} must grant the point`
      );
    }
  }
  // Direction B: every point a capability lists must name that capability as its requiredCapability.
  for (const id of CAPABILITY_IDS) {
    const descriptor = getCapability(id);
    assert(descriptor, `capability ${id} must have a descriptor`);
    for (const pointId of descriptor.compatiblePoints) {
      assertEquals(
        getExtensionPoint(pointId)?.requiredCapability,
        id,
        `point ${pointId} must require capability ${id}`
      );
    }
  }
});

Deno.test('listExtensionPoints and wiredObservePoints round-trip the catalog', () => {
  assertEquals(listExtensionPoints(), EXTENSION_POINTS);

  const wiredObserve = wiredObservePoints();
  assertEquals(wiredObserve.map((point) => point.id).sort(), [...WIRED_POINT_IDS].sort());
  for (const point of wiredObserve) {
    assert(point.wired, `${point.id} must be wired`);
    assertEquals(point.kind, 'observe', `${point.id} must be an observe point`);
  }
});

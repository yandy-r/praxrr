import { assertEquals } from '@std/assert';
import { resolveArrTargets, ARR_TARGET_ORDER, type ArrConditionTargetType } from '$shared/arr/capabilities.ts';

Deno.test('resolveArrTargets: empty or undefined returns all', () => {
  assertEquals(resolveArrTargets(undefined), ['all']);
  assertEquals(resolveArrTargets(new Set()), ['all']);
});

Deno.test('resolveArrTargets: only all returns all', () => {
  assertEquals(resolveArrTargets(new Set(['all'])), ['all']);
});

Deno.test('resolveArrTargets: only app-specific returns that app', () => {
  assertEquals(resolveArrTargets(new Set(['sonarr'])), ['sonarr']);
  assertEquals(resolveArrTargets(new Set(['radarr'])), ['radarr']);
  assertEquals(resolveArrTargets(new Set(['lidarr'])), ['lidarr']);
});

Deno.test('resolveArrTargets: mixed all plus app-specific preserves both', () => {
  // Regression: format with arr_type=all condition + Sonarr-specific score override
  // must show both badges, not just Sonarr
  const targets = new Set<ArrConditionTargetType>(['all', 'sonarr']);
  assertEquals(resolveArrTargets(targets), ['all', 'sonarr']);
});

Deno.test('resolveArrTargets: multiple targets returns in ARR_TARGET_ORDER', () => {
  const targets = new Set<ArrConditionTargetType>(['lidarr', 'all', 'radarr']);
  assertEquals(resolveArrTargets(targets), ['all', 'radarr', 'lidarr']);
});

Deno.test('resolveArrTargets: all four targets returns full order', () => {
  const targets = new Set<ArrConditionTargetType>(['all', 'radarr', 'sonarr', 'lidarr']);
  assertEquals(resolveArrTargets(targets), [...ARR_TARGET_ORDER]);
});

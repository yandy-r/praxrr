/**
 * Shared current-vs-sandbox quality-profile config diff.
 *
 * Extracted from the impact-simulator route so both the impact simulator and Quality Goals preview
 * (#20) build the authoritative "what apply will write" diff through ONE implementation. Must be
 * called inside a `withSandboxCache` closure, before the sandbox cache is closed. Quality profiles
 * are arr-agnostic, so the resolved reads pass `arrType: undefined`.
 */

import type { PCDCache } from '$pcd/index.ts';
import { readEntityOrNull, computeUserOverrides } from '$pcd/resolved/layerDiff.ts';
import type { FieldChange } from '$sync/preview/types.ts';
import type { components } from '$api/v1.d.ts';

type EntityConfigDiff = components['schemas']['EntityConfigDiff'];

/**
 * `FieldChange.current`/`.desired` are internally typed `unknown`, while the generated
 * `EntityConfigDiff` schema types them as a closed JSON-value union — identical once serialized.
 */
function toWireChanges(changes: FieldChange[]): EntityConfigDiff['changes'] {
  return changes as unknown as EntityConfigDiff['changes'];
}

/** Build a per-profile config A/B diff (current-resolved vs sandbox-resolved) for each edited profile. */
export async function buildQualityProfileConfigDiff(
  currentCache: PCDCache,
  sandboxCache: PCDCache,
  arrType: 'radarr' | 'sonarr',
  profileNames: string[]
): Promise<EntityConfigDiff[]> {
  const result: EntityConfigDiff[] = [];
  for (const name of profileNames) {
    const current = await readEntityOrNull(currentCache, 'qualityProfile', undefined, name);
    const proposed = await readEntityOrNull(sandboxCache, 'qualityProfile', undefined, name);
    const changes = computeUserOverrides(current, proposed);
    result.push({ entityType: 'quality_profile', name, arrType, changes: toWireChanges(changes) });
  }
  return result;
}

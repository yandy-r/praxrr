/**
 * Dependency Graph — Node compatibility annotation
 *
 * Thin wrapper that stamps `compatibleArrTypes` on `quality_profile` and `quality` nodes.
 * Quality-profile compatibility routes through the existing single-pass
 * `computeProfileCompatibility` (basis: enabled qualities via `quality_api_mappings`,
 * never `arr_type='all'` scores) — no arr logic is re-derived here (Arr-Cutover guardrail).
 * Quality compatibility is the set of arr apps whose `quality_api_mappings` include the
 * quality.
 */

import type { PCDCache } from '$pcd/database/cache.ts';
import { computeProfileCompatibility } from '$pcd/entities/qualityProfiles/compatibility.ts';
import { ARR_APP_TYPES, type ArrAppType } from '$shared/arr/capabilities.ts';

/** `quality_profile` name -> the Arr apps it is compatible with. */
export async function getQualityProfileCompatibility(cache: PCDCache): Promise<Map<string, ArrAppType[]>> {
  const rows = await computeProfileCompatibility(cache);
  return new Map(rows.map((row) => [row.name, row.compatibleArrTypes]));
}

/** `quality` name -> the Arr apps whose `quality_api_mappings` support it. */
export async function getQualityCompatibility(cache: PCDCache): Promise<Map<string, ArrAppType[]>> {
  const rows = await cache.kb.selectFrom('quality_api_mappings').select(['quality_name', 'arr_type']).execute();

  const arrTypesByQuality = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!arrTypesByQuality.has(row.quality_name)) {
      arrTypesByQuality.set(row.quality_name, new Set());
    }
    arrTypesByQuality.get(row.quality_name)!.add(row.arr_type);
  }

  const result = new Map<string, ArrAppType[]>();
  for (const [qualityName, arrTypes] of arrTypesByQuality) {
    result.set(
      qualityName,
      ARR_APP_TYPES.filter((arrType) => arrTypes.has(arrType))
    );
  }
  return result;
}

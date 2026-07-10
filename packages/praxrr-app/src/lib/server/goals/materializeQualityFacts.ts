/**
 * Materialize per-Arr {@link GoalQualityFact}[] for the quality-ladder engine (issue #221).
 *
 * The read boundary between `quality_api_mappings` and the pure ladder engine, mirroring
 * {@link materializeCfFacts}. Each fact carries the EXACT-CASE PCD canonical `quality_name` (so it
 * matches `OrderedItem.name` from the qualities read) and the resolution resolved via
 * `QUALITIES[arrType][api_name]`. Fails fast (HTTP 422) — never silently skips — when a mapping row's
 * `api_name` has no `QUALITIES` entry, because that is a genuinely ambiguous mapping.
 *
 * Deliberately does NOT reuse `computeCompatibleProfileNames`, which lowercases names and skips
 * unresolved rows; both behaviors are wrong for a fact source.
 */

import { error } from '@sveltejs/kit';
import type { PCDCache } from '$pcd/index.ts';
import type { GoalArrType, GoalQualityFact } from '$shared/goals/index.ts';
import { QUALITIES } from '$sync/mappings.ts';

export async function materializeQualityFacts(cache: PCDCache, arrType: GoalArrType): Promise<GoalQualityFact[]> {
  const rows = await cache.kb
    .selectFrom('quality_api_mappings')
    .select(['quality_name', 'api_name'])
    .where('arr_type', '=', arrType)
    .execute();

  const resolutions = QUALITIES[arrType];
  const facts: GoalQualityFact[] = [];
  for (const row of rows) {
    const definition = resolutions[row.api_name];
    if (!definition) {
      throw error(
        422,
        `Ambiguous quality mapping for ${arrType}: "${row.quality_name}" maps to API quality "${row.api_name}", ` +
          'which has no known resolution. Refusing to derive a quality ladder.'
      );
    }
    facts.push({ name: row.quality_name, resolution: definition.resolution });
  }
  return facts;
}

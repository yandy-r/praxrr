/**
 * Quality profile / Arr-type compatibility
 *
 * Extracted from `list.ts` so the same enabled-quality compatibility algorithm can be
 * reused outside the table-row list query (e.g. cross-Arr parity checks). Behavior is
 * preserved verbatim from `list.ts` (see the `arrType` branch there) — do not "improve"
 * the control flow here without re-validating both callers.
 */

import type { PCDCache } from '$pcd/database/cache.ts';
import { ARR_APP_TYPES, type ArrAppType } from '$shared/arr/capabilities.ts';
import { QUALITIES } from '$sync/mappings.ts';

/**
 * Compute the set of quality profile names compatible with a given Arr type.
 *
 * A profile is compatible when either:
 * - all of its enabled qualities (direct or via quality groups) are supported by
 *   `arrType` (per `QUALITIES[arrType]` and `quality_api_mappings`), or
 * - it has no enabled qualities but owns an arr-specific custom format score for
 *   `arrType` (never falls back to `arr_type = 'all'` scores).
 */
export async function computeCompatibleProfileNames(cache: PCDCache, arrType: ArrAppType): Promise<Set<string>> {
  const db = cache.kb;

  const supportedRows = await db
    .selectFrom('quality_api_mappings')
    .select(['quality_name', 'api_name'])
    .where('arr_type', '=', arrType)
    .execute();

  const supportedApiNames = new Set(Object.keys(QUALITIES[arrType]));
  const supportedQualityNames = new Set<string>([...supportedApiNames].map((name) => name.toLowerCase()));

  for (const row of supportedRows) {
    const qualityName = row.quality_name?.trim();
    const apiName = row.api_name?.trim();

    if (!qualityName || !apiName) {
      continue;
    }

    if (!supportedApiNames.has(apiName)) {
      continue;
    }

    supportedQualityNames.add(qualityName.toLowerCase());
  }

  if (supportedQualityNames.size === 0) {
    return new Set();
  }

  const allProfileNames = (await db.selectFrom('quality_profiles').select(['name']).execute()).map(
    (profile) => profile.name
  );

  if (allProfileNames.length === 0) {
    return new Set();
  }

  const directEnabledRows = await db
    .selectFrom('quality_profile_qualities')
    .select(['quality_profile_name', 'quality_name'])
    .where('quality_profile_name', 'in', allProfileNames)
    .where('enabled', '=', 1)
    .where('quality_name', 'is not', null)
    .execute();

  const groupEnabledRows = await db
    .selectFrom('quality_profile_qualities as qpq')
    .innerJoin('quality_group_members as qgm', (join) =>
      join
        .onRef('qgm.quality_profile_name', '=', 'qpq.quality_profile_name')
        .onRef('qgm.quality_group_name', '=', 'qpq.quality_group_name')
    )
    .select(['qpq.quality_profile_name', 'qgm.quality_name'])
    .where('qpq.quality_profile_name', 'in', allProfileNames)
    .where('qpq.enabled', '=', 1)
    .where('qpq.quality_group_name', 'is not', null)
    .execute();

  const arrSpecificScoreRows = await db
    .selectFrom('quality_profile_custom_formats')
    .select(['quality_profile_name'])
    .where('quality_profile_name', 'in', allProfileNames)
    .where('arr_type', '=', arrType)
    .execute();
  const hasArrSpecificScores = new Set(arrSpecificScoreRows.map((row) => row.quality_profile_name));

  const enabledQualityNamesByProfile = new Map<string, Set<string>>();
  const addEnabledQualityName = (profileName: string, qualityName: string | null) => {
    if (!qualityName) return;
    if (!enabledQualityNamesByProfile.has(profileName)) {
      enabledQualityNamesByProfile.set(profileName, new Set());
    }
    enabledQualityNamesByProfile.get(profileName)!.add(qualityName.toLowerCase());
  };

  for (const row of directEnabledRows) {
    addEnabledQualityName(row.quality_profile_name, row.quality_name);
  }
  for (const row of groupEnabledRows) {
    addEnabledQualityName(row.quality_profile_name, row.quality_name);
  }

  const compatibleProfileNames = new Set<string>();
  for (const profileName of allProfileNames) {
    const enabledQualityNames = enabledQualityNamesByProfile.get(profileName);
    if (!enabledQualityNames || enabledQualityNames.size === 0) {
      // Fallback for profiles without enabled qualities: require explicit arr-specific score ownership.
      if (hasArrSpecificScores.has(profileName)) {
        compatibleProfileNames.add(profileName);
      }
      continue;
    }

    let isCompatible = true;
    for (const qualityName of enabledQualityNames) {
      if (!supportedQualityNames.has(qualityName)) {
        isCompatible = false;
        break;
      }
    }

    if (isCompatible) {
      compatibleProfileNames.add(profileName);
    }
  }

  return compatibleProfileNames;
}

/**
 * Per-profile compatibility summary across all Arr types.
 */
export interface ProfileCompatibility {
  name: string;
  compatibleArrTypes: ArrAppType[];
  basis: 'enabled-qualities';
}

/**
 * Compute compatibility for every quality profile in the cache, across all Arr types.
 * Iterates `ARR_APP_TYPES` explicitly per profile — no sibling-app fallback.
 */
export async function computeProfileCompatibility(cache: PCDCache): Promise<ProfileCompatibility[]> {
  const db = cache.kb;

  const profiles = await db.selectFrom('quality_profiles').select(['name']).orderBy('name').execute();

  const compatibleNamesByArrType = new Map<ArrAppType, Set<string>>();
  for (const arrType of ARR_APP_TYPES) {
    compatibleNamesByArrType.set(arrType, await computeCompatibleProfileNames(cache, arrType));
  }

  return profiles.map((profile) => ({
    name: profile.name,
    compatibleArrTypes: ARR_APP_TYPES.filter((arrType) => compatibleNamesByArrType.get(arrType)!.has(profile.name)),
    basis: 'enabled-qualities' as const,
  }));
}

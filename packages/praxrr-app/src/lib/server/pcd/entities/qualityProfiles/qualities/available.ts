/**
 * Quality profile "add quality" candidates for the qualities editor
 */

import type { PCDCache } from '$pcd/index.ts';
import type { QualitiesPageData, QualityMember } from '$shared/pcd/display.ts';
import { ARR_APP_TYPES } from '$shared/arr/capabilities.ts';
import { computeCompatibleProfileNames, getSupportedQualityNames } from '../compatibility.ts';

/**
 * Unused qualities the profile may add, restricted to qualities its compatible Arr apps support.
 *
 * Compatibility is resolved explicitly per `arr_type` (no sibling-app fallback). A profile
 * compatible with several apps (e.g. Radarr and Sonarr) is offered the UNION of those apps'
 * supported qualities: every candidate is valid for at least one app the profile can sync to, and
 * sync fills app-unsupported qualities as not allowed. A profile compatible with no app is offered
 * nothing (fail closed). Order and name casing follow `ladder.allQualities`.
 */
export async function availableQualityCandidates(
  cache: PCDCache,
  profileName: string,
  ladder: Pick<QualitiesPageData, 'orderedItems' | 'allQualities'>
): Promise<QualityMember[]> {
  const usedQualityNames = new Set<string>();
  for (const item of ladder.orderedItems) {
    if (item.type === 'quality') {
      usedQualityNames.add(item.name);
    } else {
      item.members?.forEach((member) => usedQualityNames.add(member.name));
    }
  }

  const unused = ladder.allQualities.filter((quality) => !usedQualityNames.has(quality.name));
  if (unused.length === 0) {
    return [];
  }

  const compatibleSupportedNames = new Set<string>();
  for (const arrType of ARR_APP_TYPES) {
    const supported = await getSupportedQualityNames(cache, arrType);
    const compatible = await computeCompatibleProfileNames(cache, arrType, [profileName], supported);
    if (!compatible.has(profileName)) continue;
    for (const name of supported) {
      compatibleSupportedNames.add(name);
    }
  }

  return unused
    .filter((quality) => compatibleSupportedNames.has(quality.name.toLowerCase()))
    .map((quality) => ({ name: quality.name }));
}

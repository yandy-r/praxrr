/**
 * Quality profile "add quality" candidates for the qualities editor
 */

import type { PCDCache } from '$pcd/index.ts';
import type { QualitiesPageData, QualityCandidates } from '$shared/pcd/display.ts';
import { ARR_APP_TYPES, type ArrAppType } from '$shared/arr/capabilities.ts';
import { computeCompatibleProfileNames, getSupportedQualityNames } from '../compatibility.ts';

/**
 * Unused qualities the profile may add, restricted to qualities its target Arr apps support.
 *
 * Target apps are resolved explicitly per `arr_type` (no sibling-app fallback):
 * 1. Apps for which `computeCompatibleProfileNames` accepts the profile (enabled qualities, or
 *    arr-specific scores when nothing is enabled).
 * 2. Otherwise, apps whose supported set contains EVERY stored ladder quality (enabled or not,
 *    including group members). A mixed-app ladder still resolves to no app.
 *
 * A profile with several target apps (e.g. Radarr and Sonarr) is offered the UNION of their
 * supported qualities; each candidate lists the target apps that support it so the editor can flag
 * app-specific additions. Sync fills app-unsupported qualities as not allowed. When no target app
 * resolves, nothing is offered and `arrTargetUnresolved` is set (fail closed). Order and name casing
 * follow `ladder.allQualities`.
 */
export async function availableQualityCandidates(
  cache: PCDCache,
  profileName: string,
  ladder: Pick<QualitiesPageData, 'orderedItems' | 'allQualities'>
): Promise<QualityCandidates> {
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
    return { candidates: [], targetArrTypes: [], arrTargetUnresolved: false };
  }

  const supportedByArrType = new Map<ArrAppType, Set<string>>();
  for (const arrType of ARR_APP_TYPES) {
    supportedByArrType.set(arrType, await getSupportedQualityNames(cache, arrType));
  }

  let targetArrTypes: ArrAppType[] = [];
  for (const arrType of ARR_APP_TYPES) {
    const supported = supportedByArrType.get(arrType)!;
    const compatible = await computeCompatibleProfileNames(cache, arrType, [profileName], supported);
    if (compatible.has(profileName)) targetArrTypes.push(arrType);
  }

  if (targetArrTypes.length === 0 && usedQualityNames.size > 0) {
    const storedNames = [...usedQualityNames].map((name) => name.toLowerCase());
    targetArrTypes = ARR_APP_TYPES.filter((arrType) => {
      const supported = supportedByArrType.get(arrType)!;
      return storedNames.every((name) => supported.has(name));
    });
  }

  if (targetArrTypes.length === 0) {
    return { candidates: [], targetArrTypes: [], arrTargetUnresolved: true };
  }

  const candidates: QualityCandidates['candidates'] = [];
  for (const quality of unused) {
    const lowerName = quality.name.toLowerCase();
    const arrTypes = targetArrTypes.filter((arrType) => supportedByArrType.get(arrType)!.has(lowerName));
    if (arrTypes.length > 0) {
      candidates.push({ name: quality.name, arrTypes });
    }
  }

  return { candidates, targetArrTypes, arrTargetUnresolved: false };
}

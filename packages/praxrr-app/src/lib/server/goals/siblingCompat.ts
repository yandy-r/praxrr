/**
 * Determine whether a goal's target quality profile is ALSO compatible with a sibling Arr (issue #221).
 *
 * `quality_profile_qualities` has no `arr_type` column, so a per-arr ceiling reshapes the ladder for
 * every Arr that syncs the profile. This flag drives the shared-ladder advisory surfaced in preview
 * and the decision log — it never gates application (shared profiles are a legitimate configuration).
 * Uses the case-insensitive compatibility check (not the exact-case fact source), which is correct here.
 */

import type { PCDCache } from '$pcd/index.ts';
import { ARR_APP_TYPES } from '$shared/arr/capabilities.ts';
import { computeCompatibleProfileNames } from '$pcd/entities/qualityProfiles/compatibility.ts';
import type { GoalRequest } from './planRequest.ts';

export async function isProfileCompatibleWithSiblingArr(cache: PCDCache, request: GoalRequest): Promise<boolean> {
  const siblings = ARR_APP_TYPES.filter((arrType) => arrType !== request.arrType);
  for (const sibling of siblings) {
    const compatible = await computeCompatibleProfileNames(cache, sibling, [request.profileName]);
    if (compatible.has(request.profileName)) return true;
  }
  return false;
}

/**
 * Shared quality-profile scoring threshold state.
 *
 * A release's total custom-format score is compared against a profile's
 * minimum and upgrade-until thresholds to classify its acceptance state.
 * Used by the impact simulator (client + server) so both sides agree.
 */

export type ThresholdState = 'below' | 'accepted' | 'upgrade-reached';

/**
 * Classify a total score against a profile's thresholds.
 *
 * - `total < minimumScore` → `below` (release rejected)
 * - `total >= upgradeUntilScore` → `upgrade-reached` (no further upgrades sought)
 * - otherwise → `accepted` (accepted, still upgradable)
 */
export function resolveThresholdState(total: number, minimumScore: number, upgradeUntilScore: number): ThresholdState {
  if (total < minimumScore) return 'below';
  if (total >= upgradeUntilScore) return 'upgrade-reached';
  return 'accepted';
}

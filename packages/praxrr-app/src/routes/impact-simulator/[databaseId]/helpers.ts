import type { components } from '$api/v1.d.ts';
import { resolveThresholdState, type ThresholdState } from '$shared/pcd/threshold.ts';

export { resolveThresholdState };
export type { ThresholdState };

type SimulateReleaseInput = components['schemas']['SimulateReleaseInput'];
type ProposedChange = components['schemas']['ProposedChange'];
type SetCfScoreChange = components['schemas']['SetCfScoreChange'];
type SetProfileSettingChange = components['schemas']['SetProfileSettingChange'];

export type ImpactArrType = components['schemas']['SimulateImpactRequest']['arrType'];
export type ReleaseType = components['schemas']['SimulateReleaseInput']['type'];
export type ProfileSettingField = SetProfileSettingChange['field'];

export type ImpactProfileOption = {
  id: number;
  name: string;
  value: string;
  displayName: string;
  editable: boolean;
};

const MAX_BATCH_TITLES = 50;
const MAX_TITLE_LENGTH = 500;
let releaseIdCounter = 0;

function createReleaseId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  releaseIdCounter += 1;
  return `release-${Date.now()}-${releaseIdCounter}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Map the request `arrType` to the per-release `type` the parser expects. */
export function resolveReleaseType(arrType: ImpactArrType): ReleaseType {
  return arrType === 'radarr' ? 'movie' : 'series';
}

/**
 * Parse a newline-delimited textarea into release inputs (cap 50, generated ids),
 * mirroring the score-simulator batch parser but keyed off the request arrType.
 */
export function parseReleaseTitles(rawText: string, arrType: ImpactArrType): SimulateReleaseInput[] {
  if (!rawText.trim()) {
    return [];
  }

  const releaseType = resolveReleaseType(arrType);
  const results: SimulateReleaseInput[] = [];

  for (const line of rawText.split('\n')) {
    if (results.length >= MAX_BATCH_TITLES) {
      break;
    }

    const trimmed = line.trim();
    if (!trimmed || trimmed.length > MAX_TITLE_LENGTH) {
      continue;
    }

    results.push({ id: createReleaseId(), title: trimmed, type: releaseType });
  }

  return results;
}

/** Format a signed delta for display (`+5`, `-3`, `0`). */
export function formatDelta(delta: number): string {
  if (delta > 0) {
    return `+${delta}`;
  }

  return `${delta}`;
}

/** Tailwind text-color class for a delta (green up, red down, neutral zero). */
export function deltaColorClass(delta: number): string {
  if (delta > 0) {
    return 'text-emerald-600 dark:text-emerald-400';
  }

  if (delta < 0) {
    return 'text-red-600 dark:text-red-400';
  }

  return 'text-neutral-500 dark:text-neutral-400';
}

export function thresholdStateLabel(state: ThresholdState): string {
  switch (state) {
    case 'below':
      return 'Below minimum';
    case 'upgrade-reached':
      return 'Upgrade reached';
    default:
      return 'Accepted';
  }
}

export type ThresholdBadgeVariant = 'danger' | 'success' | 'info';

export function thresholdStateBadgeVariant(state: ThresholdState): ThresholdBadgeVariant {
  switch (state) {
    case 'below':
      return 'danger';
    case 'upgrade-reached':
      return 'success';
    default:
      return 'info';
  }
}

/** The set of profile setting fields the editor exposes, in display order. */
export const PROFILE_SETTING_FIELDS: readonly { field: ProfileSettingField; label: string; hint: string }[] = [
  { field: 'minimum_custom_format_score', label: 'Minimum Score', hint: 'Reject releases below this total' },
  { field: 'upgrade_until_score', label: 'Upgrade Until Score', hint: 'Stop upgrading once reached' },
  { field: 'upgrade_score_increment', label: 'Upgrade Score Increment', hint: 'Minimum improvement to upgrade' },
];

/** Narrow a `ProposedChange` union member to a CF-score change. */
export function isSetCfScoreChange(change: ProposedChange): change is SetCfScoreChange {
  return change.kind === 'set_cf_score';
}

/** Narrow a `ProposedChange` union member to a profile-setting change. */
export function isSetProfileSettingChange(change: ProposedChange): change is SetProfileSettingChange {
  return change.kind === 'set_profile_setting';
}

/** Human-readable one-line summary of a proposed change (used in skipped/applied lists). */
export function describeChange(change: ProposedChange): string {
  if (isSetCfScoreChange(change)) {
    return `${change.profileName}: set "${change.customFormatName}" score to ${change.score}`;
  }

  return `${change.profileName}: set ${change.field} to ${change.value}`;
}

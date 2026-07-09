/**
 * Quality Goals presets (issue #20).
 *
 * The 4 built-in goals. Each is a point in the same continuous slider space — the identical policy
 * table produces every preset's score map by varying only the weight vector, which is what makes the
 * slider goal-diff meaningful. `baseUpgrade` anchors the profile's upgrade-until threshold.
 */

import type { GoalPresetId, GoalWeights } from './types.ts';

export interface GoalPreset {
  id: GoalPresetId;
  label: string;
  description: string;
  weights: GoalWeights;
  /** Upgrade-until anchor before the quality-vs-size adjustment (see `computeThresholds`). */
  baseUpgrade: number;
}

export const GOAL_PRESETS: readonly GoalPreset[] = [
  {
    id: 'best-quality',
    label: 'Best Quality',
    description: 'Maximum fidelity — remux and lossless audio, up to 2160p, compatibility is secondary.',
    weights: { qualityVsSize: 100, compatibility: 30, hdrPreference: 70, unwantedStrictness: 85, resolutionCeiling: '2160p' },
    baseUpgrade: 1000
  },
  {
    id: 'smallest-size',
    label: 'Smallest Size',
    description: 'Favor efficient, widely-playable encodes and cap at 1080p to keep files small.',
    weights: { qualityVsSize: 0, compatibility: 70, hdrPreference: 40, unwantedStrictness: 85, resolutionCeiling: '1080p' },
    baseUpgrade: 300
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'A sensible middle ground between fidelity and size, capped at 1080p.',
    weights: { qualityVsSize: 50, compatibility: 55, hdrPreference: 50, unwantedStrictness: 80, resolutionCeiling: '1080p' },
    baseUpgrade: 600
  },
  {
    id: '4k-hdr-priority',
    label: '4K HDR Priority',
    description: 'Prioritize 2160p HDR (Dolby Vision, HDR10+) above all else; size is not a concern.',
    weights: { qualityVsSize: 80, compatibility: 20, hdrPreference: 100, unwantedStrictness: 85, resolutionCeiling: '2160p' },
    baseUpgrade: 1000
  }
];

const PRESET_BY_ID = new Map<GoalPresetId, GoalPreset>(GOAL_PRESETS.map((preset) => [preset.id, preset]));

/** Look up a preset by id, or `undefined` for an unknown id. */
export function resolvePreset(id: string): GoalPreset | undefined {
  return PRESET_BY_ID.get(id as GoalPresetId);
}

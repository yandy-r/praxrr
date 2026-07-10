/**
 * Quality Goals presets (issue #20).
 *
 * The 4 built-in goals. Each is a point in the same continuous slider space — the identical policy
 * table produces every preset's score map by varying only the weight vector, which is what makes the
 * slider goal-diff meaningful. `baseUpgrade` anchors the profile's upgrade-until threshold.
 */

import { SLIDER_AXES } from './types.ts';
import type { GoalArrType, GoalAxisMeta, GoalPresetId, GoalWeights } from './types.ts';

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
    weights: {
      qualityVsSize: 100,
      compatibility: 30,
      hdrPreference: 70,
      unwantedStrictness: 85,
      resolutionCeiling: '2160p',
    },
    baseUpgrade: 1000,
  },
  {
    id: 'smallest-size',
    label: 'Smallest Size',
    description: 'Favor efficient, widely-playable encodes and cap at 1080p to keep files small.',
    weights: {
      qualityVsSize: 0,
      compatibility: 70,
      hdrPreference: 40,
      unwantedStrictness: 85,
      resolutionCeiling: '1080p',
    },
    baseUpgrade: 300,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'A sensible middle ground between fidelity and size, capped at 1080p.',
    weights: {
      qualityVsSize: 50,
      compatibility: 55,
      hdrPreference: 50,
      unwantedStrictness: 80,
      resolutionCeiling: '1080p',
    },
    baseUpgrade: 600,
  },
  {
    id: '4k-hdr-priority',
    label: '4K HDR Priority',
    description: 'Prioritize 2160p HDR (Dolby Vision, HDR10+) above all else; size is not a concern.',
    weights: {
      qualityVsSize: 80,
      compatibility: 20,
      hdrPreference: 100,
      unwantedStrictness: 85,
      resolutionCeiling: '2160p',
    },
    baseUpgrade: 1000,
  },
  // Audio goals for Lidarr (#222). Only qualityVsSize / compatibility / unwantedStrictness carry audio
  // meaning; hdrPreference (50 = neutral) and resolutionCeiling are inert for lidarr but present so the
  // shared GoalWeights validator (`parseWeights`) accepts the body.
  {
    id: 'audio-lossless-priority',
    label: 'Lossless Priority',
    description: 'Prefer lossless masters (FLAC/ALAC); size and universal compatibility are secondary.',
    weights: {
      qualityVsSize: 100,
      compatibility: 20,
      hdrPreference: 50,
      unwantedStrictness: 85,
      resolutionCeiling: '1080p',
    },
    baseUpgrade: 800,
  },
  {
    id: 'audio-balanced',
    label: 'Balanced Audio',
    description: 'A sensible middle ground between lossless fidelity and widely-playable lossy encodes.',
    weights: {
      qualityVsSize: 50,
      compatibility: 55,
      hdrPreference: 50,
      unwantedStrictness: 80,
      resolutionCeiling: '1080p',
    },
    baseUpgrade: 500,
  },
  {
    id: 'audio-space-saver',
    label: 'Space Saver',
    description: 'Favor efficient, universally-playable lossy audio (AAC/Opus) to keep libraries small.',
    weights: {
      qualityVsSize: 0,
      compatibility: 80,
      hdrPreference: 50,
      unwantedStrictness: 85,
      resolutionCeiling: '1080p',
    },
    baseUpgrade: 200,
  },
];

/** Preset ids that belong to the Lidarr audio domain (#222). */
const AUDIO_PRESET_IDS: ReadonlySet<GoalPresetId> = new Set([
  'audio-lossless-priority',
  'audio-balanced',
  'audio-space-saver',
]);

const PRESET_BY_ID = new Map<GoalPresetId, GoalPreset>(GOAL_PRESETS.map((preset) => [preset.id, preset]));

/** Look up a preset by id, or `undefined` for an unknown id. */
export function resolvePreset(id: string): GoalPreset | undefined {
  return PRESET_BY_ID.get(id as GoalPresetId);
}

/** Presets offered for an Arr type: the 3 audio presets for Lidarr (#222), the 4 video presets otherwise. */
export function presetsForArrType(arrType: GoalArrType): readonly GoalPreset[] {
  const wantAudio = arrType === 'lidarr';
  return GOAL_PRESETS.filter((preset) => AUDIO_PRESET_IDS.has(preset.id) === wantAudio);
}

/** Slider axes for an Arr type: Lidarr hides the video-only `hdrPreference` + `resolutionCeiling` axes. */
export function axesForArrType(arrType: GoalArrType): readonly GoalAxisMeta[] {
  if (arrType !== 'lidarr') return SLIDER_AXES;
  return SLIDER_AXES.filter((axis) => axis.key !== 'hdrPreference' && axis.key !== 'resolutionCeiling');
}

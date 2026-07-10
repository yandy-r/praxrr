import { json, type RequestHandler } from '@sveltejs/kit';
import { presetsForArrType, axesForArrType, GOALS_ENGINE_VERSION } from '$shared/goals/index.ts';
import type { GoalArrType } from '$shared/goals/index.ts';
import type { components } from '$api/v1.d.ts';

type GoalPresetsResponse = components['schemas']['GoalPresetsResponse'];

/**
 * GET /api/v1/goals/presets?arrType= — the preset catalog + slider-axis metadata + engine version.
 * `arrType` scopes the response: `lidarr` returns the audio presets and hides the video-only
 * `hdrPreference`/`resolutionCeiling` axes (#222); omitted/radarr/sonarr returns the video presets so
 * existing callers are unaffected.
 */
export const GET: RequestHandler = ({ url }) => {
  const rawArrType = url?.searchParams.get('arrType') ?? null;
  const arrType: GoalArrType = rawArrType === 'lidarr' ? 'lidarr' : rawArrType === 'sonarr' ? 'sonarr' : 'radarr';

  const response: GoalPresetsResponse = {
    presets: presetsForArrType(arrType).map((preset) => ({
      id: preset.id,
      label: preset.label,
      description: preset.description,
      weights: preset.weights,
    })),
    axes: axesForArrType(arrType).map((axis) => ({
      key: axis.key,
      label: axis.label,
      kind: axis.kind,
      ...(axis.min !== undefined ? { min: axis.min } : {}),
      ...(axis.max !== undefined ? { max: axis.max } : {}),
      ...(axis.step !== undefined ? { step: axis.step } : {}),
      ...(axis.options !== undefined ? { options: [...axis.options] } : {}),
      description: axis.description,
    })),
    engineVersion: GOALS_ENGINE_VERSION,
  };
  return json(response);
};

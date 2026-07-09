import { json, type RequestHandler } from '@sveltejs/kit';
import { GOAL_PRESETS, SLIDER_AXES, GOALS_ENGINE_VERSION } from '$shared/goals/index.ts';
import type { components } from '$api/v1.d.ts';

type GoalPresetsResponse = components['schemas']['GoalPresetsResponse'];

/** GET /api/v1/goals/presets — the preset catalog + slider-axis metadata + engine version. */
export const GET: RequestHandler = () => {
  const response: GoalPresetsResponse = {
    presets: GOAL_PRESETS.map((preset) => ({
      id: preset.id,
      label: preset.label,
      description: preset.description,
      weights: preset.weights
    })),
    axes: SLIDER_AXES.map((axis) => ({
      key: axis.key,
      label: axis.label,
      kind: axis.kind,
      ...(axis.min !== undefined ? { min: axis.min } : {}),
      ...(axis.max !== undefined ? { max: axis.max } : {}),
      ...(axis.step !== undefined ? { step: axis.step } : {}),
      ...(axis.options !== undefined ? { options: [...axis.options] } : {}),
      description: axis.description
    })),
    engineVersion: GOALS_ENGINE_VERSION
  };
  return json(response);
};

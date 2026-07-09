/**
 * Shared request parsing + plan building for the Quality Goals preview/apply routes (issue #20).
 *
 * Both routes validate the same body, resolve the target cache/profile, materialize CF facts, and run
 * the pure engine — so it lives here once. Validation throws SvelteKit `error()` (impact-route style).
 */

import { error } from '@sveltejs/kit';
import { pcdManager, type PCDCache } from '$pcd/index.ts';
import { computeGoalPlan, resolvePreset, GOAL_RESOLUTION_CEILINGS } from '$shared/goals/index.ts';
import type { GoalArrType, GoalPlan, GoalResolutionCeiling, GoalWeights } from '$shared/goals/index.ts';
import { materializeCfFacts } from './materializeCfFacts.ts';

function isGoalArrType(value: unknown): value is GoalArrType {
  return value === 'radarr' || value === 'sonarr';
}

/** Validate and narrow a `GoalWeights` object, throwing a 400 on any bad field. */
export function parseWeights(raw: unknown): GoalWeights {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw error(400, 'weights must be an object');
  }
  const weights = raw as Record<string, unknown>;
  const axis = (key: string): number => {
    const value = weights[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) {
      throw error(400, `weights.${key} must be an integer between 0 and 100`);
    }
    return value;
  };
  const ceiling = weights.resolutionCeiling;
  if (!GOAL_RESOLUTION_CEILINGS.includes(ceiling as GoalResolutionCeiling)) {
    throw error(400, `weights.resolutionCeiling must be one of: ${GOAL_RESOLUTION_CEILINGS.join(', ')}`);
  }
  return {
    qualityVsSize: axis('qualityVsSize'),
    compatibility: axis('compatibility'),
    hdrPreference: axis('hdrPreference'),
    unwantedStrictness: axis('unwantedStrictness'),
    resolutionCeiling: ceiling as GoalResolutionCeiling
  };
}

export interface GoalRequest {
  databaseId: number;
  arrType: GoalArrType;
  profileName: string;
  presetId: string;
  weights: GoalWeights;
}

/** Read and shallow-validate a JSON object request body, throwing 400 on malformed input. */
export async function readJsonObjectBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid request body: expected valid JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw error(400, 'Invalid request body: expected a JSON object');
  }
  return body as Record<string, unknown>;
}

/** Parse + validate a preview/apply request body (shared fields), throwing 400 on any problem. */
export function parseGoalRequest(candidate: Record<string, unknown>): GoalRequest {
  if (typeof candidate.databaseId !== 'number' || !Number.isFinite(candidate.databaseId)) {
    throw error(400, 'databaseId must be a finite number');
  }
  if (!isGoalArrType(candidate.arrType)) {
    throw error(400, 'arrType must be one of: radarr, sonarr');
  }
  if (typeof candidate.profileName !== 'string' || candidate.profileName.trim() === '') {
    throw error(400, 'profileName must be a non-empty string');
  }
  if (typeof candidate.preset !== 'string' || !resolvePreset(candidate.preset)) {
    throw error(400, 'preset must be a known goal preset id');
  }

  return {
    databaseId: candidate.databaseId,
    arrType: candidate.arrType,
    profileName: candidate.profileName,
    presetId: candidate.preset,
    weights: parseWeights(candidate.weights)
  };
}

/** Resolve the cache, assert the profile exists, and run the pure engine for a request. */
export async function buildGoalPlan(request: GoalRequest): Promise<{ cache: PCDCache; plan: GoalPlan }> {
  const cache = pcdManager.getCache(request.databaseId);
  if (!cache) {
    throw error(404, 'Database not found or cache not available');
  }

  const profile = await cache.kb
    .selectFrom('quality_profiles')
    .select('name')
    .where('name', '=', request.profileName)
    .executeTakeFirst();
  if (!profile) {
    throw error(404, `Quality profile "${request.profileName}" not found`);
  }

  const preset = resolvePreset(request.presetId)!;
  const customFormats = await materializeCfFacts(cache);
  const plan = computeGoalPlan({
    arrType: request.arrType,
    weights: request.weights,
    presetBaseUpgrade: preset.baseUpgrade,
    customFormats
  });

  return { cache, plan };
}

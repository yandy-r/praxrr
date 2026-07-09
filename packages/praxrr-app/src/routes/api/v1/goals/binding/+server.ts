import { json, error, type RequestHandler } from '@sveltejs/kit';
import { qualityGoalBindingQueries } from '$db/queries/qualityGoalBindings.ts';
import { toWireBinding } from '$lib/server/goals/responses.ts';
import type { components } from '$api/v1.d.ts';

type GoalBindingResponse = components['schemas']['GoalBindingResponse'];

/**
 * GET /api/v1/goals/binding?databaseId=&profileName=&arrType= — the persisted goal binding for a
 * profile, or `{ binding: null }` when the profile is not goal-governed.
 */
export const GET: RequestHandler = ({ url }) => {
  const rawDatabaseId = url.searchParams.get('databaseId');
  const profileName = url.searchParams.get('profileName');
  const arrType = url.searchParams.get('arrType');

  const databaseId = Number(rawDatabaseId);
  if (rawDatabaseId === null || !Number.isInteger(databaseId)) {
    throw error(400, 'databaseId query parameter must be an integer');
  }
  if (profileName === null || profileName.trim() === '') {
    throw error(400, 'profileName query parameter is required');
  }
  if (arrType !== 'radarr' && arrType !== 'sonarr') {
    throw error(400, 'arrType query parameter must be one of: radarr, sonarr');
  }

  const row = qualityGoalBindingQueries.get(databaseId, profileName, arrType);

  return json({ binding: row ? toWireBinding(row) : null } satisfies GoalBindingResponse);
};

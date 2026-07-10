import { json, error, type RequestHandler } from '@sveltejs/kit';
import { qualityGoalApplyJournalQueries } from '$db/queries/qualityGoalApplyJournal.ts';
import { mapJournalRowToApplyStatus } from '$lib/server/goals/applyStatus.ts';
import type { components } from '$api/v1.d.ts';

type GoalApplyStatus = components['schemas']['GoalApplyStatus'];

/**
 * GET /api/v1/goals/apply/status?databaseId=&profileName=&arrType= — the latest apply-journal outcome
 * for a profile target, or `{ applyStatus: null }` when none has ever been attempted (issue #236). This
 * out-of-band surface reports a failed or pending apply even when it never wrote a binding — which the
 * binding GET (which 404s with no binding row) cannot express.
 */
export const GET: RequestHandler = ({ url }) => {
  const rawDatabaseId = url.searchParams.get('databaseId');
  const profileName = url.searchParams.get('profileName');
  const arrType = url.searchParams.get('arrType');

  const databaseId = Number(rawDatabaseId);
  if (rawDatabaseId === null || rawDatabaseId.trim() === '' || !Number.isInteger(databaseId)) {
    throw error(400, 'databaseId query parameter must be an integer');
  }
  if (profileName === null || profileName.trim() === '') {
    throw error(400, 'profileName query parameter is required');
  }
  if (arrType !== 'radarr' && arrType !== 'sonarr' && arrType !== 'lidarr') {
    throw error(400, 'arrType query parameter must be one of: radarr, sonarr, lidarr');
  }

  const row = qualityGoalApplyJournalQueries.getLatest(databaseId, profileName, arrType);

  return json({ applyStatus: row ? mapJournalRowToApplyStatus(row) : null } satisfies {
    applyStatus: GoalApplyStatus | null;
  });
};

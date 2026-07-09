import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { parseTimelineFilters, parseTimelinePagination } from '$lib/server/timeline/filters.ts';
import { TimelineHttpError } from '$lib/server/timeline/errors.ts';
import { listTimeline } from '$lib/server/timeline/service.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };

/**
 * GET /api/v1/timeline
 *
 * Merged, paginated archaeology feed over the four read-only event sources (sync runs, PCD
 * snapshots, rollbacks, canary rollouts), newest first, with annotations hydrated inline. Filters
 * gate which sources are included (fail-closed); contradictory scope combinations return 400.
 */
export const GET: RequestHandler = async ({ url }) => {
  try {
    const filters = parseTimelineFilters(url);
    const pagination = parseTimelinePagination(url);
    return json(listTimeline(filters, pagination));
  } catch (error) {
    if (error instanceof TimelineHttpError) {
      return json({ error: error.message } satisfies ErrorResponse, { status: error.status });
    }
    await logger.error('Failed to list timeline', {
      source: 'TimelineListRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to list timeline' } satisfies ErrorResponse, { status: 500 });
  }
};

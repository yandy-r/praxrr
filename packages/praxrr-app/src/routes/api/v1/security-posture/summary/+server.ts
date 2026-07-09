import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { computeShield } from '$lib/server/security/service.ts';
import { toSummaryResponse, type SecurityPostureSummaryResponse } from '$lib/server/security/responses.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };

/**
 * GET /api/v1/security-posture/summary
 *
 * The live shield report for this deployment: overall score + band (with any critical band-cap),
 * per-check breakdown, the per-instance transport table, always-on assurances, unscored advisories,
 * and the ranked "to reach Hardened" actions. Read-only, on-demand, zero network I/O; never returns a
 * secret value. Degraded/not-applicable states ride in the 200 body (per-check `score:null`); this
 * returns 500 only on an internal error.
 */
export const GET: RequestHandler = async () => {
  try {
    const report = computeShield();
    return json(toSummaryResponse(report) satisfies SecurityPostureSummaryResponse);
  } catch (error) {
    await logger.error('Failed to build security posture summary', {
      source: 'SecurityPostureSummaryRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to build security posture summary' } satisfies ErrorResponse, { status: 500 });
  }
};

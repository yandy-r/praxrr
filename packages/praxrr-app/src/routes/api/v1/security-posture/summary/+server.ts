import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { computeShield } from '$lib/server/security/service.ts';
import { toSummaryResponse, type SecurityPostureSummaryResponse } from '$lib/server/security/responses.ts';
import { logger } from '$logger/logger.ts';

type ErrorResponse = { error: string };
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

/**
 * GET /api/v1/security-posture/summary
 *
 * The live shield report for this deployment: overall score + band (with any critical band-cap),
 * per-check breakdown, the per-instance transport table, always-on assurances, unscored advisories,
 * and the ranked "to reach Hardened" actions. Read-only and on-demand: eligible unknown HTTP hosts
 * receive bounded, report-only DNS evidence. This is not a reachability probe and never controls an
 * Arr connection. Secret values never cross the response boundary. DNS timeout/failure/budget states
 * ride in the 200 body; this returns 500 only for an unrelated report-construction error.
 */
export const GET: RequestHandler = async (event) => {
  try {
    const report = await computeShield(event);
    return json(toSummaryResponse(report) satisfies SecurityPostureSummaryResponse, { headers: NO_STORE_HEADERS });
  } catch (error) {
    await logger.error('Failed to build security posture summary', {
      source: 'SecurityPostureSummaryRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to build security posture summary' } satisfies ErrorResponse, {
      status: 500,
      headers: NO_STORE_HEADERS,
    });
  }
};

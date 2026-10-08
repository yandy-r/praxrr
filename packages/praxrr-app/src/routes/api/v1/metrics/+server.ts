import type { RequestHandler } from '@sveltejs/kit';
import { config } from '$config';
import { collectMetrics } from '$lib/server/metrics/collect.ts';

/**
 * GET /api/v1/metrics — Prometheus text exposition (format version 0.0.4).
 *
 * Gated by METRICS_ENABLED (default off → 404 with null body, mirroring the MCP route).
 * Auth is enforced by the central hook (this route is NOT in PUBLIC_PATHS), so a
 * programmatic scraper sends `X-Api-Key` or a session cookie.
 */
export const GET: RequestHandler = async () => {
  if (!config.metricsEnabled) {
    return new Response(null, { status: 404 });
  }
  const body = await collectMetrics();
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
};

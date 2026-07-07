import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { assertSetupInProgress } from '$server/setup/progress.ts';
import { getClientIp } from '$auth/network.ts';
import { registerRateLimitAttempt } from '$utils/rateLimit.ts';
import { assertSafeArrUrl } from '$arr/urlSafety.ts';
import { createArrClient } from '$arr/factory.ts';
import type { ArrType } from '$arr/types.ts';

const VALID_TYPES = ['radarr', 'sonarr', 'lidarr'];

/** Sanitized failure reasons returned to the client; never leak raw error details. */
type TestConnectionReason = 'unreachable' | 'unauthorized' | 'invalid_response' | 'timeout';

/**
 * Map an internal error to a sanitized reason string so response bodies never
 * echo raw error messages (which may include internal hostnames/paths).
 */
function toFailureReason(error: unknown): TestConnectionReason {
  const message = error instanceof Error ? error.message : '';

  if (/timeout/i.test(message)) return 'timeout';
  if (/HTTP 401|HTTP 403/i.test(message)) return 'unauthorized';
  if (/HTTP \d/i.test(message)) return 'invalid_response';
  return 'unreachable';
}

/**
 * POST /api/v1/setup/test-connection
 *
 * Validate Arr connection credentials during the setup wizard by creating a
 * client and testing reachability, without persisting an instance. Locked
 * down by `assertSetupInProgress` once setup is completed/dismissed, and
 * rate-limited per client IP so it cannot be used as an SSRF/port-scan oracle.
 *
 * Body:
 * - type: `radarr`, `sonarr`, or `lidarr`
 * - url: Arr base URL
 * - apiKey: Arr API key
 */
export const POST: RequestHandler = async (event) => {
  assertSetupInProgress();

  const clientIp = getClientIp(event);
  if (!registerRateLimitAttempt(clientIp)) {
    return json({ success: false, reason: 'rate_limited' }, { status: 429 });
  }

  let client;
  try {
    const body = await event.request.json();
    const type = body?.type;
    const url = body?.url;
    const apiKey = body?.apiKey;

    if (typeof type !== 'string' || typeof url !== 'string' || typeof apiKey !== 'string') {
      return json({ success: false, reason: 'invalid_response' }, { status: 400 });
    }

    if (!VALID_TYPES.includes(type)) {
      return json({ success: false, reason: 'invalid_response' }, { status: 400 });
    }

    if (!url.trim() || !apiKey.trim()) {
      return json({ success: false, reason: 'invalid_response' }, { status: 400 });
    }

    // Reject metadata/link-local targets before we ever construct a client.
    try {
      assertSafeArrUrl(url);
    } catch {
      return json({ success: false, reason: 'unreachable' }, { status: 400 });
    }

    // 3 second timeout, no retries: this is a quick-feedback probe, not a sync.
    client = createArrClient(type as ArrType, url, apiKey, { timeout: 3000, retries: 0 });
    const status = await client.getSystemStatus();

    if (!status) {
      return json({ success: false, reason: 'unreachable' });
    }

    return json({ success: true, appName: status.appName, version: status.version });
  } catch (error) {
    return json(
      {
        success: false,
        reason: toFailureReason(error),
      },
      { status: 500 }
    );
  } finally {
    client?.close();
  }
};

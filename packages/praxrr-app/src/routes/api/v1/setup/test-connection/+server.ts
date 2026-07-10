import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { assertSetupInProgress } from '$server/setup/progress.ts';
import { getClientIp } from '$auth/network.ts';
import { registerRateLimitAttempt } from '$utils/rateLimit.ts';
import { assertSafeArrUrl } from '$arr/urlSafety.ts';
import { createArrClient } from '$arr/factory.ts';
import { reasonFromStatus, toFailureReason } from '$arr/testConnectionReason.ts';
import type { ArrType } from '$arr/types.ts';

const VALID_TYPES = ['radarr', 'sonarr', 'lidarr'];

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

  // getClientIp honors forwarded headers only from a peer in the TRUSTED_PROXY allowlist (issue #228);
  // an untrusted peer's forged X-Forwarded-For is ignored, so this rate-limit key is the real socket
  // peer. Still defense-in-depth, not a substitute for network-level rate limiting.
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
    const result = await client.getSystemStatus();

    if (!result.ok) {
      return json({ success: false, reason: reasonFromStatus(result.status) });
    }

    return json({ success: true, appName: result.appName, version: result.version });
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

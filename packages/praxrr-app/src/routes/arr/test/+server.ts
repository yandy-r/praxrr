import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { createArrClient } from '$arr/factory.ts';
import { assertSafeArrUrl } from '$arr/urlSafety.ts';
import type { ArrType } from '$arr/types.ts';

const VALID_TYPES = ['radarr', 'sonarr', 'lidarr'];

/** Sanitized failure reasons returned to the client; never leak raw error details. */
type TestFailureReason = 'unreachable' | 'unauthorized' | 'invalid_response' | 'timeout';

/**
 * Map an internal error to a sanitized reason string so response bodies never
 * echo raw error messages (which may include internal hostnames/paths).
 */
function toFailureReason(error: unknown): TestFailureReason {
  const message = error instanceof Error ? error.message : '';

  if (/timeout/i.test(message)) return 'timeout';
  if (/HTTP 401|HTTP 403/i.test(message)) return 'unauthorized';
  if (/HTTP \d/i.test(message)) return 'invalid_response';
  return 'unreachable';
}

/**
 * POST /arr/test
 *
 * Validate Arr connection credentials by creating a client and testing
 * connection reachability.
 *
 * Body:
 * - type: `radarr`, `sonarr`, or `lidarr`
 * - url: Arr base URL
 * - apiKey: Arr API key
 */
export const POST: RequestHandler = async ({ request }) => {
  let client;
  try {
    const body = await request.json();
    const type = body?.type;
    const url = body?.url;
    const apiKey = body?.apiKey;

    // Validation
    if (typeof type !== 'string' || typeof url !== 'string' || typeof apiKey !== 'string') {
      return json({ success: false, error: 'Missing or invalid required fields' }, { status: 400 });
    }

    if (!type.trim() || !url.trim() || !apiKey.trim()) {
      return json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    if (!VALID_TYPES.includes(type)) {
      return json({ success: false, error: 'Invalid arr type' }, { status: 400 });
    }

    // Reject metadata/link-local targets before we ever construct a client.
    assertSafeArrUrl(url);

    // Create client and test connection (3 second timeout, no retries for quick feedback)
    client = createArrClient(type as ArrType, url, apiKey, { timeout: 3000, retries: 0 });
    const isConnected = await client.testConnection();

    if (isConnected) {
      return json({ success: true });
    } else {
      return json({ success: false, error: 'Connection test failed' }, { status: 400 });
    }
  } catch (error) {
    return json(
      {
        success: false,
        error: toFailureReason(error),
      },
      { status: 500 }
    );
  } finally {
    client?.close();
  }
};

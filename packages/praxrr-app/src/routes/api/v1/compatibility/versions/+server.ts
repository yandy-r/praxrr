import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { buildVersionCompatibilityMatrix } from '$shared/arr/compatibility.ts';
import { logger } from '$logger/logger.ts';

type VersionCompatibilityMatrix = components['schemas']['VersionCompatibilityMatrix'];
type ErrorResponse = components['schemas']['ErrorResponse'];

// The matrix is derived purely from authored ARR_SUPPORT_RANGES + the feature
// list — static across requests, so build once and reuse (mirrors the
// openapi.json + parity-map module-level caches).
let cachedMatrix: VersionCompatibilityMatrix | null = null;

function getMatrix(): VersionCompatibilityMatrix {
  if (!cachedMatrix) {
    cachedMatrix = buildVersionCompatibilityMatrix() satisfies VersionCompatibilityMatrix;
  }
  return cachedMatrix;
}

/**
 * GET /api/v1/compatibility/versions
 *
 * Feature-by-version-tier compatibility matrix for every supported Arr app.
 * Answers "which Praxrr features work with which application versions" without
 * needing a connected instance.
 */
export const GET: RequestHandler = async ({ locals }) => {
  // Fail closed unless authenticated OR auth is explicitly bypassed (AUTH=off / local-subnet bypass).
  if (!locals.user && !locals.authBypass) {
    return json({ error: 'Unauthorized' } satisfies ErrorResponse, { status: 401 });
  }

  try {
    return json(getMatrix());
  } catch (error) {
    await logger.error('Failed to build version compatibility matrix', {
      source: 'compatibility/versions',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });

    return json({ error: 'Failed to build version compatibility matrix' } satisfies ErrorResponse, { status: 500 });
  }
};

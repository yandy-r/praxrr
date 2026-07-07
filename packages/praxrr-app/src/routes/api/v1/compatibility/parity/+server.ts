import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type { components } from '$api/v1.d.ts';
import { pcdManager } from '$pcd/index.ts';
import { computeProfileCompatibility } from '$pcd/entities/qualityProfiles/compatibility.ts';
import { PARITY_ENTITIES } from '$shared/arr/parity.ts';
import { ARR_APP_TYPES } from '$shared/arr/capabilities.ts';
import { ARR_SEMANTIC_DIFFERENCES } from '$shared/arr/semanticDifferences.ts';
import { buildParityRows } from '$shared/arr/parityRows.ts';
import { logger } from '$logger/logger.ts';

type ParityMapResponse = components['schemas']['ParityMapResponse'];
type ErrorResponse = components['schemas']['ErrorResponse'];

type StaticParityMapPayload = Omit<ParityMapResponse, 'profiles'>;

// Matrix rows and the semantic-difference catalog are static across requests
// (see parityRows.ts / semanticDifferences.ts) — compute once and reuse,
// mirroring the openapi.json module-level cache.
let cachedStaticPayload: StaticParityMapPayload | null = null;

function getStaticParityPayload(): StaticParityMapPayload {
  if (!cachedStaticPayload) {
    cachedStaticPayload = {
      entities: [...PARITY_ENTITIES],
      apps: [...ARR_APP_TYPES],
      matrix: buildParityRows(),
      semanticDifferences: ARR_SEMANTIC_DIFFERENCES,
    };
  }

  return cachedStaticPayload;
}

/**
 * GET /api/v1/compatibility/parity
 *
 * Cross-Arr Parity Map: the static entity/app support matrix plus the curated
 * semantic-difference catalog, and — when `databaseId` is supplied — that
 * database's per-profile Arr-type compatibility.
 *
 * Query params:
 * - databaseId: optional PCD database ID; when present, adds `profiles`
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  // Fail closed unless authenticated OR auth is explicitly bypassed (AUTH=off / local-subnet bypass).
  if (!locals.user && !locals.authBypass) {
    return json({ error: 'Unauthorized' } satisfies ErrorResponse, { status: 401 });
  }

  const staticPayload = getStaticParityPayload();

  const databaseIdParam = url.searchParams.get('databaseId');
  if (databaseIdParam === null) {
    return json(staticPayload satisfies ParityMapResponse);
  }

  // Strict digits-only: reject leading-numeric junk like "1e5"/"1abc"/" 1" outright
  // per the fail-fast, no-ambiguous-ids policy for this endpoint.
  if (!/^\d+$/.test(databaseIdParam)) {
    return json({ error: 'Invalid databaseId' } satisfies ErrorResponse, { status: 400 });
  }
  const databaseId = Number.parseInt(databaseIdParam, 10);

  const cache = pcdManager.getCache(databaseId);
  if (!cache?.isBuilt()) {
    // Deliberately 400, not 404: an unknown/unbuilt database is a caller input
    // problem here, and there is no sibling-app fallback to fall back on per
    // the Cross-Arr Semantic Validation Policy.
    return json({ error: 'Database not found' } satisfies ErrorResponse, { status: 400 });
  }

  try {
    const profiles = await computeProfileCompatibility(cache);
    return json({ ...staticPayload, profiles } satisfies ParityMapResponse);
  } catch (error) {
    await logger.error('Failed to compute compatibility parity map', {
      source: 'compatibility/parity',
      meta: { databaseId, error: error instanceof Error ? error.message : String(error) },
    });

    return json({ error: 'Failed to compute compatibility parity map' } satisfies ErrorResponse, { status: 500 });
  }
};

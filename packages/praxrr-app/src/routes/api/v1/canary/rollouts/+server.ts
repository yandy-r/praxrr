import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { db } from '$db/db.ts';
import { canaryRolloutQueries } from '$db/queries/canaryRollouts.ts';
import { logger } from '$logger/logger.ts';
import { startRollout } from '$sync/canary/coordinator.ts';
import { isCanaryNotFoundError, isCanaryUnresolvedError } from '$sync/canary/errors.ts';
import type { CanaryArrType, CanaryPartialPolicy, CanaryRolloutSummary, CanaryStartInput } from '$sync/canary/types.ts';
import { isSyncPreviewArrType } from '$sync/preview/types.ts';
import type { SectionType } from '$sync/types.ts';

type ErrorResponse = { error: string };

const MAX_BODY_BYTES = 8 * 1024;
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 250;

const CANARY_SECTIONS: readonly SectionType[] = [
  'qualityProfiles',
  'delayProfiles',
  'mediaManagement',
  'metadataProfiles',
];

/** Paginated envelope for the rollouts history table (mirrors the sync-history list shape). */
interface CanaryRolloutListResponse {
  items: CanaryRolloutSummary[];
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
  hasNext: boolean;
}

/**
 * The rollout `arr_type` scope. Required: it is the authoritative cohort the canary and
 * every remaining target resolve within (no sibling fallback). Rejects `all`/`chaptarr`.
 */
function parseArrType(value: unknown): { value: CanaryArrType } | { error: string } {
  if (typeof value !== 'string' || !isSyncPreviewArrType(value)) {
    return {
      error: 'Missing or invalid arrType (expected radarr, sonarr, or lidarr)',
    };
  }
  return { value };
}

/** Optional positive integer (min 1); absent => undefined, present-and-invalid => 400. */
function parseOptionalPositiveInt(value: unknown, field: string): { value: number | undefined } | { error: string } {
  if (value === undefined) {
    return { value: undefined };
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return { error: `Invalid ${field}` };
  }
  return { value };
}

/** Optional section filters; every element must be a known `SectionType`. No clamping. */
function parseSections(value: unknown): { value: SectionType[] | undefined } | { error: string } {
  if (value === undefined) {
    return { value: undefined };
  }
  if (!Array.isArray(value)) {
    return { error: 'Invalid sections' };
  }
  const sections: SectionType[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !CANARY_SECTIONS.includes(item as SectionType)) {
      return { error: `Invalid section: ${String(item)}` };
    }
    sections.push(item as SectionType);
  }
  return { value: sections };
}

/** Optional partial-canary policy (`gate` | `abort`). */
function parsePartialPolicy(value: unknown): { value: CanaryPartialPolicy | undefined } | { error: string } {
  if (value === undefined) {
    return { value: undefined };
  }
  if (value !== 'gate' && value !== 'abort') {
    return { error: 'Invalid partialPolicy' };
  }
  return { value };
}

/** Validate and assemble the `CanaryStartInput` from a parsed request body. */
function parseStartBody(body: unknown): { value: CanaryStartInput } | { error: string } {
  const record = (body ?? {}) as Record<string, unknown>;

  const arrType = parseArrType(record.arrType);
  if ('error' in arrType) {
    return arrType;
  }

  const canaryInstanceId = parseOptionalPositiveInt(record.canaryInstanceId, 'canaryInstanceId');
  if ('error' in canaryInstanceId) {
    return canaryInstanceId;
  }

  const sections = parseSections(record.sections);
  if ('error' in sections) {
    return sections;
  }

  const maxBatchSize = parseOptionalPositiveInt(record.maxBatchSize, 'maxBatchSize');
  if ('error' in maxBatchSize) {
    return maxBatchSize;
  }

  const partialPolicy = parsePartialPolicy(record.partialPolicy);
  if ('error' in partialPolicy) {
    return partialPolicy;
  }

  const input: CanaryStartInput = { arrType: arrType.value };
  if (canaryInstanceId.value !== undefined) {
    input.canaryInstanceId = canaryInstanceId.value;
  }
  if (sections.value !== undefined) {
    input.sections = sections.value;
  }
  if (maxBatchSize.value !== undefined) {
    input.maxBatchSize = maxBatchSize.value;
  }
  if (partialPolicy.value !== undefined) {
    input.partialPolicy = partialPolicy.value;
  }

  return { value: input };
}

/** Parse a positive-integer (min 1) query param; `pageSize` caps to `max` instead of erroring. */
function parsePositiveInt(raw: string | null, fallback: number, name: string, max?: number): number {
  if (raw === null) {
    return fallback;
  }

  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(`Invalid ${name}`);
  }

  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid ${name}`);
  }

  if (max !== undefined && value > max) {
    return max;
  }

  return value;
}

/**
 * POST /api/v1/canary/rollouts
 *
 * Start a canary rollout (issue #19). Runs the canary sync inline, persists the rollout, and
 * returns the `CanaryStartResult` union: `{ skipped: true, result }` when a single eligible
 * target auto-skips to a plain sync, otherwise `{ skipped: false, rollout }` halted at the
 * verification gate. The rollout carries the durable remaining-preview evidence used by both
 * detail reads and promotion. A rollout is scoped to exactly one `arr_type`.
 */
export const POST: RequestHandler = async ({ request }) => {
  // Reject oversized bodies via Content-Length before buffering; the post-read check below
  // still guards the case where the header is absent or understates the actual size.
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json({ error: 'Request body too large' } satisfies ErrorResponse, {
      status: 400,
    });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return json({ error: 'Request body too large' } satisfies ErrorResponse, {
      status: 400,
    });
  }

  let body: unknown;
  try {
    body = rawBody.length > 0 ? JSON.parse(rawBody) : {};
  } catch {
    return json({ error: 'Invalid JSON body' } satisfies ErrorResponse, {
      status: 400,
    });
  }

  const parsed = parseStartBody(body);
  if ('error' in parsed) {
    return json({ error: parsed.error } satisfies ErrorResponse, {
      status: 400,
    });
  }

  try {
    const result = await startRollout(parsed.value);
    return json(result);
  } catch (error) {
    if (isCanaryUnresolvedError(error)) {
      return json({ error: error.message } satisfies ErrorResponse, {
        status: 422,
      });
    }
    if (isCanaryNotFoundError(error)) {
      return json({ error: error.message } satisfies ErrorResponse, {
        status: 404,
      });
    }

    await logger.error('Failed to start canary rollout', {
      source: 'CanaryRolloutsRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to start canary rollout' } satisfies ErrorResponse, { status: 500 });
  }
};

/**
 * GET /api/v1/canary/rollouts
 *
 * Paginated list of recent rollouts (newest first) for the history table. Invalid query params
 * return 400; 500 only on an internal error.
 */
export const GET: RequestHandler = async ({ url }) => {
  let page: number;
  let pageSize: number;
  try {
    page = parsePositiveInt(url.searchParams.get('page'), DEFAULT_PAGE, 'page');
    pageSize = parsePositiveInt(url.searchParams.get('pageSize'), DEFAULT_PAGE_SIZE, 'pageSize', MAX_PAGE_SIZE);
  } catch (err) {
    return json(
      {
        error: err instanceof Error ? err.message : 'Invalid query parameters',
      } satisfies ErrorResponse,
      {
        status: 400,
      }
    );
  }

  try {
    const items = canaryRolloutQueries.listRecent(pageSize, (page - 1) * pageSize);
    const totalRecords = db.queryFirst<{ total: number }>('SELECT COUNT(*) AS total FROM canary_rollouts')?.total ?? 0;
    const totalPages = pageSize > 0 ? Math.ceil(totalRecords / pageSize) : 0;

    return json({
      items,
      page,
      pageSize,
      totalRecords,
      totalPages,
      hasNext: page < totalPages,
    } satisfies CanaryRolloutListResponse);
  } catch (error) {
    await logger.error('Failed to list canary rollouts', {
      source: 'CanaryRolloutsRoute',
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    return json({ error: 'Failed to list canary rollouts' } satisfies ErrorResponse, { status: 500 });
  }
};

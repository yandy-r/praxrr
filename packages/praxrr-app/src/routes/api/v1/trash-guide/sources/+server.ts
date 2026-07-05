import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import {
  trashGuideManager,
  TrashGuideSourceConflictError,
  TrashGuideSourceValidationError,
  type TrashGuideSourceCreateInput,
} from '$lib/server/trashguide/manager.ts';
import { TrashGuideFetcherError } from '$lib/server/trashguide/types.ts';
import { TrashGuideTransformError } from '$lib/server/trashguide/transformer.ts';
import {
  logTrashGuideRouteError,
  parseOptionalNonEmptyString,
  toErrorMessage,
  validateRepositoryUrl,
} from './_helpers.ts';

const CREATE_ALLOWED_FIELDS = new Set([
  'name',
  'repositoryUrl',
  'branch',
  'arrType',
  'autoPull',
  'scoreProfile',
  'enabled',
  'syncStrategy',
]);

/**
 * GET /api/v1/trash-guide/sources
 *
 * List all configured TRaSH sources.
 *
 * @returns {Promise<Response>} JSON response with the list of sources.
 * @throws {never} This handler returns error responses instead of throwing.
 */
export const GET: RequestHandler = () => {
  return json({ sources: trashGuideManager.listSources() });
};

/**
 * POST /api/v1/trash-guide/sources
 *
 * Create a new TRaSH source record from provided payload.
 *
 * @param {{ request: Request }} event - Incoming request event.
 * @param {Request} event.request - JSON payload for source creation.
 * @returns {Promise<Response>} JSON response with created source or validation error.
 * @throws {Error} Unexpected errors propagate as response JSON with 400/500 semantics.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const payloadResult = parseCreatePayload(body);
  if ('error' in payloadResult) {
    return json({ error: payloadResult.error }, { status: 400 });
  }

  try {
    const source = await trashGuideManager.createSource(payloadResult.value);
    return json({ source }, { status: 201 });
  } catch (error) {
    const status = mapWriteErrorStatus(error);
    if (status >= 500) {
      await logTrashGuideRouteError(error, 'Failed to create TRaSH source');
    }
    return json({ error: toErrorMessage(error) }, { status });
  }
};

function parseCreatePayload(body: unknown): { value: TrashGuideSourceCreateInput } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' };
  }

  const payload = body as Record<string, unknown>;
  const unknownFields = Object.keys(payload).filter((field) => !CREATE_ALLOWED_FIELDS.has(field));
  if (unknownFields.length > 0) {
    return { error: `Unsupported fields: ${unknownFields.join(', ')}` };
  }

  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!name) {
    return { error: 'name is required' };
  }

  const repositoryUrl = typeof payload.repositoryUrl === 'string' ? payload.repositoryUrl.trim() : '';
  if (!repositoryUrl) {
    return { error: 'repositoryUrl is required' };
  }

  const repositoryUrlValidationError = validateRepositoryUrl(repositoryUrl);
  if (repositoryUrlValidationError) {
    return { error: repositoryUrlValidationError };
  }

  const arrType = typeof payload.arrType === 'string' ? payload.arrType.trim() : '';
  if (!arrType) {
    return { error: 'arrType is required' };
  }

  const branch = parseOptionalNonEmptyString(payload.branch, 'branch');
  if ('error' in branch) {
    return branch;
  }

  const scoreProfile = parseOptionalNonEmptyString(payload.scoreProfile, 'scoreProfile');
  if ('error' in scoreProfile) {
    return scoreProfile;
  }

  if (payload.enabled !== undefined && typeof payload.enabled !== 'boolean') {
    return { error: 'enabled must be a boolean when provided' };
  }

  if (payload.syncStrategy !== undefined) {
    if (typeof payload.syncStrategy !== 'number' || !Number.isInteger(payload.syncStrategy)) {
      return { error: 'syncStrategy must be an integer when provided' };
    }

    if (payload.syncStrategy < 0) {
      return { error: 'syncStrategy must be greater than or equal to 0' };
    }
  }

  if (payload.autoPull !== undefined && typeof payload.autoPull !== 'boolean') {
    return { error: 'autoPull must be a boolean when provided' };
  }

  return {
    value: {
      name,
      repositoryUrl,
      branch: branch.value,
      arrType,
      scoreProfile: scoreProfile.value,
      autoPull: payload.autoPull as boolean | undefined,
      enabled: payload.enabled as boolean | undefined,
      syncStrategy: payload.syncStrategy as number | undefined,
    },
  };
}

function mapWriteErrorStatus(error: unknown): number {
  if (error instanceof TrashGuideSourceConflictError) {
    return 409;
  }

  if (error instanceof TrashGuideSourceValidationError) {
    return 422;
  }

  if (error instanceof TrashGuideFetcherError) {
    return error.retryable ? 502 : 422;
  }

  if (error instanceof TrashGuideTransformError) {
    return 422;
  }

  return 500;
}

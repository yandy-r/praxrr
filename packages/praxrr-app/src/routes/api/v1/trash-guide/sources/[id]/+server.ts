import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import {
  trashGuideManager,
  TrashGuideSourceConflictError,
  TrashGuideSourceNotFoundError,
  TrashGuideSourceValidationError,
  type TrashGuideSourceUpdateInput,
} from '$lib/server/trashguide/manager.ts';
import { TrashGuideFetcherError } from '$lib/server/trashguide/types.ts';
import { TrashGuideTransformError } from '$lib/server/trashguide/transformer.ts';
import {
  logTrashGuideRouteError,
  parseOptionalNonEmptyString,
  parseSourceId,
  toErrorMessage,
  validateRepositoryUrl,
} from './_helpers.ts';

const UPDATE_ALLOWED_FIELDS = new Set([
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
 * GET /api/v1/trash-guide/sources/[id]
 *
 * Fetch a TRaSH source by id.
 *
 * @param {{ params: { id?: string } }} event - Route parameters.
 * @param {{ id?: string }} event.params - Route param object.
 * @returns {Promise<Response>} JSON response with source record or error.
 * @throws {never} This handler returns structured responses and does not throw.
 */
export const GET: RequestHandler = async ({ params }) => {
  const idResult = parseSourceId(params.id);
  if ('error' in idResult) {
    return json({ error: idResult.error }, { status: 400 });
  }

  try {
    return json({ source: trashGuideManager.getSource(idResult.value) });
  } catch (error) {
    const status = mapReadErrorStatus(error);
    if (status >= 500) {
      await logTrashGuideRouteError(error, `Failed to fetch TRaSH source id=${idResult.value}`);
    }
    return json({ error: toErrorMessage(error) }, { status });
  }
};

/**
 * PUT /api/v1/trash-guide/sources/[id]
 *
 * Update a TRaSH source with partial patch payload.
 *
 * @param {{ params: { id?: string }; request: Request }} event - Route event.
 * @param {Request} event.request - JSON payload containing updatable fields.
 * @returns {Promise<Response>} JSON response with updated source or error.
 * @throws {Error} Throws for parser/validation failures while applying update input.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
  const idResult = parseSourceId(params.id);
  if ('error' in idResult) {
    return json({ error: idResult.error }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const payloadResult = parseUpdatePayload(body);
  if ('error' in payloadResult) {
    return json({ error: payloadResult.error }, { status: 400 });
  }

  try {
    const source = await trashGuideManager.updateSource(idResult.value, payloadResult.value);
    return json({ source });
  } catch (error) {
    const status = mapWriteErrorStatus(error);
    if (status >= 500) {
      await logTrashGuideRouteError(error, `Failed to update TRaSH source id=${idResult.value}`);
    }
    return json({ error: toErrorMessage(error) }, { status });
  }
};

/**
 * DELETE /api/v1/trash-guide/sources/[id]
 *
 * Remove a TRaSH source record.
 *
 * @param {{ params: { id?: string } }} event - Route parameters.
 * @returns {Promise<Response>} Empty response when deletion succeeds.
 * @throws {never} This handler returns error responses instead of throwing.
 */
export const DELETE: RequestHandler = async ({ params }) => {
  const idResult = parseSourceId(params.id);
  if ('error' in idResult) {
    return json({ error: idResult.error }, { status: 400 });
  }

  try {
    await trashGuideManager.deleteSource(idResult.value);
    return new Response(null, { status: 204 });
  } catch (error) {
    const status = mapReadErrorStatus(error);
    if (status >= 500) {
      await logTrashGuideRouteError(error, `Failed to delete TRaSH source id=${idResult.value}`);
    }
    return json({ error: toErrorMessage(error) }, { status });
  }
};

function parseUpdatePayload(body: unknown): { value: TrashGuideSourceUpdateInput } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' };
  }

  const payload = body as Record<string, unknown>;
  const unknownFields = Object.keys(payload).filter((field) => !UPDATE_ALLOWED_FIELDS.has(field));
  if (unknownFields.length > 0) {
    return { error: `Unsupported fields: ${unknownFields.join(', ')}` };
  }

  const hasAtLeastOneField = [...UPDATE_ALLOWED_FIELDS].some((field) => Object.hasOwn(payload, field));
  if (!hasAtLeastOneField) {
    return { error: 'At least one updatable field is required' };
  }

  const name = parseOptionalNonEmptyString(payload.name, 'name');
  if ('error' in name) {
    return name;
  }

  const repositoryUrl = parseOptionalNonEmptyString(payload.repositoryUrl, 'repositoryUrl');
  if ('error' in repositoryUrl) {
    return repositoryUrl;
  }

  if (repositoryUrl.value) {
    const repositoryUrlValidationError = validateRepositoryUrl(repositoryUrl.value);
    if (repositoryUrlValidationError) {
      return { error: repositoryUrlValidationError };
    }
  }

  const branch = parseOptionalNonEmptyString(payload.branch, 'branch');
  if ('error' in branch) {
    return branch;
  }

  const arrType = parseOptionalNonEmptyString(payload.arrType, 'arrType');
  if ('error' in arrType) {
    return arrType;
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
      name: name.value,
      repositoryUrl: repositoryUrl.value,
      branch: branch.value,
      arrType: arrType.value,
      scoreProfile: scoreProfile.value,
      autoPull: payload.autoPull as boolean | undefined,
      enabled: payload.enabled as boolean | undefined,
      syncStrategy: payload.syncStrategy as number | undefined,
    },
  };
}

function mapReadErrorStatus(error: unknown): number {
  if (error instanceof TrashGuideSourceNotFoundError) {
    return 404;
  }

  return 500;
}

function mapWriteErrorStatus(error: unknown): number {
  if (error instanceof TrashGuideSourceNotFoundError) {
    return 404;
  }

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

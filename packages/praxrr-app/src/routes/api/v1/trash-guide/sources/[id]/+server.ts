import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import {
  trashGuideManager,
  TrashGuideSourceConflictError,
  TrashGuideSourceNotFoundError,
  TrashGuideSourceValidationError,
  type TrashGuideSourceUpdateInput,
} from '$lib/server/trashguide/manager.ts';

const UPDATE_ALLOWED_FIELDS = new Set([
  'name',
  'repositoryUrl',
  'branch',
  'arrType',
  'scoreProfile',
  'enabled',
  'syncStrategy',
]);

export const GET: RequestHandler = ({ params }) => {
  const idResult = parseSourceId(params.id);
  if ('error' in idResult) {
    return json({ error: idResult.error }, { status: 400 });
  }

  try {
    return json({ source: trashGuideManager.getSource(idResult.value) });
  } catch (error) {
    const status = mapReadErrorStatus(error);
    return json({ error: toErrorMessage(error) }, { status });
  }
};

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
    return json({ error: toErrorMessage(error) }, { status });
  }
};

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
    return json({ error: toErrorMessage(error) }, { status });
  }
};

export function parseSourceId(raw: string | undefined): { value: number } | { error: string } {
  if (!raw) {
    return { error: 'Missing source id' };
  }

  if (!/^\d+$/.test(raw)) {
    return { error: 'Invalid source id' };
  }

  const id = Number.parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: 'Invalid source id' };
  }

  return { value: id };
}

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

  return {
    value: {
      name: name.value,
      repositoryUrl: repositoryUrl.value,
      branch: branch.value,
      arrType: arrType.value,
      scoreProfile: scoreProfile.value,
      enabled: payload.enabled as boolean | undefined,
      syncStrategy: payload.syncStrategy as number | undefined,
    },
  };
}

function parseOptionalNonEmptyString(value: unknown, field: string): { value: string | undefined } | { error: string } {
  if (value === undefined) {
    return { value: undefined };
  }

  if (typeof value !== 'string') {
    return { error: `${field} must be a string when provided` };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { error: `${field} cannot be empty` };
  }

  return { value: trimmed };
}

function validateRepositoryUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'repositoryUrl must be a valid URL';
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'repositoryUrl must use http or https';
  }

  return null;
}

export function mapReadErrorStatus(error: unknown): number {
  if (error instanceof TrashGuideSourceNotFoundError) {
    return 404;
  }

  return 500;
}

export function mapWriteErrorStatus(error: unknown): number {
  if (error instanceof TrashGuideSourceNotFoundError) {
    return 404;
  }

  if (error instanceof TrashGuideSourceConflictError) {
    return 409;
  }

  if (error instanceof TrashGuideSourceValidationError) {
    return 422;
  }

  return 500;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'TRaSH source request failed';
}

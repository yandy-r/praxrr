import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import {
  trashGuideManager,
  TrashGuideSourceConflictError,
  TrashGuideSourceValidationError,
  type TrashGuideSourceCreateInput,
} from '$lib/server/trashguide/manager.ts';

const CREATE_ALLOWED_FIELDS = new Set([
  'name',
  'repositoryUrl',
  'branch',
  'arrType',
  'scoreProfile',
  'enabled',
  'syncStrategy',
]);

export const GET: RequestHandler = () => {
  return json({ sources: trashGuideManager.listSources() });
};

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

  return {
    value: {
      name,
      repositoryUrl,
      branch: branch.value,
      arrType,
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

function mapWriteErrorStatus(error: unknown): number {
  if (error instanceof TrashGuideSourceConflictError) {
    return 409;
  }

  if (error instanceof TrashGuideSourceValidationError) {
    return 422;
  }

  return 500;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'TRaSH source request failed';
}

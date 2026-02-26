import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { canWriteToBase, parseOperationLayer, pcdManager, type OperationLayer, type PCDCache } from '$pcd/index.ts';
import type { LidarrMetadataProfileDetail } from '$shared/pcd/display.ts';
import * as metadataProfiles from '$pcd/entities/metadataProfiles/index.ts';

interface ProfileTypeInput {
  id: number;
  name: string;
  allowed: boolean;
}

interface CurrentMetadataProfile {
  id: number;
  name: string;
  description: string | null;
  primaryAlbumTypes: Array<{ typeId: number; name: string; allowed: boolean }>;
  secondaryAlbumTypes: Array<{ typeId: number; name: string; allowed: boolean }>;
  releaseStatuses: Array<{ statusId: number; name: string; allowed: boolean }>;
}

interface UpdateMetadataProfileRequest {
  layer: OperationLayer;
  name?: string;
  description?: string | null;
  primaryTypes?: ProfileTypeInput[];
  secondaryTypes?: ProfileTypeInput[];
  releaseStatuses?: ProfileTypeInput[];
}

interface DeleteMetadataProfileRequest {
  layer: OperationLayer;
  name: string;
}

const POSITIVE_INTEGER_ID = /^\d+$/;
const RESERVED_METADATA_PROFILE_NAME = 'none';
const LIDARR_METADATA_PROFILE_SCHEMA_ERROR = 'This database does not expose Lidarr metadata profile tables';

const LIDARR_TABLE_QUERY_ERRORS = [
  'no such table: lidarr_metadata_profiles',
  'no such table: lidarr_metadata_profile_primary_types',
  'no such table: lidarr_metadata_profile_secondary_types',
  'no such table: lidarr_metadata_profile_release_statuses',
];

function parseDatabaseId(rawId: string | undefined, fieldName: string): { value: number } | { error: string } {
  if (!rawId) {
    return { error: `Missing ${fieldName}` };
  }

  if (!POSITIVE_INTEGER_ID.test(rawId)) {
    return { error: `Invalid ${fieldName}` };
  }

  const id = Number.parseInt(rawId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: `Invalid ${fieldName}` };
  }

  return { value: id };
}

function getDatabase(databaseId: number): { value: PCDCache } | { error: string; status: number } {
  const database = pcdManager.getById(databaseId);
  if (!database) {
    return { error: 'Database not found', status: 404 };
  }

  const cache = pcdManager.getCache(databaseId);
  if (!cache) {
    return { error: 'Database cache not available', status: 500 };
  }

  return { value: cache };
}

function isLidarrMetadataProfileSchemaError(message: string): boolean {
  return LIDARR_TABLE_QUERY_ERRORS.some((fragment) => message.includes(fragment));
}

async function validateLidarrMetadataProfileSupport(cache: PCDCache): Promise<boolean> {
  try {
    await cache.kb.selectFrom('lidarr_metadata_profiles').select('id').limit(1).executeTakeFirst();

    await cache.kb
      .selectFrom('lidarr_metadata_profile_primary_types')
      .select('metadata_profile_name')
      .limit(1)
      .executeTakeFirst();

    await cache.kb
      .selectFrom('lidarr_metadata_profile_secondary_types')
      .select('metadata_profile_name')
      .limit(1)
      .executeTakeFirst();

    await cache.kb
      .selectFrom('lidarr_metadata_profile_release_statuses')
      .select('metadata_profile_name')
      .limit(1)
      .executeTakeFirst();

    return true;
  } catch (error) {
    if (error instanceof Error && isLidarrMetadataProfileSchemaError(error.message)) {
      return false;
    }

    throw error;
  }
}

function parsePortableMetadataTypeArray(
  raw: unknown,
  fieldName: string
): { value: ProfileTypeInput[] } | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: `${fieldName} must be an array` };
  }

  const rows: ProfileTypeInput[] = [];

  for (const rawRow of raw) {
    if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
      return { error: `${fieldName} must contain objects` };
    }

    const row = rawRow as Record<string, unknown>;
    const id = typeof row.id === 'number' && Number.isInteger(row.id) ? row.id : null;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const allowed = typeof row.allowed === 'boolean' ? row.allowed : null;

    if (id === null) {
      return { error: `${fieldName} entries require an integer id` };
    }

    if (!name) {
      return { error: `${fieldName} entries require a name` };
    }

    if (allowed === null) {
      return { error: `${fieldName} entries require a boolean allowed field` };
    }

    rows.push({ id, name, allowed });
  }

  return { value: rows };
}

function parseUpdatePayload(
  body: unknown,
  current: CurrentMetadataProfile
): { value: UpdateMetadataProfileRequest } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Invalid request body' };
  }

  const root = body as Record<string, unknown>;
  const parsed: UpdateMetadataProfileRequest = { layer: 'user' };

  if (root.name !== undefined) {
    const name = typeof root.name === 'string' ? root.name.trim() : '';
    if (!name) {
      return { error: 'Profile name cannot be empty' };
    }
    if (name.toLowerCase() === RESERVED_METADATA_PROFILE_NAME) {
      return { error: `'None' is a reserved profile name` };
    }
    parsed.name = name;
  }

  if (root.description !== undefined) {
    if (root.description !== null && typeof root.description !== 'string') {
      return { error: 'Description must be a string or null' };
    }
    parsed.description = root.description === null ? null : root.description.trim();
  }

  if (root.primaryTypes !== undefined) {
    const primaryTypesResult = parsePortableMetadataTypeArray(root.primaryTypes, 'primaryTypes');
    if ('error' in primaryTypesResult) {
      return { error: primaryTypesResult.error };
    }
    parsed.primaryTypes = primaryTypesResult.value;
  }

  if (root.secondaryTypes !== undefined) {
    const secondaryTypesResult = parsePortableMetadataTypeArray(root.secondaryTypes, 'secondaryTypes');
    if ('error' in secondaryTypesResult) {
      return { error: secondaryTypesResult.error };
    }
    parsed.secondaryTypes = secondaryTypesResult.value;
  }

  if (root.releaseStatuses !== undefined) {
    const releaseStatusesResult = parsePortableMetadataTypeArray(root.releaseStatuses, 'releaseStatuses');
    if ('error' in releaseStatusesResult) {
      return { error: releaseStatusesResult.error };
    }
    parsed.releaseStatuses = releaseStatusesResult.value;
  }

  const hasMutableField =
    parsed.name !== undefined ||
    parsed.description !== undefined ||
    parsed.primaryTypes !== undefined ||
    parsed.secondaryTypes !== undefined ||
    parsed.releaseStatuses !== undefined;

  if (!hasMutableField) {
    return { error: 'At least one field is required for update' };
  }

  const layerResult = parseOperationLayer(root.layer);
  if ('error' in layerResult) {
    return { error: layerResult.error };
  }
  parsed.layer = layerResult.value;

  const nextPrimaryTypes = parsed.primaryTypes
    ? parsed.primaryTypes.map((type) => ({
        typeId: type.id,
        name: type.name,
        allowed: type.allowed,
      }))
    : current.primaryAlbumTypes;
  const nextSecondaryTypes = parsed.secondaryTypes
    ? parsed.secondaryTypes.map((type) => ({
        typeId: type.id,
        name: type.name,
        allowed: type.allowed,
      }))
    : current.secondaryAlbumTypes;
  const nextReleaseStatuses = parsed.releaseStatuses
    ? parsed.releaseStatuses.map((type) => ({
        statusId: type.id,
        name: type.name,
        allowed: type.allowed,
      }))
    : current.releaseStatuses;

  const hasPrimaryAllowed = nextPrimaryTypes.some((entry) => entry.allowed);
  const hasSecondaryAllowed = nextSecondaryTypes.some((entry) => entry.allowed);
  const hasReleaseStatusAllowed = nextReleaseStatuses.some((entry) => entry.allowed);

  if (!hasPrimaryAllowed || !hasSecondaryAllowed || !hasReleaseStatusAllowed) {
    return { error: 'Each metadata profile section must include at least one allowed entry' };
  }

  return { value: parsed };
}

function parseDeletePayload(body: unknown): { value: DeleteMetadataProfileRequest } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Invalid request body' };
  }

  const root = body as Record<string, unknown>;
  const layerResult = parseOperationLayer(root.layer);
  if ('error' in layerResult) {
    return { error: layerResult.error };
  }

  const name = typeof root.name === 'string' ? root.name.trim() : '';
  if (!name) {
    return { error: 'Profile name is required' };
  }

  return { value: { layer: layerResult.value, name } };
}

function toDetail(current: CurrentMetadataProfile, updatedAt: string): LidarrMetadataProfileDetail {
  return {
    id: current.id,
    name: current.name,
    description: current.description,
    updated_at: updatedAt,
    primaryTypes: current.primaryAlbumTypes.map((entry) => ({
      type_id: entry.typeId,
      name: entry.name,
      allowed: entry.allowed,
    })),
    secondaryTypes: current.secondaryAlbumTypes.map((entry) => ({
      type_id: entry.typeId,
      name: entry.name,
      allowed: entry.allowed,
    })),
    releaseStatuses: current.releaseStatuses.map((entry) => ({
      status_id: entry.statusId,
      name: entry.name,
      allowed: entry.allowed,
    })),
  };
}

function getWriteErrorStatus(message: string): number {
  if (isLidarrMetadataProfileSchemaError(message)) {
    return 400;
  }

  if (message.includes('Database instance not found') || message.includes('not found')) {
    return 404;
  }

  if (
    message.includes('already exists') ||
    message.includes('reserved') ||
    message.includes('required') ||
    message.includes('No allowed') ||
    message.includes('Validation failed')
  ) {
    return 400;
  }

  if (message.includes('Base layer requires') || message.includes('Cannot write to base layer')) {
    return 403;
  }

  return 500;
}

function getReadErrorStatus(message: string): number {
  if (message.includes('not found')) {
    return 404;
  }

  if (isLidarrMetadataProfileSchemaError(message)) {
    return 400;
  }

  return 500;
}

/**
 * GET handler — fetch detail for a single Lidarr metadata profile.
 *
 * @returns JSON response with the metadata profile detail, or an error response
 */
export const GET: RequestHandler = async ({ params }) => {
  const databaseIdResult = parseDatabaseId(params.databaseId, 'databaseId');
  if ('error' in databaseIdResult) {
    return json({ error: databaseIdResult.error }, { status: 400 });
  }

  const profileIdResult = parseDatabaseId(params.id, 'id');
  if ('error' in profileIdResult) {
    return json({ error: profileIdResult.error }, { status: 400 });
  }

  const database = getDatabase(databaseIdResult.value);
  if ('error' in database) {
    return json({ error: database.error }, { status: database.status });
  }

  try {
    const isSupported = await validateLidarrMetadataProfileSupport(database.value);
    if (!isSupported) {
      return json({ error: LIDARR_METADATA_PROFILE_SCHEMA_ERROR }, { status: 400 });
    }

    const current = await metadataProfiles.get(database.value, profileIdResult.value);
    if (!current) {
      return json({ error: 'Metadata profile not found' }, { status: 404 });
    }

    const profileRow = await database.value.kb
      .selectFrom('lidarr_metadata_profiles')
      .select('updated_at')
      .where('id', '=', profileIdResult.value)
      .executeTakeFirst();

    if (!profileRow) {
      return json({ error: 'Metadata profile not found' }, { status: 404 });
    }

    return json(toDetail(current, profileRow.updated_at));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch metadata profile';
    return json({ error: message }, { status: getReadErrorStatus(message) });
  }
};

/**
 * PUT handler — update an existing Lidarr metadata profile.
 * Accepts partial updates; at least one mutable field must be provided.
 *
 * @returns JSON `{ success: true }` on success, or an error response
 */
export const PUT: RequestHandler = async ({ params, request }) => {
  const databaseIdResult = parseDatabaseId(params.databaseId, 'databaseId');
  if ('error' in databaseIdResult) {
    return json({ error: databaseIdResult.error }, { status: 400 });
  }

  const profileIdResult = parseDatabaseId(params.id, 'id');
  if ('error' in profileIdResult) {
    return json({ error: profileIdResult.error }, { status: 400 });
  }

  const database = getDatabase(databaseIdResult.value);
  if ('error' in database) {
    return json({ error: database.error }, { status: database.status });
  }

  try {
    const isSupported = await validateLidarrMetadataProfileSupport(database.value);
    if (!isSupported) {
      return json({ error: LIDARR_METADATA_PROFILE_SCHEMA_ERROR }, { status: 400 });
    }

    const current = await metadataProfiles.get(database.value, profileIdResult.value);
    if (!current) {
      return json({ error: 'Metadata profile not found' }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const payloadResult = parseUpdatePayload(body, current);
    if ('error' in payloadResult) {
      return json({ error: payloadResult.error }, { status: 400 });
    }

    if (payloadResult.value.layer === 'base' && !canWriteToBase(databaseIdResult.value)) {
      return json({ error: 'Cannot write to base layer without personal access token' }, { status: 403 });
    }

    const primaryInput = payloadResult.value.primaryTypes
      ? payloadResult.value.primaryTypes.map((entry) => ({
          typeId: entry.id,
          name: entry.name,
          allowed: entry.allowed,
        }))
      : undefined;

    const secondaryInput = payloadResult.value.secondaryTypes
      ? payloadResult.value.secondaryTypes.map((entry) => ({
          typeId: entry.id,
          name: entry.name,
          allowed: entry.allowed,
        }))
      : undefined;

    const releaseInput = payloadResult.value.releaseStatuses
      ? payloadResult.value.releaseStatuses.map((entry) => ({
          statusId: entry.id,
          name: entry.name,
          allowed: entry.allowed,
        }))
      : undefined;

    const result = await metadataProfiles.update({
      databaseId: databaseIdResult.value,
      cache: database.value,
      layer: payloadResult.value.layer ?? 'user',
      current,
      input: {
        ...(payloadResult.value.name !== undefined ? { name: payloadResult.value.name } : {}),
        ...(payloadResult.value.description !== undefined ? { description: payloadResult.value.description } : {}),
        ...(primaryInput !== undefined ? { primaryAlbumTypes: primaryInput } : {}),
        ...(secondaryInput !== undefined ? { secondaryAlbumTypes: secondaryInput } : {}),
        ...(releaseInput !== undefined ? { releaseStatuses: releaseInput } : {}),
      },
    });

    if (!result.success) {
      const message = result.error ?? 'Failed to update metadata profile';
      return json({ error: message }, { status: getWriteErrorStatus(message) });
    }

    return json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update metadata profile';
    return json({ error: message }, { status: getWriteErrorStatus(message) });
  }
};

/**
 * DELETE handler — remove a Lidarr metadata profile by ID.
 * Requires `layer` and `name` in the request body for guard validation.
 *
 * @returns JSON `{ success: true }` on success, or an error response
 */
export const DELETE: RequestHandler = async ({ params, request }) => {
  const databaseIdResult = parseDatabaseId(params.databaseId, 'databaseId');
  if ('error' in databaseIdResult) {
    return json({ error: databaseIdResult.error }, { status: 400 });
  }

  const profileIdResult = parseDatabaseId(params.id, 'id');
  if ('error' in profileIdResult) {
    return json({ error: profileIdResult.error }, { status: 400 });
  }

  const database = getDatabase(databaseIdResult.value);
  if ('error' in database) {
    return json({ error: database.error }, { status: database.status });
  }

  try {
    const isSupported = await validateLidarrMetadataProfileSupport(database.value);
    if (!isSupported) {
      return json({ error: LIDARR_METADATA_PROFILE_SCHEMA_ERROR }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const payloadResult = parseDeletePayload(body);
    if ('error' in payloadResult) {
      return json({ error: payloadResult.error }, { status: 400 });
    }

    if (payloadResult.value.layer === 'base' && !canWriteToBase(databaseIdResult.value)) {
      return json({ error: 'Cannot write to base layer without personal access token' }, { status: 403 });
    }

    const current = await metadataProfiles.get(database.value, profileIdResult.value);
    if (!current) {
      return json({ error: 'Metadata profile not found' }, { status: 404 });
    }

    if (current.name !== payloadResult.value.name) {
      return json({ error: 'Profile name does not match the selected profile' }, { status: 400 });
    }

    const result = await metadataProfiles.remove({
      databaseId: databaseIdResult.value,
      cache: database.value,
      layer: payloadResult.value.layer,
      current,
    });

    if (!result.success) {
      const message = result.error ?? 'Failed to delete metadata profile';
      return json({ error: message }, { status: getWriteErrorStatus(message) });
    }

    return json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete metadata profile';
    return json({ error: message }, { status: getWriteErrorStatus(message) });
  }
};
